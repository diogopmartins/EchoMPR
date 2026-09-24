import * as dicomParser from 'dicom-parser';
import { buildPhilipsVolume, getVolumeAtTime } from './philipsVolume';
import { TAG, readElementNumber, readElementString } from './dicomTags';
import { extractEcg } from './ecg';
import type { Volume } from './types';

export interface DicomData {
  patientName: string;
  patientId: string;
  studyDate: string;
  studyTime: string;
  modality: string;
  manufacturer: string;
  manufacturerModelName: string;
  imageType: string;
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  samplesPerPixel: number;
  photometricInterpretation: string;
  windowCenter: number;
  windowWidth: number;
  imageComments: string;
  numberOfFrames: number;
  frameTime: number;
  fileName: string;
  fileSize: number;
  volume: Volume | null;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Parse DICOM bytes already in memory. Returns metadata + optional Philips 4D
 * volume (with its ECG trace when the file carries one).
 */
export function parseDicomBuffer(
  arrayBuffer: ArrayBuffer,
  fileInfo: { name?: string; size?: number } = {}
): DicomData {
  const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
  const str = (tag: string) => readElementString(dataSet, tag);
  const num = (tag: string) => readElementNumber(dataSet, tag);

  let volume: Volume | null = null;
  try {
    volume = buildPhilipsVolume(dataSet, arrayBuffer);
  } catch (err) {
    console.warn('Volume build failed:', errorMessage(err));
  }

  if (volume) {
    try {
      volume.ecg = extractEcg(dataSet, arrayBuffer);
    } catch (err) {
      console.warn('ECG extract failed:', errorMessage(err));
    }
  }

  return {
    patientName: str(TAG.patientName),
    patientId: str(TAG.patientId),
    studyDate: str(TAG.studyDate),
    studyTime: str(TAG.studyTime),
    modality: str(TAG.modality),
    manufacturer: str(TAG.manufacturer),
    manufacturerModelName: str(TAG.manufacturerModelName),
    imageType: str(TAG.imageType),
    rows: num(TAG.rows) || 0,
    columns: num(TAG.columns) || 0,
    bitsAllocated: num(TAG.bitsAllocated) || 8,
    bitsStored: num(TAG.bitsStored) || 8,
    samplesPerPixel: num(TAG.samplesPerPixel) || 1,
    photometricInterpretation: str(TAG.photometricInterpretation),
    windowCenter: num(TAG.windowCenter) || 128,
    windowWidth: num(TAG.windowWidth) || 256,
    imageComments: str(TAG.imageComments),
    numberOfFrames: num(TAG.numberOfFrames) || 1,
    frameTime: num(TAG.frameTime) || 0,
    fileName: fileInfo.name || 'dicom',
    fileSize: fileInfo.size || arrayBuffer.byteLength,
    volume,
  };
}

/** Parse a DICOM File/Blob picked or dropped by the user. */
export async function parseDicomFile(
  file: File,
  options: { onProgress?: (ratio: number) => void } = {}
): Promise<DicomData> {
  const arrayBuffer = await readFileAsArrayBuffer(file, options.onProgress);
  return parseDicomBuffer(arrayBuffer, file);
}

function readFileAsArrayBuffer(
  file: Blob,
  onProgress?: (ratio: number) => void
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/** One timepoint as an uncompressed NRRD (unsigned char, mm spacing). */
export function exportToNRRD(vol: Volume | null, frameIndex = 0): Uint8Array {
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
}
