import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import {
  add,
  cross,
  dot,
  normalize,
  planeAxes,
  rotateAroundAxis,
  scale,
  sub,
  vecLen,
  viewSpec,
  voxelToMm,
} from './mprGeometry';

const VALVE_COLOR = '#ffb74d';

function permutationSign(order) {
  let sign = 1;
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      if (order[i] > order[j]) sign = -sign;
    }
  }
  return sign;
}

/** Centre an STL and put its long axis on Y, with the thin axis on Z. */
export function alignStlPositions(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('The STL has no geometry.');
  const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const center = [
    (box.max.x + box.min.x) / 2,
    (box.max.y + box.min.y) / 2,
    (box.max.z + box.min.z) / 2,
  ];
  const src = geometry.getAttribute('position');
  if (!src || src.count < 3) throw new Error('The STL has no triangles.');
  const raw = src.array;
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const srcForDest = [order[1], order[0], order[2]];
  const flipX = permutationSign(srcForDest) < 0 ? -1 : 1;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const v = [raw[i] - center[0], raw[i + 1] - center[1], raw[i + 2] - center[2]];
    out[i] = v[srcForDest[0]] * flipX;
    out[i + 1] = v[srcForDest[1]];
    out[i + 2] = v[srcForDest[2]];
  }
  return out;
}

export async function loadStlGeometry(file) {
  const buffer = await file.arrayBuffer();
  const geometry = new STLLoader().parse(buffer);
  const positions = alignStlPositions(geometry);
  geometry.dispose?.();
  return positions;
}

export function localToWorld(frame, local) {
  return add(
    frame.center,
    add(add(scale(frame.X, local[0]), scale(frame.Y, local[1])), scale(frame.Z, local[2]))
  );
}

/**
 * Profile frame lies in the chosen MPR plane.
 * Valve frame shares that centre and long axis, then rolls around it.
 */
export function valveFrames(volume, mprCenter, mprBasis, pose) {
  const spec = viewSpec(pose.hostAxis);
  const { right, down, normal } = planeAxes(mprBasis[spec.normalKey], spec.worldUp);
  const c = Math.cos(pose.spin || 0);
  const s = Math.sin(pose.spin || 0);
  let X = add(scale(right, c), scale(down, s));
  let Y = add(scale(right, -s), scale(down, c));
  let Z = normal;
  if (pose.flip) {
    Y = scale(Y, -1);
    Z = scale(Z, -1);
  }
  const center = pose.centerMm || voxelToMm(volume, mprCenter);
  if (pose.basis) {
    const valve = {
      X: pose.basis.X,
      Y: pose.basis.Y,
      Z: pose.basis.Z,
      center,
    };
    return { profile: valve, valve, right, down, normal };
  }
  const profile = { X, Y, Z, center };
  const cr = Math.cos(pose.roll || 0);
  const sr = Math.sin(pose.roll || 0);
  const valve = {
    X: add(scale(X, cr), scale(Z, sr)),
    Y,
    Z: add(scale(X, -sr), scale(Z, cr)),
    center,
  };
  return { profile, valve, right, down, normal };
}

export function lerpVec(a, b, u) {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

export function upsertValveKey(keys, key) {
  return [...keys.filter((item) => item.t !== key.t), {
    t: key.t,
    a: key.a.slice(),
    b: key.b.slice(),
  }].sort((p, q) => p.t - q.t);
}

/** Two anchor points at this cine frame, blended between the frames that have them. */
export function anchorPairAtTime(keys, time, frameCount) {
  if (!keys || !keys.length) return null;
  const sorted = [...keys].sort((p, q) => p.t - q.t);
  if (sorted.length === 1 || frameCount < 2) {
    return { a: sorted[0].a.slice(), b: sorted[0].b.slice() };
  }
  const n = frameCount;
  for (let i = 0; i < sorted.length; i += 1) {
    const left = sorted[i];
    const right = sorted[(i + 1) % sorted.length];
    const wrapped = i === sorted.length - 1;
    const t0 = left.t;
    const t1 = right.t + (wrapped ? n : 0);
    let t = time;
    if (wrapped && t < t0) t += n;
    if (t < t0 || t > t1) continue;
    const span = t1 - t0;
    const u = span === 0 ? 0 : (t - t0) / span;
    return { a: lerpVec(left.a, right.a, u), b: lerpVec(left.b, right.b, u) };
  }
  return { a: sorted[0].a.slice(), b: sorted[0].b.slice() };
}

/** Centre on the midpoint. Long axis runs from the first point to the second. */
export function frameFromAnchors(a, b, { roll = 0, flip = false, refX = [1, 0, 0] } = {}) {
  const center = scale(add(a, b), 0.5);
  let Y = sub(b, a);
  if (vecLen(Y) < 1e-4) Y = [0, 1, 0];
  Y = normalize(Y);
  let X = sub(refX, scale(Y, dot(refX, Y)));
  if (vecLen(X) < 1e-4) {
    const alt = Math.abs(Y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    X = sub(alt, scale(Y, dot(alt, Y)));
  }
  X = normalize(X);
  let Z = normalize(cross(X, Y));
  X = normalize(cross(Y, Z));
  if (flip) {
    Y = scale(Y, -1);
    Z = scale(Z, -1);
  }
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return {
    center,
    X: add(scale(X, cr), scale(Z, sr)),
    Y,
    Z: add(scale(X, -sr), scale(Z, cr)),
  };
}

export function rotateAnchorPair(a, b, normal, angle) {
  const center = scale(add(a, b), 0.5);
  const turn = (p) => add(center, rotateAroundAxis(sub(p, center), normal, angle));
  return { a: turn(a), b: turn(b) };
}

export function rotateValveBasis(basis, axis, angle) {
  const turn = (v) => normalize(rotateAroundAxis(v, axis, angle));
  return { X: turn(basis.X), Y: turn(basis.Y), Z: turn(basis.Z) };
}

export function flipValveBasis(basis) {
  return {
    X: basis.X.slice(),
    Y: scale(basis.Y, -1),
    Z: scale(basis.Z, -1),
  };
}

/** Point used to spin the valve inside one 2D view. */
export function valveHandleMm(frame, normal, positions) {
  const place = (local) => {
    let offset = sub(localToWorld(frame, local), frame.center);
    offset = sub(offset, scale(normal, dot(offset, normal)));
    return offset;
  };
  let offset = place(longAxisTip(positions));
  if (vecLen(offset) < 4) offset = place([8, 0, 0]);
  if (vecLen(offset) < 1) return add(frame.center, [12, 0, 0]);
  return add(frame.center, offset);
}

export function longAxisTip(positions) {
  let y = 0;
  if (!positions) return [0, 0, 0];
  for (let i = 1; i < positions.length; i += 3) {
    if (Math.abs(positions[i]) > Math.abs(y)) y = positions[i];
  }
  return [0, y || 8, 0];
}

export function drawFlatMesh(ctx, positions, frame, toCss) {
  if (!positions || positions.length < 9) return;
  ctx.beginPath();
  for (let i = 0; i < positions.length; i += 9) {
    const pts = [0, 1, 2].map((k) => {
      const o = i + k * 3;
      return toCss(localToWorld(frame, [positions[o], positions[o + 1], positions[o + 2]]));
    });
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(255, 183, 77, 0.28)';
  ctx.strokeStyle = VALVE_COLOR;
  ctx.lineWidth = 1.2;
  ctx.fill();
  ctx.stroke();
}

export function drawMeshCut(ctx, positions, frame, origin, normal, toCss) {
  if (!positions || positions.length < 9) return;
  const triCount = positions.length / 9;
  const step = triCount > 80000 ? 36 : triCount > 24000 ? 18 : 9;
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < positions.length; i += step) {
    const w = [0, 1, 2].map((k) => {
      const o = i + k * 3;
      return localToWorld(frame, [positions[o], positions[o + 1], positions[o + 2]]);
    });
    const hits = [];
    for (let e = 0; e < 3; e += 1) {
      const a = w[e];
      const b = w[(e + 1) % 3];
      const da = dot(sub(a, origin), normal);
      const db = dot(sub(b, origin), normal);
      if (da * db > 0) continue;
      const denom = da - db;
      if (Math.abs(denom) < 1e-8) continue;
      const t = da / denom;
      if (t < -0.001 || t > 1.001) continue;
      hits.push(add(a, scale(sub(b, a), t)));
    }
    if (hits.length >= 2) {
      const p0 = toCss(hits[0]);
      const p1 = toCss(hits[1]);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      any = true;
    }
  }
  if (!any) return;
  ctx.strokeStyle = VALVE_COLOR;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

export { VALVE_COLOR };
