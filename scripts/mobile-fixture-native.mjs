import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, rename, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

/**
 * A self-hosted map built for the native renderer, as `tileflow build --renderer native` prepares
 * it: Streets over the fixture's city tiles and constant elevation, in four themes. `@tileflow/dev`
 * builds it in memory with the fixture's origin as its development origin, the HTTP exception a
 * served native preview has, and the server answers its files under `/native/`: the manifest at
 * `/native/manifest.json`, styles, family documents, sprites and font faces.
 *
 * A build takes tens of seconds, so its files are kept in the system's temporary directory, keyed
 * by the origin, the map and the built packages it depends on. Requests wait for the first build.
 * Build `@tileflow/core`, `@tileflow/dev` and `@tileflow/maps` first (`pnpm build`).
 */
const root = fileURLToPath(new URL('../', import.meta.url));

/** The map: Streets, with only the modules the city tiles hold and four themes. */
const config = (
  base,
) => `import {defineMap, disable, openMapTiles, vectorTiles} from '@tileflow/core';
import {streets, streetsThemes} from '@tileflow/maps';
export default defineMap({
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
    schema: openMapTiles(),
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
    // MapLibre Native requests an image source only while one of its layers is inside its zoom
    // range, and reports a map loaded only once every source has loaded: Streets' climate
    // underlay, drawn up to z11, would keep these city-zoom maps from ever becoming ready.
    land: {type: 'land', globalLandcover: {visible: false}},
    aeroways: disable(),
    boundaries: disable(),
    landforms: disable(),
    poi: disable(),
    roads: disable(),
    transit: disable(),
  },
});
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

async function build(base, directory) {
  const work = `${directory}.work`;
  await rm(work, {recursive: true, force: true});
  const project = join(work, 'project');
  await mkdir(join(project, 'node_modules', '@tileflow'), {recursive: true});
  for (const name of ['core', 'maps'])
    await symlink(
      resolve(root, 'packages', name),
      join(project, 'node_modules', '@tileflow', name),
    );
  await writeFile(join(project, 'tileflow.config.ts'), config(base));
  const dev = await import(pathToFileURL(resolve(root, 'packages/dev/dist/artifacts.js')).href);
  const artifacts = await dev.createTileflowBuildArtifacts({
    cwd: project,
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
  let ready;
  const prepare = () => {
    ready ??= (async () => {
      const key = createHash('sha256')
        .update(`${base}\n${config(base)}\n${await inputs()}`)
        .digest('hex')
        .slice(0, 16);
      const directory = join(tmpdir(), 'tileflow-mobile-fixture', `native-${key}`);
      const marker = join(directory, 'manifest.json');
      if (!(await stat(marker).catch(() => undefined))) {
        const started = Date.now();
        console.log('Building the native fixture map…');
        await build(base, directory);
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
