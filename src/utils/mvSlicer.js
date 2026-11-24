/**
 * Mitral valve slicer: nine long-axis cuts across the mitral valve, from the
 * anterolateral (AL) to the posteromedial (PM) commissure, to show which
 * scallop prolapses.
 *
 * The user marks the AL commissure, the middle of the coaptation line
 * (A2–P2), the PM commissure and the aortic valve (AoV) centre. Points are
 * best picked in an en-face (surgical) view of the valve.
 *
 * Cuts are planes that contain the valve axis (the normal of the valve
 * plane) and pass through targets spaced evenly along the coaptation curve.
 * - "fan": every cut also passes through the AoV centre, so the aortic valve
 *   is in every image (like rotating a TEE long-axis view across the valve).
 * - "parallel": cuts are perpendicular to the commissural line.
 *
 * Image orientation follows the TEE mid-oesophageal long-axis convention:
 * LA at the top, LV at the bottom, aortic side on the right. The LA→LV
 * direction comes from the anatomy itself: in the surgical view (AoV at 12
 * o'clock, AL commissure at 9 o'clock) the viewer looks from LA to LV, so
 * LA→LV = (AL→PM) × (anterior→posterior).
 *
 * Vectors are volume-local millimetres, as in mprGeometry.
 */
import { add, cross, dot, mmToVoxel, normalize, scale, spacingMm, sub, vecLen } from './mprGeometry';
import { getVolumeAtTime } from './philipsVolume';

export const MV_POINTS = [
  { key: 'al', label: 'AL commissure', short: 'AL', color: '#ffb74d' },
  { key: 'mid', label: 'Middle of coaptation (A2–P2)', short: 'Mid', color: '#ffb74d' },
  { key: 'pm', label: 'PM commissure', short: 'PM', color: '#ffb74d' },
  { key: 'ao', label: 'Aortic valve centre', short: 'Ao', color: '#e57373' },
];

export const MV_CUT_COUNT = 9;

/** Colours of the picked points, shared by the 2D panes and the key map. */
export const POINT_COLORS = {
  al: '#ffb74d',
  mid: '#ffb74d',
  pm: '#ffb74d',
  ao: '#e57373',
};

/** Carpentier segments, in the order the analysis reports them. */
export const MV_SEGMENTS = ['A1', 'A2', 'A3', 'P1', 'P2', 'P3'];

/** Margins around the anatomy in each cut, in mm. */
const MARGIN = {
  beyondAo: 15, // anterior to the AoV centre (aortic root)
  beyondPosterior: 25, // posterior to the coaptation target (P leaflet, annulus, LA wall)
  la: 20, // towards the LA from the valve level
  lv: 25, // towards the LV (chordae, papillary tips)
  keyMap: 10,
};

/** Approximate Carpentier segment seen in cut k (0-based) of n. */
export function scallopLabel(k, n) {
  if (k === 0) return 'AL comm';
  if (k === n - 1) return 'PM comm';
  const f = k / (n - 1);
  if (f < 1 / 3) return 'A1 / P1';
  if (f <= 2 / 3) return 'A2 / P2';
  return 'A3 / P3';
}

/** Quadratic through a (t=0), m (t=0.5), p (t=1). */
function quadratic(a, m, p, t) {
  const l0 = 2 * (t - 0.5) * (t - 1);
  const l1 = -4 * t * (t - 1);
  const l2 = 2 * t * (t - 0.5);
  return add(add(scale(a, l0), scale(m, l1)), scale(p, l2));
}

/** `count` points evenly spaced by arc length along the AL → Mid → PM curve. */
export function coaptationTargets(a, m, p, count) {
  const steps = 400;
  const pts = [];
  const cum = [0];
  for (let i = 0; i <= steps; i++) {
    pts.push(quadratic(a, m, p, i / steps));
    if (i > 0) cum.push(cum[i - 1] + vecLen(sub(pts[i], pts[i - 1])));
  }
  const total = cum[steps];
  const targets = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const want = count === 1 ? total / 2 : (total * k) / (count - 1);
    while (j < steps - 1 && cum[j + 1] < want) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (want - cum[j]) / seg));
    targets.push(add(pts[j], scale(sub(pts[j + 1], pts[j]), f)));
  }
  return { targets, lengthMm: total, curve: pts };
}

function rejectFrom(v, axis) {
  return sub(v, scale(axis, dot(v, axis)));
}

/**
 * Build the cut planes.
 *
 * @param {{al, mid, pm, ao}} points   world-mm points
 * @param {number[]|null} viewNormal   normal of the view the points were picked in
 * @param {{count?, mode?, flipVertical?, mirror?}} options
 * @returns {{ok: true, cuts, keyMap, ...} | {ok: false, error: string}}
 */
export function buildMvSlicer(points, viewNormal, options = {}) {
  const { count = MV_CUT_COUNT, mode = 'fan', flipVertical = false, mirror = false } = options;
  const { al, mid, pm, ao } = points || {};
  if (!al || !mid || !pm || !ao) return { ok: false, error: 'Place all four points first.' };

  const chordRaw = sub(pm, al);
  if (vecLen(chordRaw) < 5) {
    return { ok: false, error: 'The AL and PM commissures are less than 5 mm apart.' };
  }
  const throughAo = cross(chordRaw, sub(ao, al));
  // |chord × (ao − al)| / |chord| is the distance of the AoV from the AL–PM line.
  if (vecLen(throughAo) / vecLen(chordRaw) < 5) {
    return { ok: false, error: 'The aortic valve point lies on the AL–PM line; pick the AoV centre.' };
  }
  const pointsNormal = normalize(throughAo);

  // Prefer the view's normal (an en-face view of the valve); fall back to the
  // plane through the commissures and the AoV when the view was not en-face.
  let n = pointsNormal;
  let normalSource = 'points';
  if (viewNormal && vecLen(viewNormal) > 0) {
    const vn = normalize(viewNormal);
    if (Math.abs(dot(vn, pointsNormal)) >= 0.7) {
      n = vn;
      normalSource = 'view';
    }
  }

  // Valve-level plane through the three mitral points.
  const c0 = scale(add(add(al, mid), pm), 1 / 3);
  const proj = (p) => sub(p, scale(n, dot(sub(p, c0), n)));
  const A = proj(al);
  const M = proj(mid);
  const P = proj(pm);
  const AO = proj(ao);

  const chord = normalize(sub(P, A));
  const antRaw = rejectFrom(sub(AO, M), chord);
  if (vecLen(antRaw) < 3) {
    return { ok: false, error: 'The aortic valve point is level with the coaptation line; pick the AoV centre.' };
  }
  const ant = normalize(antRaw);
  const post = scale(ant, -1);
  let laToLv = normalize(cross(chord, post));
  if (flipVertical) laToLv = scale(laToLv, -1);
  const aoHeight = dot(sub(ao, c0), laToLv);

  const { targets, lengthMm, curve } = coaptationTargets(A, M, P, count);
  // Direction of the coaptation line at each target (for the virtual clip).
  const tangents = targets.map((t, k) =>
    normalize(sub(targets[Math.min(count - 1, k + 1)], targets[Math.max(0, k - 1)]))
  );

  const yMin = Math.min(-MARGIN.la, aoHeight - 12);
  const yMax = Math.max(MARGIN.lv, aoHeight + 12);
  const flipX = (lo, hi) => (mirror ? [-hi, -lo] : [lo, hi]);

  let cuts;
  if (mode === 'parallel') {
    const right = mirror ? post : ant;
    const xAo = Math.max(...targets.map((t) => dot(sub(AO, t), ant)));
    const [xMin, xMax] = flipX(-MARGIN.beyondPosterior - 3, xAo + MARGIN.beyondAo);
    cuts = targets.map((t, k) => {
      const planeNormal = normalize(cross(right, laToLv));
      return {
        index: k + 1,
        label: scallopLabel(k, count),
        ref: t,
        right,
        down: laToLv,
        xMin,
        xMax,
        yMin,
        yMax,
        target: { x: 0, y: 0 },
        ao: {
          x: dot(sub(AO, t), right),
          y: aoHeight,
          offPlaneMm: Math.abs(dot(sub(ao, t), planeNormal)),
        },
        segment: [add(t, scale(right, xMin)), add(t, scale(right, xMax))],
      };
    });
  } else {
    const dists = targets.map((t) => vecLen(sub(AO, t)));
    const dMax = Math.max(...dists);
    const [xMin, xMax] = flipX(-(dMax + MARGIN.beyondPosterior), MARGIN.beyondAo);
    cuts = targets.map((t, k) => {
      const towardAo = normalize(sub(AO, t));
      const right = mirror ? scale(towardAo, -1) : towardAo;
      return {
        index: k + 1,
        label: scallopLabel(k, count),
        ref: AO,
        right,
        down: laToLv,
        xMin,
        xMax,
        yMin,
        yMax,
        target: { x: dot(sub(t, AO), right), y: 0 },
        ao: { x: 0, y: aoHeight, offPlaneMm: 0 },
        segment: [add(AO, scale(right, xMin)), add(AO, scale(right, xMax))],
      };
    });
  }

  // Valve outline used for the analysis: a D shape through the commissures,
  // deeper on the anterior side (the coaptation line sits posteriorly). The
  // anterior extent stops short of the aortic root.
  const roiCenter = scale(add(A, P), 0.5);
  const cc = vecLen(sub(P, A));
  const aoFromChord = dot(sub(AO, roiCenter), ant);
  const semi = cc / 2 + 1.5;
  const antExtent = Math.max(6, Math.min(0.45 * cc, aoFromChord - 8));
  const postExtent = Math.max(5, 0.3 * cc);
  const roiPolygon = [];
  for (let i = 0; i < 72; i++) {
    const th = (2 * Math.PI * i) / 72;
    const u = semi * Math.cos(th);
    const v = Math.sin(th) * (Math.sin(th) > 0 ? postExtent : antExtent);
    roiPolygon.push(add(add(roiCenter, scale(chord, u)), scale(post, v)));
  }

  // Segment lookup: thirds along the commissural line from AL (1) to PM (3);
  // anterior or posterior of the coaptation curve.
  const curveUV = curve
    .map((p) => ({ u: dot(sub(p, A), chord), v: dot(sub(p, A), post) }))
    .sort((a, b) => a.u - b.u);
  const coaptVAt = (u) => {
    if (u <= curveUV[0].u) return curveUV[0].v;
    for (let i = 1; i < curveUV.length; i++) {
      if (curveUV[i].u >= u) {
        const a = curveUV[i - 1];
        const b = curveUV[i];
        const f = (u - a.u) / (b.u - a.u || 1);
        return a.v + f * (b.v - a.v);
      }
    }
    return curveUV[curveUV.length - 1].v;
  };
  const segmentAt = (q) => {
    const u = dot(sub(q, A), chord);
    const v = dot(sub(q, A), post);
    const third = Math.max(0, Math.min(2, Math.floor((3 * u) / cc)));
    return `${v < coaptVAt(u) ? 'A' : 'P'}${third + 1}`;
  };

  // En-face key map at valve level: AL on the left, AoV at the top (surgical view).
  const keyCenter = scale(add(add(A, P), AO), 1 / 3);
  const keyPts = [A, P, AO, M, ...roiPolygon, ...cuts.flatMap((c) => c.segment)];
  const kx = keyPts.map((p) => dot(sub(p, keyCenter), chord));
  const ky = keyPts.map((p) => dot(sub(p, keyCenter), post));
  const keyMap = {
    ref: keyCenter,
    right: chord,
    down: post,
    xMin: Math.min(...kx) - MARGIN.keyMap,
    xMax: Math.max(...kx) + MARGIN.keyMap,
    yMin: Math.min(...ky) - MARGIN.keyMap,
    yMax: Math.max(...ky) + MARGIN.keyMap,
    slabDir: laToLv,
  };

  const sideLabels = mirror ? { left: 'A', right: 'P' } : { left: 'P', right: 'A' };
  const leafletNames = mirror
    ? { left: 'anterior', right: 'posterior' }
    : { left: 'posterior', right: 'anterior' };
  cuts.forEach((c, k) => {
    c.sideLabels = sideLabels;
    c.leaflets = leafletNames;
    c.coaptDir = tangents[k];
  });

  return {
    ok: true,
    kind: 'mv',
    title: 'MV slicer',
    modeText: mode === 'parallel' ? 'Parallel cuts' : 'Fan through the AoV',
    keyPoints: [
      { key: 'al', text: 'AL', color: POINT_COLORS.al, point: A },
      { key: 'mid', text: 'Mid', color: POINT_COLORS.mid, point: M },
      { key: 'pm', text: 'PM', color: POINT_COLORS.pm, point: P },
      { key: 'ao', text: 'Ao', color: POINT_COLORS.ao, point: AO },
    ],
    guides: [{ points: curve, closed: false }],
    roiPolygon,
    segmentAt,
    segments: MV_SEGMENTS,
    mode,
    count,
    normal: n,
    normalSource,
    laToLv,
    anterior: ant,
    chord,
    valveCenter: c0,
    projected: { al: A, mid: M, pm: P, ao: AO },
    coaptationCurve: curve,
    coaptationLengthMm: lengthMm,
    spacingMm: count > 1 ? lengthMm / (count - 1) : 0,
    orientation: {
      top: flipVertical ? 'LV' : 'LA',
      bottom: flipVertical ? 'LA' : 'LV',
      left: mirror ? 'A' : 'P',
      right: mirror ? 'P' : 'A',
    },
    cuts,
    keyMap,
  };
}

/** Frame coordinates (mm) → sample pixel coordinates for an image at mmPerPx. */
export function frameToPixel(frame, x, y, mmPerPx) {
  return { px: (x - frame.xMin) / mmPerPx - 0.5, py: (y - frame.yMin) / mmPerPx - 0.5 };
}

/** World mm → frame coordinates (x along right, y along down, from ref). */
export function worldToFrame(frame, mm) {
  const d = sub(mm, frame.ref);
  return { x: dot(d, frame.right), y: dot(d, frame.down) };
}

/**
 * Resample one frame (a cut or the key map) of timepoint t with trilinear
 * interpolation. With slabMm > 0 the maximum along `frame.slabDir` over the
 * slab is taken (thin MIP), which shows leaflets better in the en-face map.
 */
export function sampleFrame(volume, t, frame, mmPerPx, { slabMm = 0 } = {}) {
  const width = Math.max(2, Math.round((frame.xMax - frame.xMin) / mmPerPx));
  const height = Math.max(2, Math.round((frame.yMax - frame.yMin) / mmPerPx));
  const data = new Uint8Array(width * height);
  const vol = getVolumeAtTime(volume, t);
  const { dims } = volume;
  const sp = spacingMm(volume);
  const toVox = (v) => ({ x: v[0] / sp.x, y: v[1] / sp.y, z: v[2] / sp.z });
  const du = toVox(scale(frame.right, mmPerPx));
  const dv = toVox(scale(frame.down, mmPerPx));
  const origin = add(
    add(frame.ref, scale(frame.right, frame.xMin + 0.5 * mmPerPx)),
    scale(frame.down, frame.yMin + 0.5 * mmPerPx)
  );
  const base = mmToVoxel(volume, origin);

  const slabSteps = [];
  if (slabMm > 0 && frame.slabDir) {
    const n = Math.max(2, Math.round(slabMm / Math.min(sp.x, sp.y, sp.z)));
    for (let k = 0; k <= n; k++) slabSteps.push(toVox(scale(frame.slabDir, -slabMm / 2 + (slabMm * k) / n)));
  } else {
    slabSteps.push({ x: 0, y: 0, z: 0 });
  }

  const plane = dims.y * dims.x;
  const sampleAt = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x > dims.x - 1 || y > dims.y - 1 || z > dims.z - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = Math.min(x0 + 1, dims.x - 1);
    const y1 = Math.min(y0 + 1, dims.y - 1);
    const z1 = Math.min(z0 + 1, dims.z - 1);
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;
    const r00 = z0 * plane + y0 * dims.x;
    const r10 = z0 * plane + y1 * dims.x;
    const r01 = z1 * plane + y0 * dims.x;
    const r11 = z1 * plane + y1 * dims.x;
    const c00 = vol[r00 + x0] * (1 - fx) + vol[r00 + x1] * fx;
    const c10 = vol[r10 + x0] * (1 - fx) + vol[r10 + x1] * fx;
    const c01 = vol[r01 + x0] * (1 - fx) + vol[r01 + x1] * fx;
    const c11 = vol[r11 + x0] * (1 - fx) + vol[r11 + x1] * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  };

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = base.x + du.x * i + dv.x * j;
      const y = base.y + du.y * i + dv.y * j;
      const z = base.z + du.z * i + dv.z * j;
      let v = 0;
      for (const s of slabSteps) {
        const val = sampleAt(x + s.x, y + s.y, z + s.z);
        if (val > v) v = val;
      }
      data[j * width + i] = v;
    }
  }
  return { data, width, height, mmPerPx };
}

/** Inverse of frameToPixel. */
export function pixelToFrame(frame, px, py, mmPerPx) {
  return { x: frame.xMin + (px + 0.5) * mmPerPx, y: frame.yMin + (py + 0.5) * mmPerPx };
}

/** Frame coordinates (mm) → world mm on the frame's plane. */
export function frameToWorld(frame, x, y) {
  return add(add(frame.ref, scale(frame.right, x)), scale(frame.down, y));
}

/**
 * Move a picked point to `inPlane` (a point on the valve-level plane) while
 * keeping its original depth along `normal`, so editing in the en-face key
 * map never changes how high the point sits (e.g. the AoV above the valve).
 */
export function moveKeepingDepth(old, inPlane, normal) {
  const n = normalize(normal);
  return add(inPlane, scale(n, dot(sub(old, inPlane), n)));
}
