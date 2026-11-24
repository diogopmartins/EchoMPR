import { aortoMitralAngle, annulusReference, fitAnnulus, withAnnulus } from './annulusFit';
import { buildMvSlicer } from './mvSlicer';
import { SADDLE, SADDLE_MV_POINTS, saddleAnnulusPoint, saddlePhantom } from './testPhantoms';
import { cutProfile, estimateThreshold, frameMetrics, heightMap, makeSampler, orificeAt, orificeSeed } from './valveAnalysis';

const UP = [0, 0, -1];
const ring = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => saddleAnnulusPoint(offset + (2 * Math.PI * i) / n));

describe('fitAnnulus', () => {
  test('needs at least five points', () => {
    expect(fitAnnulus(ring(4), { up: UP })).toBeNull();
  });

  test('recovers the size and saddle of an elliptic saddle annulus', () => {
    const fit = fitAnnulus(ring(18, 0.1), { up: UP, directions: { cc: [1, 0, 0], ap: [0, 1, 0] } });
    const m = fit.metrics;
    expect(fit.normal[2]).toBeLessThan(-0.99);
    expect(m.diameters.cc).toBeCloseTo(2 * SADDLE.a, 0);
    expect(m.diameters.ap).toBeCloseTo(2 * SADDLE.b, 0);
    expect(m.maxDiameterMm).toBeCloseTo(2 * SADDLE.a, 0);
    expect(m.minDiameterMm).toBeCloseTo(2 * SADDLE.b, 0);
    expect(m.heightMm).toBeCloseTo(2 * SADDLE.s, 0);
    expect(m.ahcwrPercent).toBeCloseTo((100 * 2 * SADDLE.s) / (2 * SADDLE.a), 0);
    const ellipseArea = Math.PI * SADDLE.a * SADDLE.b;
    expect(Math.abs(m.area2dMm2 - ellipseArea) / ellipseArea).toBeLessThan(0.02);
    expect(m.area3dMm2).toBeGreaterThan(m.area2dMm2);
    // Ramanujan's perimeter of the ellipse; the saddle makes the 3D curve a bit longer
    const { a, b } = SADDLE;
    const ellipsePerimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    expect(m.perimeterMm).toBeGreaterThan(ellipsePerimeter);
    expect(m.perimeterMm).toBeLessThan(ellipsePerimeter * 1.05);
  });

  test('hinges bunched on one side (fan cuts) do not tilt the plane or inflate the saddle', () => {
    const deg = (d) => (d * Math.PI) / 180;
    const anterior = Array.from({ length: 9 }, (_, i) => saddleAnnulusPoint(deg(-119 + (58 * i) / 8)));
    const posterior = Array.from({ length: 9 }, (_, i) => saddleAnnulusPoint(deg(8 + (164 * i) / 8)));
    const fit = fitAnnulus([...anterior, ...posterior], { up: UP });
    expect(fit.normal[2]).toBeLessThan(-0.999);
    expect(Math.abs(fit.metrics.heightMm - 2 * SADDLE.s)).toBeLessThan(0.3);
  });

  test('saddle reference matches the annulus on the rim and the harmonic surface inside', () => {
    const fit = fitAnnulus(ring(24), { up: UP });
    const ref = annulusReference(fit, UP, 'saddle');
    const plane = annulusReference(fit, UP, 'plane');
    // At the anterior horn the annulus is s mm above the picked plane (z = 20)
    const horn = saddleAnnulusPoint(-Math.PI / 2);
    expect(ref([horn[0], horn[1], 20])).toBeCloseTo(SADDLE.s, 0);
    expect(plane([horn[0], horn[1], 20])).toBeCloseTo(0, 1);
    // At the centre the harmonic surface is level with the plane
    expect(ref([SADDLE.cx, SADDLE.cy, 20])).toBeCloseTo(0, 0);
  });
});

describe('heights from the annulus', () => {
  const vol = saddlePhantom();
  const sample = makeSampler(vol, 0);
  const result = buildMvSlicer(SADDLE_MV_POINTS, [0, 0, 1]);
  const fit = fitAnnulus(ring(18, 0.05), {
    up: UP,
    directions: { cc: result.chord, ap: result.anterior },
  });

  test('a flat reference shows the saddle horns as prolapse; the saddle does not', () => {
    const thr = estimateThreshold(sample, result).threshold;
    const flat = heightMap(sample, withAnnulus(result, fit, 'plane'), thr);
    const saddle = heightMap(sample, withAnnulus(result, fit, 'saddle'), thr);
    expect(flat.stats.maxHeight).toBeGreaterThan(2);
    expect(saddle.stats.maxHeight).toBeLessThan(1);
  });

  test('tenting height and volume relative to the saddle', () => {
    const r = withAnnulus(result, fit, 'saddle');
    const thr = estimateThreshold(sample, r).threshold;
    const map = heightMap(sample, r, thr);
    expect(map.stats.maxTentingMm).toBeGreaterThan(SADDLE.tent - 1);
    expect(map.stats.maxTentingMm).toBeLessThan(SADDLE.tent + 1);
    // ∫ T(1 − ρ²) over the ellipse = T·πab/2
    const expected = (SADDLE.tent * Math.PI * SADDLE.a * SADDLE.b) / 2;
    // The first tissue met from the atrium is the leaflet's atrial face, ~0.7 mm
    // above its middle, so the measured tent is a little smaller.
    expect(map.stats.tentingVolumeMm3 / expected).toBeGreaterThan(0.75);
    expect(map.stats.tentingVolumeMm3 / expected).toBeLessThan(1.02);
    // The A2/P2 cut: deep coaptation, no gap
    const mid = r.cuts[Math.floor(r.cuts.length / 2)];
    const p = cutProfile(sample, r, mid, thr);
    expect(p.gapMm).toBe(0);
    expect(p.tentingHeightMm).toBeGreaterThan(SADDLE.tent - 1.5);
    expect(p.tentingAreaMm2).toBeGreaterThan(50);
  });

  test('the funnel of a closed, tented valve is not an orifice', () => {
    const thr = estimateThreshold(sample, result).threshold;
    expect(frameMetrics(sample, result, thr).orificeMm2).toBeNull();
  });

  test('planimetry follows the saddle: a flat section cannot seal a saddle-shaped valve', () => {
    const open = makeSampler(saddlePhantom({ tent: 0, hole: [9, 6] }), 0);
    const saddle = withAnnulus(result, fit, 'saddle');
    const thr = estimateThreshold(open, saddle).threshold;
    const area = Math.PI * 9 * 6;
    const o = orificeAt(open, saddle, thr, orificeSeed(saddle));
    expect(Math.abs(o.areaMm2 - area) / area).toBeLessThan(0.1);
    expect(orificeAt(open, result, thr, orificeSeed(result))).toBeNull();
  });

  test('picked reference and an unchanged result without a fit', () => {
    expect(withAnnulus(result, null, 'saddle')).toBe(result);
    expect(withAnnulus(result, fit, 'picked')).toBe(result);
  });
});

describe('aortoMitralAngle', () => {
  test('180° in line, narrower as the aortic annulus folds over', () => {
    const mitral = { ant: [0, 0, 0], post: [30, 0, 0] };
    expect(aortoMitralAngle(mitral, [[-1, 0, 0], [-22, 0, 0]])).toBeCloseTo(180, 5);
    // Aortic line rising at 50° from the continuity: angle 130°
    const d = [-Math.cos((50 * Math.PI) / 180), 0, -Math.sin((50 * Math.PI) / 180)];
    const far = d.map((v) => v * 22);
    expect(aortoMitralAngle(mitral, [far, [0, 0, 0]])).toBeCloseTo(130, 5);
  });
});
