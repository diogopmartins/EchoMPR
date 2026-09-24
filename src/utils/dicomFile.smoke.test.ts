/**
 * Smoke test against a real Philips QLAB Cartesian export, using the same
 * parser and volume builder as the app. Skipped when the file is absent.
 *
 *   DICOM_FILE=path/to/file.dcm npm run smoke
 *
 * Defaults to ./1.dcm at the repo root (*.dcm is gitignored).
 */
import fs from 'fs';
import path from 'path';
import * as dicomParser from 'dicom-parser';
import { parseDicomBuffer } from './dicomParser';
import { TAG, readElementNumber } from './dicomTags';

const filePath = path.resolve(process.env.DICOM_FILE || '1.dcm');
const hasFile = fs.existsSync(filePath);

(hasFile ? describe : describe.skip)(`DICOM smoke: ${filePath}`, () => {
  const buf = hasFile ? fs.readFileSync(filePath) : Buffer.alloc(0);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  test('builds a Philips Cartesian volume whose layout matches PixelData', () => {
    const data = parseDicomBuffer(arrayBuffer, { name: path.basename(filePath), size: buf.length });
    const vol = data.volume;
    expect(vol).not.toBeNull();
    if (!vol) return;

    const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
    const tagT = readElementNumber(dataSet, TAG.numberOfFrames) || 1;
    const tagZ = readElementNumber(dataSet, TAG.philipsZCount);
    const pixelBytes = dataSet.elements[TAG.pixelData].length;
    const slices = pixelBytes / (vol.dims.y * vol.dims.x);

    // eslint-disable-next-line no-console
    console.log(
      [
        `Manufacturer: ${data.manufacturer}`,
        `Comments:     ${data.imageComments}`,
        `Dims T,Z,Y,X: ${vol.dims.t} ${vol.dims.z} ${vol.dims.y} ${vol.dims.x} (tags T=${tagT} Z=${tagZ})`,
        `Spacing cm:   ${vol.spacingCm.x} ${vol.spacingCm.y} ${vol.spacingCm.z}`,
        `Frame time:   ${vol.frameTimeMs} ms`,
        `ECG:          ${
          vol.ecg
            ? `${vol.ecg.label}, ${vol.ecg.samples.length} samples @ ${vol.ecg.sampleHz} Hz, ` +
              `${vol.ecg.beats.length} beats, ${vol.ecg.heartRateBpm ?? '?'} bpm`
            : 'none'
        }`,
      ].join('\n')
    );

    expect(vol.isPhilipsCartesian).toBe(true);
    expect(slices).toBe(vol.dims.t * vol.dims.z);
    expect(vol.voxels.length).toBe(vol.dims.t * vol.volumeSize);
  });
});
