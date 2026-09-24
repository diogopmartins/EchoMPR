/**
 * Mitral annulus modelling from hinge points picked on rotated planes.
 *
 * The points are fitted with a best-fit plane (PCA), then a closed curve in
 * cylindrical coordinates about the point centroid: radius r(φ) and height
 * h(φ) above the plane are each a low-order Fourier series in φ. The saddle
 * shape of a normal annulus shows up as the second harmonic of h(φ).
 */
import { add, cross, dot, normalize, scale, sub, vecLen } from './mprGeometry';
import type { Vec3 } from './types';

export interface PlaneFit {
  centroid: Vec3;
  /** Unit normal (smallest principal axis). */
  normal: Vec3;
  /** In-plane unit axes; e1 is the largest principal axis. */
  e1: Vec3;
  e2: Vec3;
}

export interface AnnulusMetrics {
  pointCount: number;
  perimeterMm: number;
  /** Area of the curve projected onto its best-fit plane. */
  area2dMm2: number;
  /** Area of the saddle-shaped surface spanned by the curve (fan from centroid). */
  area3dMm2: number;
  /** Largest width through the centroid (≈ commissural diameter). */
  maxDiameterMm: number;
  /** Smallest width through the centroid (≈ anteroposterior diameter). */
  minDiameterMm: number;
  /** Peak-to-trough distance of the curve along the plane normal (saddle height). */
  heightMm: number;
  /** Annular height to commissural width ratio, in percent. */
  ahcwrPercent: number;
}

export interface AnnulusFit extends PlaneFit {
  /** Closed curve, evenly spaced in angle, first point not repeated. */
  curve: Vec3[];
  metrics: AnnulusMetrics;
}

export const MIN_ANNULUS_POINTS = 5;

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi). */
export function symmetricEigen3(m: number[][]): { values: number[]; vectors: Vec3[] } {
  const a = m.map((row) => row.slice());
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors: Vec3[] = [0, 1, 2].map((j) => normalize([v[0][j], v[1][j], v[2][j]]));
  return { values, vectors };
}

export function fitPlane(points: Vec3[]): PlaneFit {
  const n = points.length;
  const centroid = scale(points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / Math.max(1, n));
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = sub(p, centroid);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const { values, vectors } = symmetricEigen3(cov);
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  const e1 = vectors[order[0]];
  const normal = vectors[order[2]];
  const e2 = normalize(cross(normal, e1));
  return { centroid, normal, e1, e2 };
}

/** Least-squares Fourier series of the given order: returns [a0, a1, b1, a2, b2, …]. */
export function fitFourier(angles: number[], values: number[], order: number): number[] {
  const m = 1 + 2 * order;
  const row = (phi: number) => {
    const r = [1];
    for (let k = 1; k <= order; k++) r.push(Math.cos(k * phi), Math.sin(k * phi));
    return r;
  };
  const ata = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const atb = new Array<number>(m).fill(0);
  angles.forEach((phi, i) => {
    const r = row(phi);
    for (let a = 0; a < m; a++) {
      atb[a] += r[a] * values[i];
      for (let b = 0; b < m; b++) ata[a][b] += r[a] * r[b];
    }
  });
  // Tiny ridge keeps the system solvable when angles cluster.
  for (let a = 0; a < m; a++) ata[a][a] += 1e-9 * (1 + ata[a][a]);
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(ata[r][c]) > Math.abs(ata[piv][c])) piv = r;
    [ata[c], ata[piv]] = [ata[piv], ata[c]];
    [atb[c], atb[piv]] = [atb[piv], atb[c]];
    for (let r = c + 1; r < m; r++) {
      const f = ata[r][c] / ata[c][c];
      for (let k = c; k < m; k++) ata[r][k] -= f * ata[c][k];
      atb[r] -= f * atb[c];
    }
  }
  const x = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = atb[r];
    for (let k = r + 1; k < m; k++) s -= ata[r][k] * x[k];
    x[r] = s / ata[r][r];
  }
  return x;
}

export function evalFourier(coef: number[], phi: number): number {
  let v = coef[0];
  for (let k = 1; 2 * k < coef.length; k++) {
    v += coef[2 * k - 1] * Math.cos(k * phi) + coef[2 * k] * Math.sin(k * phi);
  }
  return v;
}

/**
 * Fit a closed annulus curve through hinge points (world mm) and measure it.
 * Returns null with fewer than MIN_ANNULUS_POINTS points.
 */
export function fitAnnulus(points: Vec3[], samples = 180): AnnulusFit | null {
  if (points.length < MIN_ANNULUS_POINTS) return null;
  const plane = fitPlane(points);
  const { centroid, normal, e1, e2 } = plane;

  const angles: number[] = [];
  const radii: number[] = [];
  const heights: number[] = [];
  for (const p of points) {
    const d = sub(p, centroid);
    const u = dot(d, e1);
    const v = dot(d, e2);
    angles.push(Math.atan2(v, u));
    radii.push(Math.hypot(u, v));
    heights.push(dot(d, normal));
  }
  // Order 3 captures the D shape and the saddle; fewer points force lower order.
  const order = Math.max(1, Math.min(3, Math.floor((points.length - 1) / 2)));
  const rCoef = fitFourier(angles, radii, order);
  const hCoef = fitFourier(angles, heights, Math.min(order, 2));

  const curve: Vec3[] = [];
  const flat: [number, number][] = [];
  const hs: number[] = [];
  for (let i = 0; i < samples; i++) {
    const phi = -Math.PI + (2 * Math.PI * i) / samples;
    const r = Math.max(0, evalFourier(rCoef, phi));
    const h = evalFourier(hCoef, phi);
    const u = r * Math.cos(phi);
    const v = r * Math.sin(phi);
    flat.push([u, v]);
    hs.push(h);
    curve.push(add(add(add(centroid, scale(e1, u)), scale(e2, v)), scale(normal, h)));
  }

  let perimeterMm = 0;
  let area2d = 0;
  let area3d = 0;
  const curveCentroid = scale(curve.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / samples);
  for (let i = 0; i < samples; i++) {
    const j = (i + 1) % samples;
    perimeterMm += vecLen(sub(curve[j], curve[i]));
    area2d += flat[i][0] * flat[j][1] - flat[j][0] * flat[i][1];
    area3d += 0.5 * vecLen(cross(sub(curve[i], curveCentroid), sub(curve[j], curveCentroid)));
  }

  let maxDiameterMm = 0;
  let minDiameterMm = Infinity;
  for (let deg = 0; deg < 180; deg++) {
    const phi = (deg * Math.PI) / 180;
    const w =
      Math.max(0, evalFourier(rCoef, phi)) + Math.max(0, evalFourier(rCoef, phi + Math.PI));
    if (w > maxDiameterMm) maxDiameterMm = w;
    if (w < minDiameterMm) minDiameterMm = w;
  }
  const heightMm = Math.max(...hs) - Math.min(...hs);

  return {
    ...plane,
    curve,
    metrics: {
      pointCount: points.length,
      perimeterMm,
      area2dMm2: Math.abs(area2d) / 2,
      area3dMm2: area3d,
      maxDiameterMm,
      minDiameterMm,
      heightMm,
      ahcwrPercent: maxDiameterMm > 0 ? (100 * heightMm) / maxDiameterMm : 0,
    },
  };
}

/**
 * Points where a closed curve crosses a plane (linear interpolation between
 * consecutive samples on opposite sides).
 */
export function curvePlaneCrossings(curve: Vec3[], planePoint: Vec3, planeNormal: Vec3): Vec3[] {
  const n = normalize(planeNormal);
  const out: Vec3[] = [];
  for (let i = 0; i < curve.length; i++) {
    const a = curve[i];
    const b = curve[(i + 1) % curve.length];
    const da = dot(sub(a, planePoint), n);
    const db = dot(sub(b, planePoint), n);
    if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
      const t = da / (da - db);
      out.push(add(a, scale(sub(b, a), t)));
    }
  }
  return out;
}
