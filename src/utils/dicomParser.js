import * as dicomParser from 'dicom-parser';
import {
  buildPhilipsVolume,
  readElementNumber,
  getVolumeAtTime,
} from './philipsVolume';
import { extractEcg } from './ecg';

/**
 * Parse a DICOM File/Blob. Returns metadata + optional Philips 4D volume.
 * @param {File|Blob} file
 * @param {{ onProgress?: (ratio: number) => void }} [options]
 */
export const parseDicomFile = async (file, options = {}) => {
  const arrayBuffer = await readFileAsArrayBuffer(file, options.onProgress);
  const byteArray = new Uint8Array(arrayBuffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const dicomData = {
    patientName: getStringValue(dataSet, 'x00100010'),
    patientId: getStringValue(dataSet, 'x00100020'),
    studyDate: getStringValue(dataSet, 'x00080020'),
    studyTime: getStringValue(dataSet, 'x00080030'),
    modality: getStringValue(dataSet, 'x00080060'),
    manufacturer: getStringValue(dataSet, 'x00080070'),
    manufacturerModelName: getStringValue(dataSet, 'x00081090'),
    imageType: getStringValue(dataSet, 'x00080008'),
    rows: readElementNumber(dataSet, 'x00280010') || 0,
    columns: readElementNumber(dataSet, 'x00280011') || 0,
    bitsAllocated: readElementNumber(dataSet, 'x00280100') || 8,
    bitsStored: readElementNumber(dataSet, 'x00280101') || 8,
    samplesPerPixel: readElementNumber(dataSet, 'x00280002') || 1,
    photometricInterpretation: getStringValue(dataSet, 'x00280004'),
    windowCenter: readElementNumber(dataSet, 'x00281050') || 128,
    windowWidth: readElementNumber(dataSet, 'x00281051') || 256,
    imageComments: getStringValue(dataSet, 'x00204000'),
    numberOfFrames: readElementNumber(dataSet, 'x00280008') || 1,
    frameTime: readElementNumber(dataSet, 'x00181063') || 0,
    fileName: file.name || 'dicom',
    fileSize: file.size || arrayBuffer.byteLength,
  };

  let volume = null;
  try {
    volume = buildPhilipsVolume(dataSet, arrayBuffer);
  } catch (err) {
    console.warn('Volume build failed, falling back to 2D frames:', err.message);
  }

  dicomData.volume = volume;

  if (volume) {
    try {
      volume.ecg = extractEcg(dataSet, arrayBuffer);
    } catch (err) {
      console.warn('ECG extract failed:', err.message);
    }
  }

  return dicomData;
};

function readFileAsArrayBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

const getStringValue = (dataSet, tag) => {
  const element = dataSet.elements[tag];
  if (element && element.length > 0) {
    return dataSet.string(tag) || '';
  }
  return '';
};

export const exportToNRRD = (vol, frameIndex = 0) => {
  if (!vol) {
    throw new Error('No volume data available');
  }

  const voxels = getVolumeAtTime(vol, frameIndex);
  const { dims, spacingCm } = vol;

  const header = [
    'NRRD0004',
    '# Complete NRRD file format specification at:',
    '# http://teem.sourceforge.net/nrrd/format.html',
    'type: unsigned char',
    'dimension: 3',
    `sizes: ${dims.x} ${dims.y} ${dims.z}`,
    `spacings: ${spacingCm.x * 10} ${spacingCm.y * 10} ${spacingCm.z * 10}`,
    'units: mm mm mm',
    'encoding: raw',
    '',
  ].join('\n');

  const headerBytes = new TextEncoder().encode(header);
  const nrrdData = new Uint8Array(headerBytes.length + voxels.length);
  nrrdData.set(headerBytes, 0);
  nrrdData.set(voxels, headerBytes.length);
  return nrrdData;
};
