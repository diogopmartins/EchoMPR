import { buildMvSlicer } from './mvSlicer';
import { buildTvSlicer } from './tvSlicer';
import {
  MV_ORIFICE,
  MV_POINTS,
  MV_PROLAPSE_MM,
  TV_GAP_MM,
  TV_POINTS,
  mitralPhantom,
  tricuspidPhantom,
} from './testPhantoms';
import {
  PROLAPSE_MM,
  clipSiteForCut,
  cutProfile,
  estimateThreshold,
  heightMap,
  makeSampler,
  orificeOverCycle,
  teerCriteria,
  teerMeasures,
  virtualClip,
} from './valveAnalysis';

const mv = mitralPhantom();
const mvResult = buildMvSlicer(MV_POINTS, [0, 0, 1]);
const DIASTOLE = 0;
const SYSTOLE = 1;
const sampleAt = (t) => makeSampler(mv, t);
const thrAt = (t) => estimateThreshold(sampleAt(t), mvResult).threshold;

describe('tissue threshold', () => {
  test('sits between blood (~22) and leaflet tissue (215)', () => {
    const { threshold, blood, tissue } = estimateThreshold(sampleAt(SYSTOLE), mvResult);
    expect(blood).toBeLessThan(40);
    expect(tissue).toBeGreaterThan(180);
    expect(threshold).toBeGreaterThan(60);
    expect(threshold).toBeLessThan(160);
  });
});

describe('prolapse height map', () => {
  test('finds the P2 prolapse in systole and nothing else', () => {
    const map = heightMap(sampleAt(SYSTOLE), mvResult, thrAt(SYSTOLE));
    const { stats } = map;
    expect(stats.maxSegment).toBe('P2');
    expect(stats.maxHeight).toBeGreaterThan(MV_PROLAPSE_MM - 0.5);
    expect(stats.maxHeight).toBeLessThan(MV_PROLAPSE_MM + 1.2);
    expect(stats.segments.P2.prolapseAreaMm2).toBeGreaterThan(10);
    // The bump spans x 20–28 mm; above 2 mm it is narrower than that.
    expect(stats.prolapseWidthMm).toBeGreaterThan(3);
    expect(stats.prolapseWidthMm).toBeLessThan(8);
    ['A1', 'A2', 'A3', 'P1', 'P3'].forEach((s) => {
      expect(stats.segments[s].maxHeight).toBeLessThan(PROLAPSE_MM);
      expect(stats.segments[s].prolapseAreaMm2).toBe(0);
    });
  });

  test('a flat open valve in diastole shows no prolapse', () => {
    const { stats } = heightMap(sampleAt(DIASTOLE), mvResult, thrAt(DIASTOLE));
    expect(stats.maxHeight).toBeLessThan(1.2);
    expect(stats.prolapseAreaMm2).toBe(0);
  });
});

describe('per-cut leaflet traces', () => {
  test('cut 5 (A2/P2) measures the posterior prolapse; the commissures do not', () => {
    const sample = sampleAt(SYSTOLE);
    const thr = thrAt(SYSTOLE);
    const p5 = cutProfile(sample, mvResult, mvResult.cuts[4], thr);
    expect(p5.maxHeight).toBeGreaterThan(MV_PROLAPSE_MM - 0.5);
    expect(p5.maxLeaflet).toBe('posterior');
    expect(p5.prolapseWidthMm).toBeGreaterThan(2);
    expect(p5.prolapseWidthMm).toBeLessThan(8);
    expect(p5.gapMm).toBe(0);
    const p1 = cutProfile(sample, mvResult, mvResult.cuts[0], thr);
    expect(p1.maxHeight).toBeLessThan(PROLAPSE_MM);
    expect(p1.prolapseWidthMm).toBe(0);
  });

  test('cut 5 in diastole reports the open orifice as a gap', () => {
    const p5 = cutProfile(sampleAt(DIASTOLE), mvResult, mvResult.cuts[4], thrAt(DIASTOLE));
    // The fan cut through Mid runs along y at x = 24: the hole spans 2·b = 10 mm.
    expect(p5.gapMm).toBeGreaterThan(2 * MV_ORIFICE.b - 1.5);
    expect(p5.gapMm).toBeLessThan(2 * MV_ORIFICE.b + 1);
  });
});

describe('orifice planimetry and virtual clip', () => {
  const cycle = orificeOverCycle(mv, mvResult, mvResult.projected.mid, (s) =>
    estimateThreshold(s, mvResult).threshold
  );
  const trueArea = Math.PI * MV_ORIFICE.a * MV_ORIFICE.b;

  test('MVA is the diastolic orifice area', () => {
    expect(cycle.bestFrame).toBe(DIASTOLE);
    expect(Math.abs(cycle.best.areaMm2 - trueArea) / trueArea).toBeLessThan(0.1);
  });

  test('a 4 mm device closes an 8 mm band across the orifice', () => {
    const { site, coaptDir } = clipSiteForCut(mvResult, mvResult.cuts[4]);
    const clip = virtualClip(cycle.best, mvResult, site, coaptDir, 4);
    expect(clip.bandMm).toBe(8);
    // Ellipse area outside |x − 24| < 4 (the clip is at x = 24, coaptation along x)
    const { a, b } = MV_ORIFICE;
    let band = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const x = -4 + (8 * (i + 0.5)) / n;
      band += 2 * b * Math.sqrt(Math.max(0, 1 - (x * x) / (a * a))) * (8 / n);
    }
    const expected = trueArea - band;
    expect(Math.abs(clip.afterMm2 - expected) / expected).toBeLessThan(0.15);
    expect(Math.abs(clip.sideAMm2 - clip.sideBMm2) / clip.afterMm2).toBeLessThan(0.15);
  });
});

describe('TEER measurements and criteria', () => {
  const cut = mvResult.cuts[4]; // left = posterior, right = anterior
  const pts = {
    hingeL: { x: -40, y: 0 },
    hingeR: { x: -12, y: 0 },
    coapt: { x: -27, y: 6 },
    tipL: { x: -27, y: 9 },
    tipR: { x: -26, y: 8 },
  };

  test('lengths, depth, coaptation length and gap', () => {
    const m = teerMeasures(pts, cut, 1);
    expect(m.annulusMm).toBeCloseTo(28, 6);
    expect(m.lengthLMm).toBeCloseTo(Math.hypot(13, 9), 6);
    expect(m.lengthRMm).toBeCloseTo(Math.hypot(14, 8), 6);
    expect(m.coaptDepthMm).toBeCloseTo(6, 6);
    expect(m.coaptLengthMm).toBeCloseTo(Math.hypot(0.5, 2.5), 6);
    expect(m.tipGapMm).toBeCloseTo(Math.hypot(1, 1), 6);
  });

  test('criteria pass and fail as expected', () => {
    const m = teerMeasures(pts, cut, 1);
    const rows = teerCriteria({ measures: m, flailWidthMm: 18, mvaMm2: 350 });
    const ok = Object.fromEntries(rows.map((r) => [r.label, r.ok]));
    expect(ok['Coaptation length']).toBe(true);
    expect(ok['Coaptation depth']).toBe(true);
    expect(ok['Tip-to-tip (flail) gap']).toBe(true);
    expect(ok['Prolapse width (this frame)']).toBe(false);
    expect(ok['Posterior leaflet length']).toBe(true);
    expect(ok['MVA (planimetry)']).toBe(false);
    expect(teerCriteria({}).every((r) => r.ok === null)).toBe(true);
    // Before any TEER point is placed the measures are null
    expect(teerCriteria({ measures: null, mvaMm2: 450 }).find((r) => r.label === 'MVA (planimetry)').ok).toBe(true);
  });
});

describe('tricuspid gap', () => {
  const tv = tricuspidPhantom();
  const tvResult = buildTvSlicer(TV_POINTS, [0, 0, 1]);
  const sample = makeSampler(tv, 0);
  const thr = estimateThreshold(sample, tvResult).threshold;

  test('cuts across the A–S line measure the gap; the other lines are closed', () => {
    const profiles = tvResult.cuts.map((cut) => cutProfile(sample, tvResult, cut, thr));
    profiles.slice(0, 3).forEach((p) => {
      expect(p.gapMm).toBeGreaterThan(TV_GAP_MM - 1);
      expect(p.gapMm).toBeLessThan(TV_GAP_MM + 1);
    });
    profiles.slice(3).forEach((p) => expect(p.gapMm).toBe(0));
  });
});
