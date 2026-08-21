import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {basename, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTileflowCaptureReceipt} from '../packages/capture/dist/receipt.js';

const baselineDirectory = fileURLToPath(
  new URL('../examples/tileflow-streets/test/visual-baselines/', import.meta.url),
);
const entries = await readdir(baselineDirectory, {withFileTypes: true});
const receiptNames = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.receipt.json'))
  .map((entry) => entry.name)
  .sort(compareCodeUnits);
const imageNames = entries
  .filter((entry) => entry.isFile() && extname(entry.name) === '.png')
  .map((entry) => entry.name)
  .sort(compareCodeUnits);

if (receiptNames.length === 0) {
  throw new Error(`No visual baseline receipts found in ${baselineDirectory}`);
}

const expectedImageNames = receiptNames.map((name) => name.replace(/\.receipt\.json$/u, '.png'));
assertSameFiles('PNG baselines', expectedImageNames, imageNames);

for (const receiptName of receiptNames) {
  const receiptPath = join(baselineDirectory, receiptName);
  const imageName = receiptName.replace(/\.receipt\.json$/u, '.png');
  const imagePath = join(baselineDirectory, imageName);
  const [receiptSource, png] = await Promise.all([
    readFile(receiptPath, 'utf8'),
    readFile(imagePath),
  ]);
  const receipt = parseTileflowCaptureReceipt(receiptSource);
  const dimensions = readPngDimensions(png, imageName);
  const imageSha256 = createHash('sha256').update(png).digest('hex');

  if (receipt.scene.name !== basename(imageName, '.png')) {
    throw new Error(
      `${receiptName}: scene name ${JSON.stringify(receipt.scene.name)} does not match its file name.`,
    );
  }
  if (receipt.image.sha256 !== imageSha256) {
    throw new Error(`${receiptName}: PNG SHA-256 does not match ${imageName}.`);
  }
  if (
    receipt.image.physicalWidth !== dimensions.width ||
    receipt.image.physicalHeight !== dimensions.height
  ) {
    throw new Error(
      `${receiptName}: receipt dimensions ${receipt.image.physicalWidth}x${receipt.image.physicalHeight} ` +
        `do not match ${imageName} (${dimensions.width}x${dimensions.height}).`,
    );
  }
}

console.log(`Validated ${receiptNames.length} committed visual baseline pairs.`);

function assertSameFiles(label, expected, actual) {
  if (
    expected.length === actual.length &&
    expected.every((value, index) => value === actual[index])
  ) {
    return;
  }
  throw new Error(
    `${label} do not have a one-to-one receipt match. Expected ${JSON.stringify(expected)}, ` +
      `received ${JSON.stringify(actual)}.`,
  );
}

function readPngDimensions(png, fileName) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    png.byteLength < 24 ||
    !png.subarray(0, signature.byteLength).equals(signature) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(`${fileName}: invalid PNG header.`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new Error(`${fileName}: invalid PNG dimensions.`);
  }
  return {height, width};
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
