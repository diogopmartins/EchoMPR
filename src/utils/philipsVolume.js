/**
 * Philips QLAB Cartesian 4D echo volume helpers.
 * Layout: voxels[t][z][y][x] packed as (T, Z, Y, X)
 */

export function readElementNumber(dataSet, tag) {
  const element = dataSet.elements[tag];
  if (!element || element.length === 0) return null;

  const vr = element.vr;
  switch (vr) {
    case 'UL':
      return dataSet.uint32(tag);
    case 'US':
      return dataSet.uint16(tag);
    case 'SS':
      return dataSet.int16(tag);
    case 'SL':
      return dataSet.int32(tag);
    case 'FD':
      return dataSet.double(tag);
    case 'FL':
      return dataSet.float(tag);
    case 'DS':
    case 'IS': {
      const str = dataSet.string(tag);
      if (!str) return null;
      return parseFloat(str.split('\\')[0]);
    }
    default: {
      // Fallbacks when VR is missing/unknown
      if (element.length === 4) return dataSet.uint32(tag);
      if (element.length === 8) return dataSet.double(tag);
      if (element.length === 2) return dataSet.uint16(tag);
      const str = dataSet.string(tag);
      return str ? parseFloat(str) : null;
    }
  }
}

export function applyWindowLevel(value, windowCenter, windowWidth) {
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
export function buildPhilipsVolume(dataSet, arrayBuffer) {
  const rows = readElementNumber(dataSet, 'x00280010'); // Y
  const columns = readElementNumber(dataSet, 'x00280011'); // X
  const numberOfFrames = readElementNumber(dataSet, 'x00280008') || 1;
  const frameTimeMs = readElementNumber(dataSet, 'x00181063') || 50;
  const bitsAllocated = readElementNumber(dataSet, 'x00280100') || 8;
  const samplesPerPixel = readElementNumber(dataSet, 'x00280002') || 1;

  const zCount = readElementNumber(dataSet, 'x30011001');
  const dimFlag = readElementNumber(dataSet, 'x30011002');
  const spacingZ = readElementNumber(dataSet, 'x30011003');
  const spacingX = readElementNumber(dataSet, 'x0018602c'); // PhysicalDeltaX (cm)
  const spacingY = readElementNumber(dataSet, 'x0018602e'); // PhysicalDeltaY (cm)

  const pixelElement = dataSet.elements.x7fe00010;
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
  let z = zCount;

  const isPhilipsCartesian = Boolean(zCount && dimFlag === 3);

  if (isPhilipsCartesian) {
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
    // Generic multi-frame fallback: treat as T volumes of single slice, or Z stack
    z = totalSlices;
    tCount = 1;
  } else {
    z = 1;
    tCount = 1;
  }

  const voxels =
    bitsAllocated === 8
      ? new Uint8Array(arrayBuffer, pixelElement.dataOffset, totalBytes)
      : new Uint8Array(arrayBuffer, pixelElement.dataOffset, totalBytes);

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
      patientName: dataSet.string('x00100010') || '',
      patientId: dataSet.string('x00100020') || '',
      studyDate: dataSet.string('x00080020') || '',
      modality: dataSet.string('x00080060') || '',
      manufacturer: dataSet.string('x00080070') || '',
      imageComments: dataSet.string('x00204000') || '',
    },
  };
}

export function volumeIndex(volume, t, z, y, x) {
  const { dims, volumeSize } = volume;
  return (
    t * volumeSize +
    z * (dims.y * dims.x) +
    y * dims.x +
    x
  );
}

export function getVolumeAtTime(volume, t) {
  const ti = Math.max(0, Math.min(volume.dims.t - 1, t | 0));
  const start = ti * volume.volumeSize;
  return volume.voxels.subarray(start, start + volume.volumeSize);
}

/**
 * Extract an orthogonal slice as Uint8Array (raw intensities).
 * axis: 'axial' (Z), 'coronal' (Y), 'sagittal' (X)
 */
export function sampleSlice(volume, axis, index, t = 0) {
  const { dims } = volume;
  const ti = Math.max(0, Math.min(dims.t - 1, t | 0));
  const vol = getVolumeAtTime(volume, ti);

  if (axis === 'axial') {
    const zi = clampIndex(index, dims.z);
    const width = dims.x;
    const height = dims.y;
    const out = new Uint8Array(width * height);
    const planeOffset = zi * dims.y * dims.x;
    out.set(vol.subarray(planeOffset, planeOffset + width * height));
    return { data: out, width, height, axis, index: zi };
  }

  if (axis === 'coronal') {
    const yi = clampIndex(index, dims.y);
    const width = dims.x;
    const height = dims.z;
    const out = new Uint8Array(width * height);
    for (let z = 0; z < dims.z; z++) {
      const src = z * dims.y * dims.x + yi * dims.x;
      const dst = z * width;
      out.set(vol.subarray(src, src + width), dst);
    }
    return { data: out, width, height, axis, index: yi };
  }

  // sagittal
  const xi = clampIndex(index, dims.x);
  const width = dims.y;
  const height = dims.z;
  const out = new Uint8Array(width * height);
  for (let z = 0; z < dims.z; z++) {
    for (let y = 0; y < dims.y; y++) {
      out[z * width + y] = vol[z * dims.y * dims.x + y * dims.x + xi];
    }
  }
  return { data: out, width, height, axis, index: xi };
}

function clampIndex(index, size) {
  return Math.max(0, Math.min(size - 1, Math.round(index)));
}

/**
 * Draw a raw intensity slice onto a canvas with window/level.
 */
export function renderSliceToCanvas(canvas, slice, windowCenter, windowWidth) {
  if (!canvas || !slice) return;
  const { data, width, height } = slice;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.createImageData(width, height);
  const rgba = imageData.data;

  for (let i = 0; i < data.length; i++) {
    const v = applyWindowLevel(data[i], windowCenter, windowWidth);
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

export function physicalSizeMm(volume) {
  const { dims, spacingCm } = volume;
  return {
    x: dims.x * spacingCm.x * 10,
    y: dims.y * spacingCm.y * 10,
    z: dims.z * spacingCm.z * 10,
  };
}
