import * as dicomParser from 'dicom-parser';
import {
  buildPhilipsVolume,
  readElementNumber,
  applyWindowLevel,
  getVolumeAtTime,
  sampleSlice,
  renderSliceToCanvas,
  physicalSizeMm,
} from './philipsVolume';

export {
  buildPhilipsVolume,
  applyWindowLevel,
  getVolumeAtTime,
  sampleSlice,
  renderSliceToCanvas,
  physicalSizeMm,
};

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
  dicomData.is4D = Boolean(volume && volume.dims.t > 1);
  dicomData.isVolume = Boolean(volume && volume.dims.z > 1);
  dicomData.frameCount = volume ? volume.dims.t : dicomData.numberOfFrames;

  if (volume) {
    dicomData.pixelArray = volume.voxels;
  } else if (dataSet.elements.x7fe00010) {
    const pe = dataSet.elements.x7fe00010;
    dicomData.pixelArray = new Uint8Array(arrayBuffer, pe.dataOffset, pe.length);
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

/** 2D preview from mid-volume axial slice */
export const createImageFromDicom = (dicomData, frameIndex = 0) => {
  if (dicomData.volume) {
    const midZ = Math.floor(dicomData.volume.dims.z / 2);
    const slice = sampleSlice(dicomData.volume, 'axial', midZ, frameIndex);
    const canvas = document.createElement('canvas');
    renderSliceToCanvas(
      canvas,
      slice,
      dicomData.windowCenter,
      dicomData.windowWidth
    );
    return canvas;
  }

  if (!dicomData.pixelArray || !dicomData.rows || !dicomData.columns) {
    throw new Error('Invalid DICOM data for image creation');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = dicomData.columns;
  canvas.height = dicomData.rows;
  const imageData = ctx.createImageData(dicomData.columns, dicomData.rows);
  const data = imageData.data;
  const pixelArray = dicomData.pixelArray;

  for (let i = 0; i < dicomData.rows * dicomData.columns; i++) {
    const v = applyWindowLevel(
      pixelArray[i],
      dicomData.windowCenter,
      dicomData.windowWidth
    );
    const index = i * 4;
    data[index] = v;
    data[index + 1] = v;
    data[index + 2] = v;
    data[index + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

export const exportToNRRD = (dicomData, frameIndex = 0) => {
  if (!dicomData.volume) {
    throw new Error('No volume data available');
  }

  const vol = dicomData.volume;
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

export const extractTimeframe = (dicomData, frameIndex) => {
  if (!dicomData.volume) {
    throw new Error('Not a volume dataset');
  }
  return {
    ...dicomData,
    pixelArray: getVolumeAtTime(dicomData.volume, frameIndex),
    frameIndex,
    isSingleFrame: true,
  };
};
