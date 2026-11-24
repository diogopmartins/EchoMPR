import { fitAnnulus, withAnnulus } from './annulusFit';
import { buildLeafletModel } from './leafletModel';
import { buildMvSlicer } from './mvSlicer';
import { SADDLE, SADDLE_MV_POINTS, saddleAnnulusPoint, saddlePhantom } from './testPhantoms';
import { estimateThreshold, makeSampler } from './valveAnalysis';

const UP = [0, 0, -1];
const sample = makeSampler(saddlePhantom(), 0);
const result = buildMvSlicer(SADDLE_MV_POINTS, [0, 0, 1]);
const ring = Array.from({ length: 18 }, (_, i) => saddleAnnulusPoint(0.05 + (2 * Math.PI * i) / 18));
const fit = fitAnnulus(ring, { up: UP, directions: { cc: result.chord, ap: result.anterior } });

function leafletZ(x, y) {
  const { cx, cy, a, b, s, tent } = SADDLE;
  const rho2 = ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2;
  const phi = Math.atan2(y - cy, x - cx);
  return 20 + s * rho2 * Math.cos(2 * phi) + tent * (1 - rho2);
}

describe('buildLeafletModel', () => {
  const r = withAnnulus(result, fit, 'saddle');
  const thr = estimateThreshold(sample, r).threshold;
  const model = buildLeafletModel(sample, r, thr, { rawPoints: SADDLE_MV_POINTS });
  const n = model.positions.length / 3;

  test('a closed surface on the atrial face of the leaflets', () => {
    expect(n).toBeGreaterThan(300);
    // Two triangles per inner grid cell of a closed, smooth valve
    expect(model.indices.length / 3).toBeGreaterThan(1.6 * n);
    let sumErr = 0;
    for (let v = 0; v < n; v++) {
      const [x, y, z] = model.positions.subarray(3 * v, 3 * v + 3);
      // The atrial face sits ~0.7 mm above the middle of the 1.6 mm thick leaflet
      sumErr += Math.abs(z - (leafletZ(x, y) - 0.7));
    }
    expect(sumErr / n).toBeLessThan(0.6);
  });

  test('coloured by height: tented centre blue', () => {
    let deepest = 0;
    for (let v = 1; v < n; v++) if (model.positions[3 * v + 2] > model.positions[3 * deepest + 2]) deepest = v;
    const [red, , blue] = model.colors.subarray(3 * deepest, 3 * deepest + 3);
    expect(blue).toBeGreaterThan(red);
  });

  test('annulus, coaptation line, markers and segment labels', () => {
    expect(model.annulusTraced).toBe(true);
    expect(model.annulus.length).toBe(fit.curve.length / 3);
    expect(model.guides).toHaveLength(1);
    // The coaptation line runs over the tent, below the annulus
    const mid = model.guides[0][Math.floor(model.guides[0].length / 2)];
    expect(mid[2]).toBeGreaterThan(25);
    const ao = model.markers.find((m) => m.key === 'ao');
    expect(ao.mm).toEqual(SADDLE_MV_POINTS.ao);
    // Commissure markers sit on the annulus (low points of the saddle)
    const al = model.markers.find((m) => m.key === 'al');
    expect(al.mm[2]).toBeGreaterThan(21.5);
    expect(model.segments.map((s) => s.text).sort()).toEqual(['A1', 'A2', 'A3', 'P1', 'P2', 'P3']);
  });

  test('without a traced annulus the outline sits on the picked plane', () => {
    const plain = buildLeafletModel(sample, result, estimateThreshold(sample, result).threshold);
    expect(plain.annulusTraced).toBe(false);
    expect(plain.annulus).toBe(result.roiPolygon);
  });
});
