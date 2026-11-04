import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * A self-hosted map built for the native renderer, as `tileflow build --renderer native` prepares
 * it: Streets over the fixture's city tiles and constant elevation, in four themes, with a world
 * image underlay drawn up to z11 like Streets' climate underlay, so that at the city's zooms no
 * layer draws that image source. `@tileflow/dev` builds it in memory with the fixture's origin as
 * its development origin, the HTTP exception a served native preview has, and the server answers
 * its files under `/native/`: the manifest at `/native/manifest.json`, styles, family documents,
 * sprites, images and font faces.
 *
 * A build takes tens of seconds, so its files are kept in the system's temporary directory, keyed
 * by the origin, the map and the built packages it depends on. Requests wait for the first build.
 * Build `@tileflow/core`, `@tileflow/dev` and `@tileflow/maps` first (`pnpm build`).
 */
const root = fileURLToPath(new URL('../', import.meta.url));

/** The map: Streets, with only the modules the city tiles hold and four themes. */
const config = (
  base,
  underlay,
) => `import {boundaryChoropleth, choroplethScale, defineMap, disable, tileflowWorldSchema, vectorTiles} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';
const city = defineMap({
  id: 'city',
  version: 1,
  extends: streets,
  projection: 'mercator',
  themes: {
    light: streetsThemes.light,
    dawn: streetsThemes.dawn,
    dusk: streetsThemes.dusk,
    dark: streetsThemes.dark,
  },
  defaultTheme: 'light',
  systemThemes: {light: 'light', dark: 'dark'},
  timeOfDay: {light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'}},
  view: {center: [-3.7, 40.42], zoom: 16},
  data: vectorTiles({
    attribution: 'Fixture City',
    revision: 'fixture-city-v1',
    schema: tileflowWorldSchema(),
    tiles: ['${base}/city/{z}/{x}/{y}.mvt'],
  }),
  terrain: {
    mode: 'hillshade',
    encoding: 'mapbox',
    tiles: ['${base}/terrain/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxZoom: 14,
    attribution: 'Fixture Terrain',
  },
  modules: {
    addresses: disable(),
    // An embedded world image exercises native extraction and projection.
    land: {
      type: 'land',
      globalLandcoverUnderlay: {
        url: '${underlay}',
        coordinates: [
          [-180, 85.0511287798066],
          [180, 85.0511287798066],
          [180, -85.0511287798066],
          [-180, -85.0511287798066],
        ],
        attribution: 'Fixture Climate',
        maxZoom: 11,
      },
    },
    aeroways: disable(),
    boundaries: disable(),
    landforms: disable(),
    poi: disable(),
    roads: disable(),
    transit: disable(),
  },
});
export default {maps: {
  city,
  appearance: defineMap({
    id: 'appearance',
    version: 1,
    extends: city,
    boundaryAreas: {family: 'boundaries', url: '${base}/fixture-boundaries/tiles.json'},
    overlays: {
      score: boundaryChoropleth({
        id: 'score',
        classes: ['municipality'],
        missingColor: '#00000000',
        scale: choroplethScale.linear([[0, '#ffffff'], [10, '#ff0000']]),
        values: {joinBy: 'id', rows: [{key: 41, value: 3}]},
      }),
    },
  }),
  streets: defineMap({
    id: 'streets',
    version: 1,
    extends: streets,
    view: {center: [-3.7, 40.42], zoom: 16},
    data: vectorTiles({
      attribution: 'Fixture City',
      schema: tileflowWorldSchema(),
      tiles: ['${base}/city/{z}/{x}/{y}.mvt'],
    }),
    terrain: {...streets.terrain, tiles: ['${base}/terrain/{z}/{x}/{y}.png']},
  }),
}};
`;

/** Names, sizes and times of the built packages the map depends on. */
async function inputs() {
  const lines = [];
  for (const name of ['core', 'dev', 'maps']) {
    const directory = resolve(root, 'packages', name, 'dist');
    for (const entry of (await readdir(directory, {recursive: true})).sort()) {
      const info = await stat(join(directory, entry));
      if (info.isFile()) lines.push(`${name}/${entry} ${info.size} ${info.mtimeMs}`);
    }
  }
  return lines.join('\n');
}

async function build(base, underlay, directory) {
  const work = `${directory}.work`;
  await rm(work, {recursive: true, force: true});
  const project = join(work, 'project');
  await mkdir(join(project, 'node_modules', '@tileflow'), {recursive: true});
  for (const name of ['core', 'maps'])
    await symlink(
      resolve(root, 'packages', name),
      join(project, 'node_modules', '@tileflow', name),
    );
  await writeFile(join(project, 'tileflow.workspace.ts'), config(base, underlay));
  const dev = await import(pathToFileURL(resolve(root, 'packages/dev/dist/artifacts.js')).href);
  const artifacts = await dev.createTileflowBuildArtifacts({
    cwd: project,
    config: 'tileflow.workspace.ts',
    renderer: 'native',
    styleBaseUrl: base,
    assetBaseUrl: base,
    developmentOrigin: base,
  });
  try {
    const files = join(work, 'files');
    for (const file of artifacts.files) {
      const target = join(files, file.fileName);
      await mkdir(dirname(target), {recursive: true});
      const bytes =
        file.source !== undefined
          ? Buffer.from(file.source)
          : await readFile(file.path ?? file.sourcePath);
      await writeFile(target, bytes);
    }
  } finally {
    await dev.disposeTileflowBuildArtifacts(artifacts);
  }
  await rm(directory, {recursive: true, force: true});
  await rename(join(work, 'files'), directory);
  await rm(work, {recursive: true, force: true});
}

export function createNativeBuildFixture({base, elevation}) {
  const underlay = `data:image/png;base64,${elevation.toString('base64')}`;
  let ready;
  const prepare = () => {
    ready ??= (async () => {
      const key = createHash('sha256')
        .update(`${base}\n${config(base, underlay)}\n${await inputs()}`)
        .digest('hex')
        .slice(0, 16);
      const directory = join(tmpdir(), 'tileflow-mobile-fixture', `native-${key}`);
      const marker = join(directory, 'manifest.json');
      if (!(await stat(marker).catch(() => undefined))) {
        const started = Date.now();
        console.log('Building the native fixture map…');
        await build(base, underlay, directory);
        console.log(`Native fixture map built in ${Math.round((Date.now() - started) / 1000)} s.`);
      }
      return directory;
    })();
    return ready;
  };

  /** Answers `/native/…` from the build and `/terrain/…` with constant elevation. */
  return {
    prepare,
    async handle(request, response) {
      const path = request.url.split('?')[0];
      if (/^\/terrain\/\d+\/\d+\/\d+\.png$/u.test(path)) {
        response.setHeader('Content-Type', 'image/png');
        response.end(elevation);
        return true;
      }
      if (!path.startsWith('/native/')) return false;
      let directory;
      try {
        directory = await prepare();
      } catch (error) {
        console.error(error);
        response.statusCode = 503;
        response.end();
        return true;
      }
      const relative = decodeURIComponent(path.slice('/native/'.length));
      const file = resolve(directory, relative);
      if (!file.startsWith(`${directory}/`)) {
        response.statusCode = 404;
        response.end();
        return true;
      }
      const bytes = await readFile(file).catch(() => undefined);
      if (!bytes) {
        response.statusCode = 404;
        response.end();
        return true;
      }
      response.setHeader(
        'Content-Type',
        file.endsWith('.json')
          ? 'application/json'
          : file.endsWith('.png')
            ? 'image/png'
            : file.endsWith('.ttf')
              ? 'font/ttf'
              : 'application/octet-stream',
      );
      response.end(bytes);
      return true;
    },
  };
}
