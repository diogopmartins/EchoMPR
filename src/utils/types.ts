/**
 * Shared types for the volume, MPR geometry, and measurement helpers.
 *
 * Coordinate spaces are kept structurally distinct so the compiler catches
 * unit mix-ups:
 * - `Vec3` tuples are volume-local millimetres (or unit directions).
 * - `VoxelCoord` objects are continuous voxel indices.
 * - `ImagePoint` / `ImageDir` are pixels / directions in a sampled slice.
 */

export type Vec3 = [number, number, number];

export interface VoxelCoord {
  x: number;
  y: number;
  z: number;
}

export type AxisKey = 'x' | 'y' | 'z';

/** Orthonormal MPR triad: each key is that plane's normal, in mm-space. */
export type Basis = Record<AxisKey, Vec3>;

export type ViewAxis = 'axial' | 'coronal' | 'sagittal';

export interface ImagePoint {
  u: number;
  v: number;
}

export type ImageDir = ImagePoint;

export interface VolumeDims {
  t: number;
  z: number;
  y: number;
  x: number;
}

export interface VolumeMeta {
  patientName: string;
  patientId: string;
  studyDate: string;
  modality: string;
  manufacturer: string;
  imageComments: string;
}

export interface EcgTrace {
  source: 'dicom-waveform';
  label: string;
  samples: Float32Array;
  sampleHz: number;
  durationMs: number;
  /** Sample indices of detected R peaks. */
  beats: number[];
  heartRateBpm: number | null;
}

/** 4D Cartesian volume, voxels packed as (T, Z, Y, X). */
export interface Volume {
  dims: VolumeDims;
  spacingCm: VoxelCoord;
  frameTimeMs: number;
  bitsAllocated: number;
  samplesPerPixel: number;
  isPhilipsCartesian: boolean;
  voxels: Uint8Array;
  /** Voxels per timepoint (Z × Y × X). */
  volumeSize: number;
  meta: VolumeMeta;
  ecg?: EcgTrace | null;
}

export interface SliceLineDir extends ImageDir {
  color: string;
  planeKey: AxisKey;
}

/** A plane resampled from the volume for display in a 2D pane. */
export interface SampledSlice {
  data: Uint8Array;
  width: number;
  height: number;
  axis: ViewAxis;
  center: VoxelCoord;
  viewOrigin: VoxelCoord;
  right: Vec3;
  down: Vec3;
  pixelMm: number;
  stepX: number;
  stepY: number;
  zoom: number;
  crossU: number;
  crossV: number;
  dirs: { a: SliceLineDir; b: SliceLineDir };
  normalKey: AxisKey;
}

/** The 2D plane a measurement was drawn on, frozen at creation time. */
export interface MeasurementPlane {
  axis: ViewAxis;
  normal: Vec3;
  originMm: Vec3;
  center: VoxelCoord;
  basis: Basis;
}

export interface Measurement extends MeasurementPlane {
  id: string;
  type: 'distance' | 'area';
  /** World-mm points: two for a distance, three or more for an area. */
  points: Vec3[];
  label: string;
  timeIndex: number;
  color?: string;
}
