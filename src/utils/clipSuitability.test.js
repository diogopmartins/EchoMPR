import { CLIP_RULES, STATUS, assessClipSites, valveLimits } from './clipSuitability';
import { buildMvSlicer } from './mvSlicer';
import { MV_POINTS, mitralPhantom } from './testPhantoms';
import { cutProfile, estimateThreshold, makeSampler } from './valveAnalysis';

/** A slicer result with `n` cuts and the given leaflet names. */
function fakeResult(kind, n, left = 'posterior', right = 'anterior') {
  return {
    kind,
    annulus: {},
    cuts: Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      label: `cut ${i + 1}`,
      leaflets: { left, right },
    })),
  };
}

/** A closed, normal-looking cut profile, with overrides. */
function prof(over = {}) {
  return {
    maxHeight: 0.5,
    maxLeaflet: 'posterior',
    gapMm: 0,
    tentingHeightMm: 3,
    leafletLengths: { left: 12, right: 20 },
    ...over,
  };
}

const statusOf = (sites) => sites.map((s) => s.status);

describe('mitral clip suitability', () => {
  test('a prolapse with long leaflets is a clip target; a normal middle cut is suitable', () => {
    const r = fakeResult('mv', 5);
    const sites = assessClipSites(r, [prof(), prof(), prof({ maxHeight: 4 }), prof(), prof()]);
    expect(sites[2].status).toBe('target');
    expect(sites[2].lesion).toBe(true);
    expect(sites[1].status).toBe('suitable');
    expect(sites[1].lesion).toBe(false);
    // The two commissural cuts are a caution
    expect(sites[0].status).toBe('caution');
    expect(sites[4].status).toBe('caution');
    expect(sites[0].reasons.map((x) => x.text).join()).toMatch(/Commissure/);
  });

  test('EVEREST limits: a flail gap of 10 mm or more, or a coaptation depth over 11 mm, is unfavourable', () => {
    const r = fakeResult('mv', 5);
    const sites = assessClipSites(r, [
      prof(),
      prof({ gapMm: CLIP_RULES.mv.flailGapMm, tentingHeightMm: null }),
      prof({ gapMm: 6, tentingHeightMm: null }),
      prof({ tentingHeightMm: 11.5 }),
      prof(),
    ]);
    expect(statusOf(sites).slice(1, 4)).toEqual(['unfavourable', 'target', 'unfavourable']);
    expect(sites[1].reasons.some((x) => /flail gap/.test(x.text))).toBe(true);
    expect(sites[3].reasons.some((x) => /Coaptation depth/.test(x.text))).toBe(true);
  });

  test('a short posterior leaflet is a caution, on whichever side it is', () => {
    const r = fakeResult('mv', 3, 'anterior', 'posterior');
    const sites = assessClipSites(r, [prof(), prof({ leafletLengths: { left: 20, right: 8 } }), prof()]);
    expect(sites[1].status).toBe('caution');
    expect(sites[1].reasons.some((x) => /Posterior leaflet 8.0 mm/.test(x.text))).toBe(true);
  });

  test('whole-valve limits are reported apart; the orifice left after a clip is per position', () => {
    const r = fakeResult('mv', 3);
    const ps = [prof(), prof({ maxHeight: 4 }), prof()];
    // A small MVA or a wide flail does not recolour the positions
    expect(statusOf(assessClipSites(r, ps))).toEqual(['caution', 'target', 'caution']);
    const limits = valveLimits(r, { mvaMm2: 350, prolapseWidthMm: 16 });
    expect(limits.map((x) => x.level)).toEqual(['caution', 'fail']);
    expect(limits[1].text).toMatch(/MVA 3.50 cm²/);
    expect(valveLimits(r, { mvaMm2: 450, prolapseWidthMm: 8 })).toEqual([]);
    expect(valveLimits(fakeResult('tv', 3), { mvaMm2: 100 })).toEqual([]);
    const after = assessClipSites(r, ps, { afterClipMm2: [300, 140, 300] });
    expect(after[1].status).toBe('caution');
    expect(after[1].reasons.some((x) => /severe stenosis/.test(x.text))).toBe(true);
  });

  test('no leaflets found: not assessed', () => {
    const r = fakeResult('mv', 3);
    const sites = assessClipSites(r, [prof(), prof({ maxHeight: null }), prof()]);
    expect(sites[1].status).toBe('unknown');
    expect(STATUS.unknown.label).toBe('Not assessed');
  });
});

describe('what is not judged', () => {
  test('without a traced annulus, leaflet lengths are not judged', () => {
    const r = { ...fakeResult('mv', 3), annulus: undefined };
    const sites = assessClipSites(r, [prof(), prof({ leafletLengths: { left: 0, right: 20 } }), prof()]);
    expect(sites[1].status).toBe('suitable');
    expect(sites[1].lengths.known).toBe(false);
    expect(sites[1].reasons.some((x) => /trace the 3D annulus/.test(x.text))).toBe(true);
  });

  test('an open frame is not judged at all', () => {
    const r = fakeResult('mv', 3);
    const sites = assessClipSites(r, [prof(), prof({ gapMm: 12, tentingHeightMm: null }), prof()], { openFrame: true });
    expect(statusOf(sites)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(sites[1].reasons[0].text).toMatch(/Open frame/);
  });
});

describe('tricuspid clip suitability', () => {
  test('a small gap is a target, a gap above about 7 mm a caution; no commissure rule', () => {
    const r = fakeResult('tv', 3, 'anterior', 'septal');
    const sites = assessClipSites(r, [
      prof({ gapMm: 5, tentingHeightMm: null }),
      prof({ gapMm: 9, tentingHeightMm: null }),
      prof(),
    ]);
    expect(statusOf(sites)).toEqual(['target', 'caution', 'suitable']);
  });
});

describe('leaflet lengths in the cuts', () => {
  const mv = mitralPhantom();
  const result = buildMvSlicer(MV_POINTS, [0, 0, 1]);

  test('both leaflets reach the coaptation in systole; a diastolic gap splits them', () => {
    const lengthsAt = (t) => {
      const sample = makeSampler(mv, t);
      const thr = estimateThreshold(sample, result).threshold;
      const p = cutProfile(sample, result, result.cuts[4], thr);
      return { p, span: p.points[p.points.length - 1].x - p.points[0].x };
    };
    // Systole (closed, P2 prolapse): both leaflets about 13 mm to the coaptation
    const sys = lengthsAt(1);
    expect(sys.p.gapMm).toBe(0);
    expect(sys.p.leafletLengths.left).toBeGreaterThan(10);
    expect(sys.p.leafletLengths.right).toBeGreaterThan(10);
    expect(sys.p.leafletLengths.coaptX).toBeCloseTo(result.cuts[4].target.x, 0);
    // Diastole (open): the leaflets end at the edges of the gap, which is not leaflet
    const dia = lengthsAt(0);
    expect(dia.p.gapMm).toBeGreaterThan(8);
    expect(dia.p.leafletLengths.coaptX).toBeNull();
    expect(dia.p.leafletLengths.left + dia.p.leafletLengths.right + dia.p.gapMm).toBeLessThan(dia.span + 1);
  });
});
