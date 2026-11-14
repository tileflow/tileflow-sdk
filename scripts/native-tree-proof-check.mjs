import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require = createRequire(new URL('../packages/dev/package.json', import.meta.url));
const sharp = require('sharp');
const root = resolve(process.argv[2]);
const source = await readFile(
  new URL(
    '../packages/maps/assets/streets/tree-models/models/streets-tree-round-near',
    import.meta.url,
  ),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {modelBytes: source.length, modelSha256: digest(source), platforms: {}};

for (const platform of ['ios', 'android']) {
  const captures = {};
  for (const name of ['bearing-0', 'bearing-45', 'bearing-180', 'no-building']) {
    const masks = [];
    for (const mode of ['online', 'offline']) {
      const {data, info} = await sharp(resolve(root, platform, mode, `${name}.png`))
        .removeAlpha()
        .raw()
        .toBuffer({resolveWithObject: true});
      const mask = new Uint8Array(info.width * info.height);
      for (let i = 0; i < mask.length; i++) {
        const [r, g, b] = data.subarray(i * 3, i * 3 + 3);
        mask[i] = g > r * 1.4 && g > b * 1.4 && g > 30 ? 1 : 0;
      }
      masks.push(mask);
    }
    assert.equal(masks[0].length, masks[1].length);
    const greenPixels = masks[0].reduce((a, b) => a + b, 0);
    const changedGreenPixels = masks[0].reduce(
      (sum, value, i) => sum + (value !== masks[1][i] ? 1 : 0),
      0,
    );
    assert(greenPixels > 2000, `${platform}/${name}: no visible canopy`);
    assert.equal(changedGreenPixels, 0, `${platform}/${name}: offline trees differ`);
    captures[name] = {greenPixels, changedGreenPixels};
  }
  const hiddenFraction =
    1 - captures['bearing-180'].greenPixels / captures['no-building'].greenPixels;
  assert(hiddenFraction > 0.15, `${platform}: building did not hide the back trees`);
  for (const mode of ['online', 'offline']) {
    assert.equal(
      digest(await readFile(resolve(root, platform, `${mode}.tftm`))),
      report.modelSha256,
    );
  }
  report.platforms[platform] = {captures, hiddenFraction};
}
console.log(JSON.stringify(report, null, 2));
