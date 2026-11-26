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
  cycleJumps,
  frameMetrics,
  estimateThreshold,
  heightMap,
  leafletHeight,
  makeSampler,
  mergeCutExtremes,
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
    // Caliper positions: the run measures the length and holds the highest point
    const run = p5.prolapseRun;
    expect(run.x1 - run.x0).toBeCloseTo(p5.prolapseWidthMm, 6);
    expect(p5.maxPoint.x).toBeGreaterThanOrEqual(run.x0);
    expect(p5.maxPoint.x).toBeLessThanOrEqual(run.x1);
    expect(p5.maxPoint.h).toBeCloseTo(p5.maxHeight, 6);
    expect(p5.gapRun).toBeNull();
    const p1 = cutProfile(sample, mvResult, mvResult.cuts[0], thr);
    expect(p1.maxHeight).toBeLessThan(PROLAPSE_MM);
    expect(p1.prolapseWidthMm).toBe(0);
    expect(p1.prolapseRun).toBeNull();
  });

  test('cut 5 in diastole reports the open orifice as a gap', () => {
    const p5 = cutProfile(sampleAt(DIASTOLE), mvResult, mvResult.cuts[4], thrAt(DIASTOLE));
    // The fan cut through Mid runs along y at x = 24: the hole spans 2·b = 10 mm.
    expect(p5.gapMm).toBeGreaterThan(2 * MV_ORIFICE.b - 1.5);
    expect(p5.gapMm).toBeLessThan(2 * MV_ORIFICE.b + 1);
    // Caliper: the gap spans x0 → x1 between the two leaflet edges, round the target
    const g = p5.gapRun;
    expect(g.x1 - g.x0).toBeCloseTo(p5.gapMm, 6);
    expect(g.left.x).toBeLessThan(g.x0);
    expect(g.right.x).toBeGreaterThan(g.x1);
    expect(g.x0).toBeLessThan(mvResult.cuts[4].target.x);
    expect(g.x1).toBeGreaterThan(mvResult.cuts[4].target.x);
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
      expect(p.gapRun.x1 - p.gapRun.x0).toBeCloseTo(p.gapMm, 6);
    });
    profiles.slice(3).forEach((p) => expect(p.gapMm).toBe(0));
    profiles.slice(3).forEach((p) => expect(p.gapRun).toBeNull());
  });
});

describe('cycle metrics', () => {
  test('jumps to the systolic prolapse and the diastolic orifice', () => {
    const vol = mitralPhantom();
    const result = buildMvSlicer(MV_POINTS, [0, 0, 1]);
    const frames = [0, 1].map((t) => {
      const sample = makeSampler(vol, t);
      return frameMetrics(sample, result, estimateThreshold(sample, result).threshold);
    });
    expect(frames[1].maxHeightMm).toBeGreaterThan(MV_PROLAPSE_MM - 1);
    expect(frames[0].orificeMm2).toBeGreaterThan(100);
    expect(frames[1].orificeMm2).toBeNull();
    const jumps = cycleJumps(frames);
    expect(jumps.maxProlapse).toBe(1);
    expect(jumps.largestOrifice).toBe(0);
  });

  test('systolic jumps skip open frames; the orifice skips closed ones', () => {
    const frames = [
      { coverage: 0.62, maxHeightMm: 0.5, gapMm: 12, tentingVolumeMm3: 300, orificeMm2: 170 },
      { coverage: 1, maxHeightMm: 0.6, gapMm: 0, tentingVolumeMm3: 2000, orificeMm2: null },
      { coverage: 0.92, maxHeightMm: 0.7, gapMm: 3, tentingVolumeMm3: 900, orificeMm2: 43 },
      // Nearly covered but with an orifice half the diastolic one: still open
      { coverage: 0.9, maxHeightMm: 0.5, gapMm: 7, tentingVolumeMm3: 200, orificeMm2: 88 },
    ];
    const j = cycleJumps(frames);
    expect(j.closed).toEqual([false, true, true, false]);
    expect(j.maxProlapse).toBe(2);
    expect(j.widestGap).toBe(2);
    expect(j.maxTenting).toBe(1);
    expect(j.largestOrifice).toBe(0);
  });

  test('a flat closed valve has no tenting', () => {
    const vol = mitralPhantom();
    const result = buildMvSlicer(MV_POINTS, [0, 0, 1]);
    const sample = makeSampler(vol, 1);
    const map = heightMap(sample, result, estimateThreshold(sample, result).threshold);
    // Only the leaflet thickness sits below the plane
    expect(map.stats.maxTentingMm).toBeLessThan(1);
    expect(map.stats.tentingVolumeMm3).toBeLessThan(0.2 * map.stats.foundAreaMm2);
  });
});

describe('leaflet surface search', () => {
  // Valve axis along +z (towards the ventricle); the search runs from 15 mm
  // above the plane point (z = 5) to 14 mm below it (z = 34).
  const q = [0, 0, 20];
  const down = [0, 0, 1];
  const leaflet = (z) => z >= 18 && z <= 19.5;

  test('finds the leaflet 2 mm above the plane', () => {
    const sample = (p) => (leaflet(p[2]) ? 200 : 20);
    expect(leafletHeight(sample, q, down, 100)).toBeCloseTo(2, 1);
  });

  test('tissue at the start of the search (a wall) is not read as a leaflet at +15 mm', () => {
    const sample = (p) => (p[2] < 8 || leaflet(p[2]) ? 200 : 20);
    expect(leafletHeight(sample, q, down, 100)).toBeCloseTo(2, 1);
  });

  test('all tissue: no leaflet surface', () => {
    expect(leafletHeight(() => 200, q, down, 100)).toBeNull();
  });
});

describe('summary agrees with the cuts', () => {
  test('no cut reads higher or deeper than the summary; the cycle reads the same as the panel', () => {
    const sample = sampleAt(SYSTOLE);
    const thr = thrAt(SYSTOLE);
    const map = heightMap(sample, mvResult, thr);
    const profiles = mvResult.cuts.map((cut) => cutProfile(sample, mvResult, cut, thr));
    const st = mergeCutExtremes(map.stats, profiles, mvResult);
    const cutHighest = Math.max(...profiles.filter((p) => p.maxHeight != null).map((p) => p.maxHeight));
    const cutDeepest = Math.max(0, ...profiles.filter((p) => p.tentingHeightMm != null).map((p) => p.tentingHeightMm));
    expect(st.maxHeight).toBeGreaterThanOrEqual(cutHighest);
    expect(st.maxTentingMm).toBeGreaterThanOrEqual(cutDeepest);
    // Per segment too, and the map itself is left as it was
    const segMax = Math.max(...Object.values(st.segments).map((x) => x.maxHeight ?? -Infinity));
    expect(segMax).toBeCloseTo(st.maxHeight, 6);
    expect(map.stats.maxHeight).toBeLessThanOrEqual(st.maxHeight);
    const fm = frameMetrics(sample, mvResult, thr, { withOrifice: false });
    expect(fm.maxHeightMm).toBeCloseTo(st.maxHeight, 6);
    expect(fm.maxTentingMm).toBeCloseTo(st.maxTentingMm, 6);
  });
});
