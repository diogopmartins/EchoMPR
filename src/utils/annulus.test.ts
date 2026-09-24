import {
  curvePlaneCrossings,
  fitAnnulus,
  fitFourier,
  evalFourier,
  fitPlane,
  symmetricEigen3,
} from './annulus';
import { add, dot, normalize, rotateAroundAxis, scale, sub, vecLen } from './mprGeometry';
import type { Vec3 } from './types';

const A = 18; // semi-major (commissural) radius, mm
const B = 14; // semi-minor (anteroposterior) radius, mm

/** Orthonormal frame at an arbitrary orientation and offset. */
function frame() {
  const tilt = (v: Vec3) => rotateAroundAxis(rotateAroundAxis(v, [1, 0.3, 0], 0.7), [0, 0, 1], 1.1);
  return {
    origin: [42, -7, 63] as Vec3,
    ex: tilt([1, 0, 0]),
    ey: tilt([0, 1, 0]),
    ez: tilt([0, 0, 1]),
  };
}

/**
 * Hinge points as a user would click them: `planes` planes rotated about the
 * annulus axis, two points per plane. Height follows a saddle, H·cos(2φ)/2.
 */
function saddlePoints(planes: number, height: number, jitter = 0): Vec3[] {
  const f = frame();
  const pts: Vec3[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let k = 0; k < planes; k++) {
    for (const side of [0, Math.PI]) {
      const phi = (k * Math.PI) / planes + side;
      // Ellipse radius in direction phi
      const r = (A * B) / Math.hypot(B * Math.cos(phi), A * Math.sin(phi));
      const u = r * Math.cos(phi) + jitter * rand();
      const v = r * Math.sin(phi) + jitter * rand();
      const h = (height / 2) * Math.cos(2 * phi) + jitter * rand();
      pts.push(add(add(add(f.origin, scale(f.ex, u)), scale(f.ey, v)), scale(f.ez, h)));
    }
  }
  return pts;
}

const ellipsePerimeter = () => {
  const h = ((A - B) / (A + B)) ** 2;
  return Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
};

describe('symmetricEigen3', () => {
  test('returns eigenpairs satisfying A·v = λ·v', () => {
    const m = [
      [4, 1, 0.5],
      [1, 3, 0.2],
      [0.5, 0.2, 1],
    ];
    const { values, vectors } = symmetricEigen3(m);
    vectors.forEach((v, i) => {
      const av: Vec3 = [dot(m[0] as Vec3, v), dot(m[1] as Vec3, v), dot(m[2] as Vec3, v)];
      expect(vecLen(sub(av, scale(v, values[i])))).toBeLessThan(1e-9);
    });
    expect(values.reduce((s, x) => s + x, 0)).toBeCloseTo(8, 9);
  });
});

describe('fitPlane', () => {
  test('recovers the normal of noisy coplanar points', () => {
    const f = frame();
    const pts = saddlePoints(8, 0, 0.3);
    const { normal, centroid } = fitPlane(pts);
    expect(Math.abs(dot(normal, f.ez))).toBeGreaterThan(0.999);
    expect(vecLen(sub(centroid, f.origin))).toBeLessThan(0.5);
  });
});

describe('fitFourier', () => {
  test('reproduces a truncated series exactly', () => {
    const coef = [3, 0.5, -1, 0.25, 0.75];
    const phis = Array.from({ length: 11 }, (_, i) => -3 + i * 0.55);
    const fitted = fitFourier(phis, phis.map((p) => evalFourier(coef, p)), 2);
    fitted.forEach((c, i) => expect(c).toBeCloseTo(coef[i], 6));
  });
});

describe('fitAnnulus', () => {
  test('needs at least five points', () => {
    expect(fitAnnulus(saddlePoints(2, 0))).toBeNull();
  });

  test('measures a flat elliptical annulus', () => {
    const fit = fitAnnulus(saddlePoints(6, 0));
    expect(fit).not.toBeNull();
    const m = fit!.metrics;
    expect(m.pointCount).toBe(12);
    expect(m.area2dMm2).toBeGreaterThan(Math.PI * A * B * 0.98);
    expect(m.area2dMm2).toBeLessThan(Math.PI * A * B * 1.02);
    expect(Math.abs(m.perimeterMm - ellipsePerimeter()) / ellipsePerimeter()).toBeLessThan(0.02);
    expect(m.maxDiameterMm).toBeCloseTo(2 * A, 0);
    expect(m.minDiameterMm).toBeCloseTo(2 * B, 0);
    expect(m.heightMm).toBeLessThan(0.1);
    expect(m.area3dMm2).toBeCloseTo(m.area2dMm2, -1);
  });

  test('captures saddle height and AHCWR', () => {
    const H = 6;
    const fit = fitAnnulus(saddlePoints(6, H))!;
    const m = fit.metrics;
    expect(m.heightMm).toBeGreaterThan(H * 0.93);
    expect(m.heightMm).toBeLessThan(H * 1.07);
    expect(m.ahcwrPercent).toBeCloseTo((100 * m.heightMm) / m.maxDiameterMm, 6);
    // Projected area is unchanged by the saddle; the 3D surface is larger.
    expect(Math.abs(m.area2dMm2 - Math.PI * A * B) / (Math.PI * A * B)).toBeLessThan(0.02);
    expect(m.area3dMm2).toBeGreaterThan(m.area2dMm2);
    expect(m.perimeterMm).toBeGreaterThan(ellipsePerimeter());
  });

  test('curve passes near the picked points', () => {
    const pts = saddlePoints(6, 6);
    const fit = fitAnnulus(pts)!;
    for (const p of pts) {
      const nearest = Math.min(...fit.curve.map((c) => vecLen(sub(c, p))));
      expect(nearest).toBeLessThan(0.6);
    }
  });

  test('tolerates click jitter', () => {
    const m = fitAnnulus(saddlePoints(9, 6, 1.0))!.metrics;
    expect(Math.abs(m.area2dMm2 - Math.PI * A * B) / (Math.PI * A * B)).toBeLessThan(0.06);
    expect(m.heightMm).toBeGreaterThan(4.5);
    expect(m.heightMm).toBeLessThan(7.5);
  });
});

describe('curvePlaneCrossings', () => {
  test('a plane through the axis cuts the annulus twice', () => {
    const f = frame();
    const fit = fitAnnulus(saddlePoints(6, 6))!;
    const hits = curvePlaneCrossings(fit.curve, f.origin, normalize(f.ey));
    expect(hits).toHaveLength(2);
    // Plane with normal ey contains the major axis: hits are ~2A apart.
    expect(vecLen(sub(hits[0], hits[1]))).toBeCloseTo(2 * A, 0);
  });
});
