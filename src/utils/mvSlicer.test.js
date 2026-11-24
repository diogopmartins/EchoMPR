import { cross, dot, normalize, sub, vecLen } from './mprGeometry';
import {
  MV_CUT_COUNT,
  buildMvSlicer,
  coaptationTargets,
  frameToPixel,
  frameToWorld,
  moveKeepingDepth,
  pixelToFrame,
  sampleFrame,
  scallopLabel,
  worldToFrame,
} from './mvSlicer';

// Synthetic mitral valve in volume-local mm. Valve plane z = 20, LV towards +z.
// Annulus: ellipse centred (24, 28), radius 12 mm commissure-to-commissure (x)
// and 10 mm anteroposterior (y); anterior is −y, the AoV sits anterior.
// The P2 scallop (x 20–28) prolapses 6 mm towards the LA (−z).
const POINTS = {
  al: [12, 30, 20],
  mid: [24, 31, 20],
  pm: [36, 30, 20],
  ao: [24, 8, 23],
};

const coaptY = (x) => 30 + 1 * (1 - ((x - 24) / 12) ** 2);

function leafletZ(x, y) {
  if (y > coaptY(x) && x > 20 && x < 28) {
    const yTop = 38 - 0.5;
    const fy = Math.sin((Math.PI * (y - coaptY(x))) / (yTop - coaptY(x)));
    const fx = Math.sin((Math.PI * (x - 20)) / 8);
    return 20 - 6 * Math.max(0, fx) * Math.max(0, fy);
  }
  return 20;
}

function phantomVolume() {
  const sp = 0.5; // mm
  const dims = { t: 1, x: 96, y: 96, z: 80 };
  const voxels = new Uint8Array(dims.x * dims.y * dims.z);
  for (let k = 0; k < dims.z; k++) {
    for (let j = 0; j < dims.y; j++) {
      for (let i = 0; i < dims.x; i++) {
        const x = i * sp;
        const y = j * sp;
        const z = k * sp;
        let v = 15;
        const inAnnulus = ((x - 24) / 12) ** 2 + ((y - 28) / 10) ** 2 <= 1;
        if (inAnnulus && Math.abs(z - leafletZ(x, y)) < 0.8) v = 210;
        const rAo = Math.hypot(x - 24, y - 8, z - 23);
        if (Math.abs(rAo - 7) < 0.8) v = 190;
        voxels[(k * dims.y + j) * dims.x + i] = v;
      }
    }
  }
  return {
    dims,
    spacingCm: { x: sp / 10, y: sp / 10, z: sp / 10 },
    voxels,
    volumeSize: voxels.length,
    frameTimeMs: 40,
  };
}

const close = (a, b, tol = 1e-6) => vecLen(sub(a, b)) < tol;

describe('scallopLabel', () => {
  test('nine cuts map to commissures and A1/P1 … A3/P3', () => {
    const labels = Array.from({ length: 9 }, (_, k) => scallopLabel(k, 9));
    expect(labels).toEqual([
      'AL comm',
      'A1 / P1',
      'A1 / P1',
      'A2 / P2',
      'A2 / P2',
      'A2 / P2',
      'A3 / P3',
      'A3 / P3',
      'PM comm',
    ]);
  });
});

describe('coaptationTargets', () => {
  test('runs from AL to PM, evenly spaced, through Mid', () => {
    const { targets, lengthMm } = coaptationTargets(POINTS.al, POINTS.mid, POINTS.pm, 9);
    expect(targets).toHaveLength(9);
    expect(close(targets[0], POINTS.al)).toBe(true);
    expect(close(targets[8], POINTS.pm)).toBe(true);
    expect(vecLen(sub(targets[4], POINTS.mid))).toBeLessThan(0.05);
    const gaps = targets.slice(1).map((t, i) => vecLen(sub(t, targets[i])));
    gaps.forEach((g) => expect(Math.abs(g - lengthMm / 8)).toBeLessThan(0.05));
  });
});

describe('buildMvSlicer', () => {
  const enFace = [0, 0, 1];

  test('fan cuts all pass through the AoV and contain the valve axis', () => {
    const r = buildMvSlicer(POINTS, enFace);
    expect(r.ok).toBe(true);
    expect(r.normalSource).toBe('view');
    expect(r.cuts).toHaveLength(MV_CUT_COUNT);
    // LA→LV from the anatomy: (AL→PM) × posterior = x × y = +z
    expect(close(r.laToLv, [0, 0, 1], 1e-9)).toBe(true);
    expect(r.orientation).toEqual({ top: 'LA', bottom: 'LV', left: 'P', right: 'A' });
    const { targets } = coaptationTargets(POINTS.al, POINTS.mid, POINTS.pm, MV_CUT_COUNT);
    r.cuts.forEach((c, k) => {
      expect(Math.abs(dot(c.right, c.down))).toBeLessThan(1e-9);
      expect(close(c.down, [0, 0, 1], 1e-9)).toBe(true);
      expect(c.ao.offPlaneMm).toBe(0);
      // Ao is to the right of the coaptation target (Ao on the right)
      expect(c.ao.x).toBeGreaterThan(c.target.x);
      // Its coaptation target lies on the cut plane, at valve level
      const planeNormal = normalize(cross(c.right, c.down));
      expect(Math.abs(dot(sub(targets[k], c.ref), planeNormal))).toBeLessThan(1e-6);
      expect(c.target.y).toBeCloseTo(0, 9);
    });
    expect(r.cuts[0].label).toBe('AL comm');
    expect(r.cuts[4].label).toBe('A2 / P2');
    // The middle cut points straight from Mid to the AoV: along −y
    expect(r.cuts[4].right[1]).toBeLessThan(-0.99);
    expect(r.spacingMm).toBeGreaterThan(2.9);
    expect(r.spacingMm).toBeLessThan(3.2);
  });

  test('parallel cuts are perpendicular to the commissural line', () => {
    const r = buildMvSlicer(POINTS, enFace, { mode: 'parallel' });
    expect(r.ok).toBe(true);
    r.cuts.forEach((c) => {
      const planeNormal = normalize(cross(c.right, c.down));
      expect(Math.abs(dot(planeNormal, [1, 0, 0]))).toBeGreaterThan(0.999);
    });
    // Only the middle cuts come close to the AoV centre
    expect(r.cuts[4].ao.offPlaneMm).toBeLessThan(0.5);
    expect(r.cuts[0].ao.offPlaneMm).toBeGreaterThan(10);
  });

  test('flip and mirror change the orientation', () => {
    const r = buildMvSlicer(POINTS, enFace, { flipVertical: true, mirror: true });
    expect(close(r.laToLv, [0, 0, -1], 1e-9)).toBe(true);
    expect(r.orientation).toEqual({ top: 'LV', bottom: 'LA', left: 'A', right: 'P' });
    r.cuts.forEach((c) => expect(c.ao.x).toBeLessThan(c.target.x));
  });

  test('falls back to the plane through the points when the view is not en-face', () => {
    const r = buildMvSlicer(POINTS, [1, 0, 0]);
    expect(r.ok).toBe(true);
    expect(r.normalSource).toBe('points');
    expect(Math.abs(dot(r.normal, [0, 0, 1]))).toBeGreaterThan(0.9);
  });

  test('rejects impossible point sets', () => {
    expect(buildMvSlicer({ ...POINTS, pm: [13, 30, 20] }, enFace).ok).toBe(false);
    expect(buildMvSlicer({ ...POINTS, ao: [30, 30, 20] }, enFace).ok).toBe(false);
    expect(buildMvSlicer({ al: POINTS.al }, enFace).ok).toBe(false);
  });

  test('key map is a surgical view: AoV above, AL left of PM', () => {
    const { keyMap, projected } = buildMvSlicer(POINTS, enFace);
    const ao = worldToFrame(keyMap, projected.ao);
    const al = worldToFrame(keyMap, projected.al);
    const pm = worldToFrame(keyMap, projected.pm);
    const mid = worldToFrame(keyMap, projected.mid);
    expect(ao.y).toBeLessThan(mid.y);
    expect(al.x).toBeLessThan(pm.x);
    [ao, al, pm].forEach((p) => {
      expect(p.x).toBeGreaterThan(keyMap.xMin);
      expect(p.x).toBeLessThan(keyMap.xMax);
      expect(p.y).toBeGreaterThan(keyMap.yMin);
      expect(p.y).toBeLessThan(keyMap.yMax);
    });
  });
});

describe('sampleFrame on the phantom', () => {
  const volume = phantomVolume();
  const result = buildMvSlicer(POINTS, [0, 0, 1]);
  const mmPerPx = 0.25;

  /** How far (mm) the posterior leaflet rises towards the LA in a cut. */
  function laExcursion(cut) {
    const img = sampleFrame(volume, 0, cut, mmPerPx);
    let best = 0;
    for (let j = 0; j < img.height; j++) {
      const y = cut.yMin + (j + 0.5) * mmPerPx;
      for (let i = 0; i < img.width; i++) {
        const x = cut.xMin + (i + 0.5) * mmPerPx;
        // Posterior of the coaptation target, short of the posterior annulus
        if (x > cut.target.x || x < cut.target.x - 9) continue;
        if (img.data[j * img.width + i] > 100 && -y > best) best = -y;
      }
    }
    return best;
  }

  test('the P2 prolapse shows in the A2/P2 cuts only', () => {
    const ex = result.cuts.map(laExcursion);
    // eslint-disable-next-line no-console
    console.log('LA excursion per cut (mm):', ex.map((v) => v.toFixed(1)).join(' '));
    expect(ex[4]).toBeGreaterThan(4.5);
    [0, 1, 7, 8].forEach((k) => expect(ex[k]).toBeLessThan(1.5));
    expect(Math.max(...ex)).toBe(ex[4]);
  });

  test('the aortic valve ring is in every fan cut', () => {
    result.cuts.forEach((cut) => {
      const img = sampleFrame(volume, 0, cut, mmPerPx);
      // Ring radius 7 mm around the AoV centre: bright 7 mm above it
      const { px, py } = frameToPixel(cut, cut.ao.x, cut.ao.y - 7, mmPerPx);
      let peak = 0;
      for (let dj = -3; dj <= 3; dj++) {
        const v = img.data[(Math.round(py) + dj) * img.width + Math.round(px)];
        if (v > peak) peak = v;
      }
      expect(peak).toBeGreaterThan(120);
    });
  });

  test('slab MIP in the key map shows the prolapsed scallop', () => {
    const { keyMap } = result;
    const thin = sampleFrame(volume, 0, keyMap, 0.5);
    const slab = sampleFrame(volume, 0, keyMap, 0.5, { slabMm: 16 });
    const count = (img) => img.data.reduce((s, v) => s + (v > 100 ? 1 : 0), 0);
    // The valve-level section misses most of the bulge; the slab includes it.
    expect(count(slab)).toBeGreaterThan(count(thin));
  });
});

describe('editing points in the key map', () => {
  const r = buildMvSlicer(POINTS, [0, 0, 1]);
  const { keyMap } = r;

  test('pixel → frame → world round-trips through frameToPixel / worldToFrame', () => {
    const mmPerPx = 0.3;
    const world = frameToWorld(keyMap, 3.2, -4.7);
    const f = worldToFrame(keyMap, world);
    expect(f.x).toBeCloseTo(3.2, 9);
    expect(f.y).toBeCloseTo(-4.7, 9);
    const { px, py } = frameToPixel(keyMap, f.x, f.y, mmPerPx);
    const back = pixelToFrame(keyMap, px, py, mmPerPx);
    expect(back.x).toBeCloseTo(3.2, 9);
    expect(back.y).toBeCloseTo(-4.7, 9);
  });

  test('moving the AoV in the en-face map keeps its height above the valve', () => {
    const target = frameToWorld(keyMap, 4, -12);
    const moved = moveKeepingDepth(POINTS.ao, target, r.normal);
    expect(moved[2]).toBeCloseTo(POINTS.ao[2], 9);
    const f = worldToFrame(keyMap, moved);
    expect(f.x).toBeCloseTo(4, 9);
    expect(f.y).toBeCloseTo(-12, 9);
  });

  test('moving AL outwards lengthens the coaptation line and widens the spacing', () => {
    const al = worldToFrame(keyMap, r.projected.al);
    const movedAl = moveKeepingDepth(POINTS.al, frameToWorld(keyMap, al.x - 4, al.y), r.normal);
    const r2 = buildMvSlicer({ ...POINTS, al: movedAl }, [0, 0, 1]);
    expect(r2.ok).toBe(true);
    expect(r2.coaptationLengthMm).toBeGreaterThan(r.coaptationLengthMm + 3);
    expect(r2.spacingMm).toBeGreaterThan(r.spacingMm);
    // The PM cut still runs from PM to the AoV; the AL cut follows the new AL.
    expect(vecLen(sub(r2.cuts[8].right, r.cuts[8].right))).toBeLessThan(1e-9);
    expect(vecLen(sub(r2.cuts[0].right, r.cuts[0].right))).toBeGreaterThan(0.05);
  });
});

describe('MV segments and outline', () => {
  const r = buildMvSlicer(POINTS, [0, 0, 1]);
  test('segmentAt follows Carpentier: 1 at AL, 3 at PM, A anterior of coaptation', () => {
    expect(r.segmentAt([24, 34, 20])).toBe('P2');
    expect(r.segmentAt([24, 22, 20])).toBe('A2');
    expect(r.segmentAt([14, 33, 20])).toBe('P1');
    expect(r.segmentAt([34, 23, 20])).toBe('A3');
  });
  test('outline passes through the commissures and stops short of the AoV', () => {
    const ys = r.roiPolygon.map((p) => p[1]);
    const xs = r.roiPolygon.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(12 - 1.5, 1);
    expect(Math.max(...xs)).toBeCloseTo(36 + 1.5, 1);
    expect(Math.min(...ys)).toBeGreaterThan(8 + 7); // anterior edge short of the aortic ring
    expect(Math.max(...ys)).toBeGreaterThan(36); // posterior annulus at y = 38
  });
});
