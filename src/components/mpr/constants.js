// Standard MPR RGB: sagittal=red (X), coronal=green (Y), axial=blue (Z)
export const AXIS_META = {
  sagittal: { label: 'Sagittal (X)', short: 'Sag', color: '#e53935', key: 'x' },
  coronal: { label: 'Coronal (Y)', short: 'Cor', color: '#43a047', key: 'y' },
  axial: { label: 'Axial (Z)', short: 'Ax', color: '#1e88e5', key: 'z' },
};

export const CROP_PLANES = [
  { key: 'x', axis: 'sagittal', name: 'Red' },
  { key: 'y', axis: 'coronal', name: 'Green' },
  { key: 'z', axis: 'axial', name: 'Blue' },
];

export const CINE_RATES = [0.25, 0.5, 0.75, 1];

export const DEFAULT_SECTIONS = {
  cine: true,
  tools: true,
  measure: true,
  planes: true,
  image: false,
  volume: false,
  export: false,
};

/** Zoom used by the "Fit" actions. */
export const FIT_ZOOM = 1.35;
