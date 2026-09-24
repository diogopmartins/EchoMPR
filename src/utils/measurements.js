import {
  viewSpec,
  distanceMm,
  polygonAreaMm2,
  planeAxes,
  measurementOnCurrentPlane,
} from './mprGeometry';

export const MEASURE_COLORS = [
  '#ffd54f',
  '#4fc3f7',
  '#81c784',
  '#ff8a65',
  '#ce93d8',
  '#f48fb1',
  '#26c6da',
  '#aed581',
  '#90caf9',
  '#ef9a9a',
  '#fff176',
  '#b39ddb',
];

export function hexToRgba(hex, alpha) {
  const n = (hex || '#ffd54f').replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pickMeasureColor(existing) {
  const used = new Set((existing || []).map((m) => m.color).filter(Boolean));
  const free = MEASURE_COLORS.find((c) => !used.has(c));
  return free || MEASURE_COLORS[(existing || []).length % MEASURE_COLORS.length];
}

export function measureColor(m) {
  return m?.color || MEASURE_COLORS[0];
}

export function formatDistance(mm) {
  if (mm < 10) return `${mm.toFixed(1)} mm`;
  return `${(mm / 10).toFixed(2)} cm`;
}

export function formatArea(mm2) {
  return `${(mm2 / 100).toFixed(2)} cm²`;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

export function measurementCaption(m) {
  if (m.type === 'distance') {
    return formatDistance(distanceMm(m.points[0], m.points[1]));
  }
  const spec = viewSpec(m.axis);
  const { right, down } = planeAxes(m.normal || [0, 0, 1], spec.worldUp);
  return formatArea(polygonAreaMm2(m.points, right, down));
}

export function isSliceMeasurementVisible(m, axis, timeIndex, volume, mprCenter, mprBasis) {
  return (
    m.axis === axis &&
    m.timeIndex === timeIndex &&
    measurementOnCurrentPlane(volume, m, mprCenter, mprBasis)
  );
}
