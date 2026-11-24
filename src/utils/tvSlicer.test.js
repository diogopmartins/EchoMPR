import { cross, dot, normalize, sub, vecLen } from './mprGeometry';
import { worldToFrame } from './mvSlicer';
import { buildTvSlicer } from './tvSlicer';

// En-face view from the RA: x right, y down, z into the screen = RA→RV.
// Septal leaflet at 6 o'clock (+y). Commissures: A–S lower left, A–P at the
// top, P–S lower right, so A–S → A–P → P–S runs clockwise as seen from the RA.
const C = [24, 24, 20];
const at = (deg, r) => [
  C[0] + r * Math.cos((deg * Math.PI) / 180),
  C[1] + r * Math.sin((deg * Math.PI) / 180),
  20,
];
const POINTS = {
  as: at(150, 16), // lower left (y down)
  ap: at(-90, 18), // top
  ps: at(30, 16), // lower right
  c: C,
};
const enFace = [0, 0, 1];

describe('buildTvSlicer', () => {
  const r = buildTvSlicer(POINTS, enFace);

  test('builds nine cuts, three per coaptation line, RA on top', () => {
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('tv');
    expect(r.cuts.map((c) => c.label)).toEqual([
      'A–S · inner',
      'A–S · mid',
      'A–S · outer',
      'P–S · inner',
      'P–S · mid',
      'P–S · outer',
      'A–P · inner',
      'A–P · mid',
      'A–P · outer',
    ]);
    expect(vecLen(sub(r.raToRv, [0, 0, 1]))).toBeLessThan(1e-9);
    expect(r.orientation).toEqual({ top: 'RA', bottom: 'RV' });
  });

  test('each cut is perpendicular to its coaptation line and contains the valve axis', () => {
    const ends = { 'A–S': POINTS.as, 'P–S': POINTS.ps, 'A–P': POINTS.ap };
    r.cuts.forEach((cut) => {
      const lineDir = normalize(sub(ends[cut.line], C));
      const planeNormal = normalize(cross(cut.right, cut.down));
      expect(Math.abs(dot(planeNormal, lineDir))).toBeGreaterThan(0.999);
      expect(Math.abs(dot(cut.down, [0, 0, 1]))).toBeCloseTo(1, 9);
    });
  });

  test('the leaflet named on each side of a cut is the one actually there', () => {
    r.cuts.forEach((cut) => {
      const leftPt = cut.ref.map((v, i) => v - 5 * cut.right[i]);
      const rightPt = cut.ref.map((v, i) => v + 5 * cut.right[i]);
      expect(r.segmentAt(leftPt)).toBe(cut.sideLabels.left);
      expect(r.segmentAt(rightPt)).toBe(cut.sideLabels.right);
    });
    expect(r.cuts[0].sideLabels).toEqual({ left: 'A', right: 'S' });
    expect(r.cuts[3].sideLabels).toEqual({ left: 'S', right: 'P' });
    expect(r.cuts[6].sideLabels).toEqual({ left: 'A', right: 'P' });
    expect(r.cuts[0].leaflets).toEqual({ left: 'anterior', right: 'septal' });
  });

  test('leaflet sectors', () => {
    expect(r.segmentAt(at(90, 8))).toBe('S'); // bottom
    expect(r.segmentAt(at(-150, 8))).toBe('A'); // upper left
    expect(r.segmentAt(at(-30, 8))).toBe('P'); // upper right
  });

  test('key map: septal at 6 o’clock, A–S on the left, as seen from the RA', () => {
    const { keyMap } = r;
    const septal = worldToFrame(keyMap, at(90, 10));
    const as = worldToFrame(keyMap, r.projected.as);
    const ps = worldToFrame(keyMap, r.projected.ps);
    const ap = worldToFrame(keyMap, r.projected.ap);
    expect(septal.y).toBeGreaterThan(5);
    expect(as.x).toBeLessThan(ps.x);
    expect(ap.y).toBeLessThan(0);
  });

  test('mirror-image anatomy reverses RA→RV; flip and mirror override', () => {
    const mirrored = buildTvSlicer({ ...POINTS, as: POINTS.ps, ps: POINTS.as }, enFace);
    expect(mirrored.ok).toBe(true);
    expect(dot(mirrored.raToRv, [0, 0, 1])).toBeLessThan(0);
    const flipped = buildTvSlicer(POINTS, enFace, { flipVertical: true, mirror: true });
    expect(dot(flipped.raToRv, [0, 0, 1])).toBeLessThan(0);
    expect(flipped.orientation.top).toBe('RV');
    expect(flipped.cuts[0].sideLabels).toEqual({ left: 'S', right: 'A' });
  });

  test('rejects impossible point sets', () => {
    expect(buildTvSlicer({ ...POINTS, c: at(-90, 30) }, enFace).ok).toBe(false);
    expect(buildTvSlicer({ ...POINTS, ap: at(-30, 1) }, enFace).ok).toBe(false);
    expect(buildTvSlicer({ as: POINTS.as }, enFace).ok).toBe(false);
  });
});
