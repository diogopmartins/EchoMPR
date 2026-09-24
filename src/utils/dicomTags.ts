import type { DataSet } from 'dicom-parser';

/** Tags used by the loader, in dicom-parser's `xGGGGEEEE` form. */
export const TAG = {
  manufacturer: 'x00080070',
  modality: 'x00080060',
  studyDate: 'x00080020',
  studyTime: 'x00080030',
  imageType: 'x00080008',
  manufacturerModelName: 'x00081090',
  patientName: 'x00100010',
  patientId: 'x00100020',
  frameTime: 'x00181063',
  heartRate: 'x00181088',
  physicalDeltaX: 'x0018602c',
  physicalDeltaY: 'x0018602e',
  imageComments: 'x00204000',
  samplesPerPixel: 'x00280002',
  photometricInterpretation: 'x00280004',
  numberOfFrames: 'x00280008',
  rows: 'x00280010',
  columns: 'x00280011',
  bitsAllocated: 'x00280100',
  bitsStored: 'x00280101',
  windowCenter: 'x00281050',
  windowWidth: 'x00281051',
  /** Philips 3D private: number of Z slices per temporal frame. */
  philipsZCount: 'x30011001',
  /** Philips 3D private: dimensionality flag (3 for Cartesian volumes). */
  philipsDimFlag: 'x30011002',
  /** Philips 3D private: Z spacing in cm. */
  philipsSpacingZ: 'x30011003',
  waveformSequence: 'x54000100',
  pixelData: 'x7fe00010',
} as const;

/**
 * Read a numeric tag regardless of its VR. Multi-valued DS/IS strings return
 * the first value. Returns null when the tag is absent or empty.
 */
export function readElementNumber(dataSet: DataSet, tag: string): number | null {
  const element = dataSet.elements[tag];
  if (!element || element.length === 0) return null;

  const orNull = (v: number | undefined) => (v === undefined ? null : v);
  switch (element.vr) {
    case 'UL':
      return orNull(dataSet.uint32(tag));
    case 'US':
      return orNull(dataSet.uint16(tag));
    case 'SS':
      return orNull(dataSet.int16(tag));
    case 'SL':
      return orNull(dataSet.int32(tag));
    case 'FD':
      return orNull(dataSet.double(tag));
    case 'FL':
      return orNull(dataSet.float(tag));
    case 'DS':
    case 'IS': {
      const str = dataSet.string(tag);
      if (!str) return null;
      return parseFloat(str.split('\\')[0]);
    }
    default: {
      // Fallbacks when VR is missing/unknown
      if (element.length === 4) return orNull(dataSet.uint32(tag));
      if (element.length === 8) return orNull(dataSet.double(tag));
      if (element.length === 2) return orNull(dataSet.uint16(tag));
      const str = dataSet.string(tag);
      return str ? parseFloat(str) : null;
    }
  }
}

/** Read a string tag; '' when absent, empty, or unreadable. */
export function readElementString(dataSet: DataSet, tag: string): string {
  const element = dataSet.elements[tag];
  if (!element || element.length === 0) return '';
  try {
    return dataSet.string(tag) || '';
  } catch {
    return '';
  }
}
