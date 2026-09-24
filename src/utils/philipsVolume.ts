/**
 * Philips QLAB Cartesian 4D echo volume helpers.
 * Layout: voxels[t][z][y][x] packed as (T, Z, Y, X)
 */
import type { DataSet } from 'dicom-parser';
import { TAG, readElementNumber, readElementString } from './dicomTags';
import type { Volume, VoxelCoord } from './types';

export function applyWindowLevel(
  value: number,
  windowCenter?: number | null,
  windowWidth?: number | null
): number {
  const wc = windowCenter ?? 128;
  const ww = Math.max(1, windowWidth ?? 256);
  const min = wc - ww / 2;
  const max = wc + ww / 2;
  if (value <= min) return 0;
  if (value >= max) return 255;
  return Math.round(((value - min) / (max - min)) * 255);
}

/**
 * Build a 4D Cartesian volume from a parsed dicom-parser DataSet + ArrayBuffer.
 */
export function buildPhilipsVolume(dataSet: DataSet, arrayBuffer: ArrayBuffer): Volume {
  const rows = readElementNumber(dataSet, TAG.rows); // Y
  const columns = readElementNumber(dataSet, TAG.columns); // X
  const numberOfFrames = readElementNumber(dataSet, TAG.numberOfFrames) || 1;
  const frameTimeMs = readElementNumber(dataSet, TAG.frameTime) || 50;
  const bitsAllocated = readElementNumber(dataSet, TAG.bitsAllocated) || 8;
  const samplesPerPixel = readElementNumber(dataSet, TAG.samplesPerPixel) || 1;

  const zCount = readElementNumber(dataSet, TAG.philipsZCount);
  const dimFlag = readElementNumber(dataSet, TAG.philipsDimFlag);
  const spacingZ = readElementNumber(dataSet, TAG.philipsSpacingZ);
  const spacingX = readElementNumber(dataSet, TAG.physicalDeltaX); // cm
  const spacingY = readElementNumber(dataSet, TAG.physicalDeltaY); // cm

  const pixelElement = dataSet.elements[TAG.pixelData];
  if (!pixelElement) {
    throw new Error('DICOM PixelData (7FE0,0010) not found');
  }
  if (!rows || !columns) {
    throw new Error('Missing Rows/Columns');
  }

  const bytesPerSample = bitsAllocated / 8;
  const sliceBytes = rows * columns * samplesPerPixel * bytesPerSample;
  const totalBytes = pixelElement.length;
  const totalSlices = Math.floor(totalBytes / sliceBytes);

  let tCount = numberOfFrames;
  let z: number;

  const isPhilipsCartesian = Boolean(zCount && dimFlag === 3);

  if (zCount && isPhilipsCartesian) {
    z = zCount;
    // NumberOfFrames is temporal count; each "frame" packs Z slices
    if (totalSlices !== tCount * z) {
      // Recover from pixel math if tags disagree
      if (totalSlices % z === 0) {
        tCount = totalSlices / z;
      } else if (totalSlices % tCount === 0) {
        z = totalSlices / tCount;
      } else {
        throw new Error(
          `PixelData size mismatch: ${totalSlices} slices vs T=${tCount} × Z=${z}`
        );
      }
    }
  } else if (totalSlices > 1) {
    // Generic multi-frame fallback: treat as a single Z stack
    z = totalSlices;
    tCount = 1;
  } else {
    z = 1;
    tCount = 1;
  }

  const voxels = new Uint8Array(arrayBuffer, pixelElement.dataOffset, totalBytes);
  const volumeSize = z * rows * columns;

  return {
    dims: { t: tCount, z, y: rows, x: columns },
    spacingCm: {
      x: spacingX || 0.1,
      y: spacingY || 0.1,
      z: spacingZ || 0.1,
    },
    frameTimeMs,
    bitsAllocated,
    samplesPerPixel,
    isPhilipsCartesian,
    voxels,
    volumeSize,
    meta: {
      patientName: readElementString(dataSet, TAG.patientName),
      patientId: readElementString(dataSet, TAG.patientId),
      studyDate: readElementString(dataSet, TAG.studyDate),
      modality: readElementString(dataSet, TAG.modality),
      manufacturer: readElementString(dataSet, TAG.manufacturer),
      imageComments: readElementString(dataSet, TAG.imageComments),
    },
  };
}

export function getVolumeAtTime(volume: Volume, t: number): Uint8Array {
  const ti = Math.max(0, Math.min(volume.dims.t - 1, t | 0));
  const start = ti * volume.volumeSize;
  return volume.voxels.subarray(start, start + volume.volumeSize);
}

/**
 * Echo-style display: window/level + soft contrast curve (closer to cart display).
 */
export function applyEchoDisplay(
  value: number,
  windowCenter?: number | null,
  windowWidth?: number | null
): number {
  let v = applyWindowLevel(value, windowCenter, windowWidth) / 255;
  // Lift mid-grays, gentle gamma like ultrasound cart post-processing
  v = Math.pow(Math.max(0, v), 0.85);
  v = v * 1.08;
  if (v > 1) v = 1;
  return Math.round(v * 255);
}

/**
 * Draw a raw intensity slice onto a canvas with window/level.
 */
export function renderSliceToCanvas(
  canvas: HTMLCanvasElement | null,
  slice: { data: Uint8Array; width: number; height: number } | null,
  windowCenter?: number | null,
  windowWidth?: number | null
): void {
  if (!canvas || !slice) return;
  const { data, width, height } = slice;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const imageData = ctx.createImageData(width, height);
  const rgba = imageData.data;

  for (let i = 0; i < data.length; i++) {
    const v = applyEchoDisplay(data[i], windowCenter, windowWidth);
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

export function physicalSizeMm(volume: Pick<Volume, 'dims' | 'spacingCm'>): VoxelCoord {
  const { dims, spacingCm } = volume;
  return {
    x: dims.x * spacingCm.x * 10,
    y: dims.y * spacingCm.y * 10,
    z: dims.z * spacingCm.z * 10,
  };
}
