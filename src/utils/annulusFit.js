/**
 * 3D annulus from hinge points clicked in the slicer cuts.
 *
 * The points get a best-fit plane (PCA) and a closed curve in polar
 * coordinates about their centroid: radius r(φ) and height h(φ) above the
 * plane, each a low-order Fourier series. The saddle shape of a normal mitral
 * annulus shows up as the second harmonic of h(φ).
 *
 * The fit also gives reference surfaces for leaflet heights:
 * - "plane": the annulus best-fit plane;
 * - "saddle": the harmonic extension of the annulus heights over the orifice,
 *   h(ρ, φ) = a0 + Σ (ρ/R(φ))^k (a_k cos kφ + b_k sin kφ), which matches the
 *   annulus on its rim and is smooth inside (a saddle annulus gives a
 *   hyperbolic-paraboloid-like surface).
 *
 * Vectors are volume-local millimetres.
 */
import { add, cross, dot, normalize, scale, sub, vecLen } from './mprGeometry';
import { worldToFrame } from './mvSlicer';

export const MIN_ANNULUS_POINTS = 5;

/** Reference surfaces leaflet heights can be measured from. */
export const REFERENCES = [
  { id: 'picked', label: 'Picked plane', short: 'picked plane' },
  { id: 'plane', label: 'Annulus plane', short: 'annulus plane' },
  { id: 'saddle', label: 'Saddle', short: '3D annulus (saddle)' },
];

/** Eigen-decomposition of a symmetric 3×3 matrix (cyclic Jacobi). */
export function symmetricEigen3(m) {
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
  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [0, 1, 2].map((j) => normalize([v[0][j], v[1][j], v[2][j]])),
  };
}

/** Least-squares Fourier series of the given order: [a0, a1, b1, a2, b2, …]. */
export function fitFourier(angles, values, order) {
  const m = 1 + 2 * order;
  const row = (phi) => {
    const r = [1];
    for (let k = 1; k <= order; k++) r.push(Math.cos(k * phi), Math.sin(k * phi));
    return r;
  };
  const ata = Array.from({ length: m }, () => new Array(m).fill(0));
  const atb = new Array(m).fill(0);
  angles.forEach((phi, i) => {
    const r = row(phi);
    for (let a = 0; a < m; a++) {
      atb[a] += r[a] * values[i];
      for (let b = 0; b < m; b++) ata[a][b] += r[a] * r[b];
    }
  });
  for (let a = 0; a < m; a++) ata[a][a] += 1e-9 * (1 + ata[a][a]);
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
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = atb[r];
    for (let k = r + 1; k < m; k++) s -= ata[r][k] * x[k];
    x[r] = s / ata[r][r];
  }
  return x;
}

export function evalFourier(coef, phi, radial = 1) {
  let v = coef[0];
  for (let k = 1; 2 * k < coef.length; k++) {
    v += radial ** k * (coef[2 * k - 1] * Math.cos(k * phi) + coef[2 * k] * Math.sin(k * phi));
  }
  return v;
}

/** Centroid and principal axes of a point set; the normal is oriented along `up`. */
function principalFrame(points, up) {
  const n = points.length;
  const centroid = scale(points.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / n);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  points.forEach((p) => {
    const d = sub(p, centroid);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  });
  const { values, vectors } = symmetricEigen3(cov);
  const order3 = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  let normal = vectors[order3[2]];
  if (up && dot(normal, up) < 0) normal = scale(normal, -1);
  const e1 = vectors[order3[0]];
  const e2 = normalize(cross(normal, e1));
  return { centroid, normal, e1, e2 };
}

/** Radius and height of the points as Fourier series of the polar angle in a frame. */
function fitInFrame(points, frame, order) {
  const angles = [];
  const radii = [];
  const heights = [];
  points.forEach((p) => {
    const d = sub(p, frame.centroid);
    const u = dot(d, frame.e1);
    const v = dot(d, frame.e2);
    angles.push(Math.atan2(v, u));
    radii.push(Math.hypot(u, v));
    heights.push(dot(d, frame.normal));
  });
  const rCoef = fitFourier(angles, radii, order);
  const hCoef = fitFourier(angles, heights, Math.min(order, 2));
  return { rCoef, hCoef };
}

function sampleCurve(frame, rCoef, hCoef, samples) {
  const curve = [];
  const flat = [];
  const hs = [];
  for (let i = 0; i < samples; i++) {
    const phi = -Math.PI + (2 * Math.PI * i) / samples;
    const r = Math.max(0.1, evalFourier(rCoef, phi));
    const h = evalFourier(hCoef, phi);
    const u = r * Math.cos(phi);
    const v = r * Math.sin(phi);
    flat.push([u, v]);
    hs.push(h);
    curve.push(add(add(add(frame.centroid, scale(frame.e1, u)), scale(frame.e2, v)), scale(frame.normal, h)));
  }
  return { curve, flat, hs };
}

/**
 * Fit an annulus through hinge points (world mm). `up` points towards the
 * atrium and orients the normal. `directions` (optional) names in-plane
 * directions to report diameters along, e.g. { ap, cc }.
 * Returns null with fewer than MIN_ANNULUS_POINTS points.
 *
 * Hinges from slicer cuts are unevenly spread (fan cuts bunch them on the
 * anterior side), so the plane of the points tilts towards where they
 * cluster. The plane is therefore refined from the fitted curve itself,
 * sampled evenly around the annulus, and the curve refitted in it.
 */
export function fitAnnulus(points, { up, directions = {}, samples = 180 } = {}) {
  if (!points || points.length < MIN_ANNULUS_POINTS) return null;
  const n = points.length;
  const order = Math.max(1, Math.min(3, Math.floor((n - 1) / 2)));
  let frame = principalFrame(points, up);
  let coefs = fitInFrame(points, frame, order);
  for (let iter = 0; iter < 3; iter++) {
    const { curve } = sampleCurve(frame, coefs.rCoef, coefs.hCoef, samples);
    frame = principalFrame(curve, up);
    coefs = fitInFrame(points, frame, order);
  }
  const { centroid, normal, e1, e2 } = frame;
  const { rCoef, hCoef } = coefs;
  const radiusAt = (phi) => Math.max(0.1, evalFourier(rCoef, phi));
  const heightAt = (phi) => evalFourier(hCoef, phi);
  const { curve, flat, hs } = sampleCurve(frame, rCoef, hCoef, samples);

  let perimeterMm = 0;
  let area2d = 0;
  let area3d = 0;
  const cc = scale(curve.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / samples);
  for (let i = 0; i < samples; i++) {
    const j = (i + 1) % samples;
    perimeterMm += vecLen(sub(curve[j], curve[i]));
    area2d += flat[i][0] * flat[j][1] - flat[j][0] * flat[i][1];
    area3d += 0.5 * vecLen(cross(sub(curve[i], cc), sub(curve[j], cc)));
  }

  const widthAlong = (dir) => {
    const du = dot(dir, e1);
    const dv = dot(dir, e2);
    const phi = Math.atan2(dv, du);
    return radiusAt(phi) + radiusAt(phi + Math.PI);
  };
  let maxDiameterMm = 0;
  let minDiameterMm = Infinity;
  for (let deg = 0; deg < 180; deg++) {
    const phi = (deg * Math.PI) / 180;
    const w = radiusAt(phi) + radiusAt(phi + Math.PI);
    maxDiameterMm = Math.max(maxDiameterMm, w);
    minDiameterMm = Math.min(minDiameterMm, w);
  }
  const named = {};
  Object.entries(directions).forEach(([k, dir]) => {
    if (dir) named[k] = widthAlong(dir);
  });
  const heightMm = Math.max(...hs) - Math.min(...hs);
  const widthForRatio = named.cc ?? maxDiameterMm;

  return {
    centroid,
    normal,
    e1,
    e2,
    rCoef,
    hCoef,
    radiusAt,
    heightAt,
    curve,
    points,
    metrics: {
      pointCount: n,
      perimeterMm,
      area2dMm2: Math.abs(area2d) / 2,
      area3dMm2: area3d,
      maxDiameterMm,
      minDiameterMm,
      diameters: named,
      heightMm,
      ahcwrPercent: widthForRatio > 0 ? (100 * heightMm) / widthForRatio : 0,
    },
  };
}

/**
 * Reference height (mm along `up`, towards the atrium) at a point q on the
 * valve plane, for leaflet heights measured from the annulus.
 * mode: 'plane' (annulus best-fit plane) or 'saddle' (harmonic surface).
 */
export function annulusReference(fit, up, mode) {
  const n = fit.normal;
  const cosT = dot(up, n) || 1;
  return (q) => {
    // Height of the annulus plane above q, along up
    const hPlane = dot(sub(fit.centroid, q), n) / cosT;
    if (mode !== 'saddle') return hPlane;
    const p = add(q, scale(up, hPlane));
    const d = sub(p, fit.centroid);
    const u = dot(d, fit.e1);
    const v = dot(d, fit.e2);
    const phi = Math.atan2(v, u);
    const rho = Math.min(1, Math.hypot(u, v) / fit.radiusAt(phi));
    return hPlane + evalFourier(fit.hCoef, phi, rho) / cosT;
  };
}

/** The annulus curve dropped onto the valve plane (along `up`), as a polygon. */
export function annulusOutline(fit, planePoint, up) {
  return fit.curve.map((p) => sub(p, scale(up, dot(sub(p, planePoint), up))));
}

/**
 * Aorto-mitral angle (degrees) from the two mitral hinges and the two aortic
 * annulus hinges clicked in one long-axis cut (world mm): the angle at the
 * aorto-mitral continuity between the mitral annulus line (anterior →
 * posterior hinge) and the aortic annulus line (from the aortic hinge next to
 * the anterior mitral hinge to the other one). 180° means the two annuli lie
 * in line; the angle narrows as the aortic root folds over the mitral valve.
 */
export function aortoMitralAngle({ ant, post }, [a1, a2]) {
  const near = vecLen(sub(a1, ant)) <= vecLen(sub(a2, ant)) ? a1 : a2;
  const far = near === a1 ? a2 : a1;
  const u = sub(post, ant);
  const w = sub(far, near);
  const c = dot(u, w) / (vecLen(u) * vecLen(w) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * The slicer result as the leaflet analysis should see it once an annulus is
 * fitted: the traced annulus is the valve outline, heights are measured from
 * the chosen reference ('plane' or 'saddle'), and the key map is widened to
 * show the whole annulus. With no fit or the 'picked' reference the result is
 * returned unchanged.
 */
export function withAnnulus(result, fit, mode) {
  if (!result?.ok || !fit || mode === 'picked') return result;
  const down = result.kind === 'tv' ? result.raToRv : result.laToLv;
  const up = scale(down, -1);
  const outline = annulusOutline(fit, result.valveCenter, up).filter((_, i) => i % 2 === 0);
  const km = result.keyMap;
  const f = outline.map((p) => worldToFrame(km, p));
  const keyMap = {
    ...km,
    xMin: Math.min(km.xMin, Math.min(...f.map((p) => p.x)) - 4),
    xMax: Math.max(km.xMax, Math.max(...f.map((p) => p.x)) + 4),
    yMin: Math.min(km.yMin, Math.min(...f.map((p) => p.y)) - 4),
    yMax: Math.max(km.yMax, Math.max(...f.map((p) => p.y)) + 4),
  };
  return {
    ...result,
    roiPolygon: outline,
    keyMap,
    refHeight: annulusReference(fit, up, mode),
    reference: mode,
    annulus: fit,
  };
}
