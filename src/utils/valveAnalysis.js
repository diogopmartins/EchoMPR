/**
 * Leaflet analysis on a valve slicer result (MV or TV):
 * - height of the leaflet surface above the valve plane (prolapse map),
 * - per-cut leaflet traces with prolapse height, width and coaptation gap,
 * - orifice planimetry (MVA) and a rough "virtual clip" estimate,
 * - TEER measurements from points clicked in a cut,
 * - tenting (leaflets below the annulus) for functional regurgitation,
 * - per-frame summaries over the cardiac cycle.
 *
 * The leaflet surface is found by walking along the valve axis from the
 * atrial side and taking the first voxel bright enough to be tissue (two
 * consecutive samples above the threshold, to ignore single speckles).
 * Heights are positive towards the atrium. They are relative to the plane the
 * points were picked in, or, when the result carries `refHeight(q)` (see
 * annulusFit.withAnnulus), to a fitted annulus plane or saddle surface.
 */
import { add, dot, scale, spacingMm } from './mprGeometry';
import { getVolumeAtTime } from './philipsVolume';
import { frameToWorld, worldToFrame } from './mvSlicer';

/** Leaflet displacement above which a segment is reported as prolapsing. */
export const PROLAPSE_MM = 2;

/** Search range along the valve axis, mm (atrial side, ventricular side). */
const SEARCH = { atrial: 15, ventricular: 10, step: 0.25 };

/**
 * The leaflet search goes deeper on the ventricular side than the valve-level
 * checks, so tethered leaflets (tenting up to ~14 mm) are still found. Tissue
 * deeper than SEARCH.ventricular does not close a coaptation gap.
 */
const LEAFLET_DEPTH_MM = 14;

/** Extra orifice closed on each side of the device by tissue approximation (mm). */
export const CLIP_TISSUE_MARGIN_MM = 2;

export const CLIP_DEVICES = [
  { id: 4, label: '4 mm (MitraClip NT/XT)' },
  { id: 6, label: '6 mm (MitraClip NTW/XTW, PASCAL Ace)' },
  { id: 10, label: '10 mm (PASCAL P10)' },
];

/** Trilinear sampler of one timepoint, in world mm. Outside the volume = 0. */
export function makeSampler(volume, t) {
  const vol = getVolumeAtTime(volume, t);
  const { dims } = volume;
  const sp = spacingMm(volume);
  const plane = dims.x * dims.y;
  return (p) => {
    const x = p[0] / sp.x;
    const y = p[1] / sp.y;
    const z = p[2] / sp.z;
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
    const c0 =
      (vol[r00 + x0] * (1 - fx) + vol[r00 + x1] * fx) * (1 - fy) +
      (vol[r10 + x0] * (1 - fx) + vol[r10 + x1] * fx) * fy;
    const c1 =
      (vol[r01 + x0] * (1 - fx) + vol[r01 + x1] * fx) * (1 - fy) +
      (vol[r11 + x0] * (1 - fx) + vol[r11 + x1] * fx) * fy;
    return c0 * (1 - fz) + c1 * fz;
  };
}

/** Atrium → ventricle direction of a slicer result. */
export function towardVentricle(result) {
  return result.kind === 'tv' ? result.raToRv : result.laToLv;
}

const roiCache = new WeakMap();

/** Valve outline in key-map frame coordinates (cached per result). */
function roi2d(result) {
  let poly = roiCache.get(result);
  if (!poly) {
    poly = result.roiPolygon.map((p) => worldToFrame(result.keyMap, p));
    roiCache.set(result, poly);
  }
  return poly;
}

function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when a world point (on the valve plane) is inside the valve outline. */
export function insideValve(result, q) {
  const f = worldToFrame(result.keyMap, q);
  return pointInPolygon(roi2d(result), f.x, f.y);
}

function quantile(values, q) {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Tissue threshold for one frame: halfway between the blood level (median of
 * the samples around the valve) and the tissue level (98th percentile).
 */
export function estimateThreshold(sample, result) {
  const down = towardVentricle(result);
  const poly = roi2d(result);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const values = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += 1.5) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.5) {
      if (!pointInPolygon(poly, x, y)) continue;
      const q = frameToWorld(result.keyMap, x, y);
      for (let s = -SEARCH.atrial; s <= SEARCH.ventricular; s += 0.5) {
        values.push(sample(add(q, scale(down, s))));
      }
    }
  }
  if (!values.length) return { threshold: 128, blood: 0, tissue: 255 };
  const blood = quantile(values, 0.5);
  const tissue = quantile(values, 0.98);
  const threshold = tissue - blood < 20 ? blood + 10 : blood + 0.5 * (tissue - blood);
  return { threshold, blood, tissue };
}

/**
 * Height (mm, positive towards the atrium) of the first leaflet tissue met
 * when walking from the atrial side along `down` through the plane point q.
 * The surface is a blood → tissue transition: when the walk starts inside
 * tissue (atrial wall, aortic root), that tissue is passed over, so it does
 * not read as a leaflet at the top of the search range.
 * null when no tissue is found in the search range.
 */
export function leafletHeight(sample, q, down, threshold, depthMm = LEAFLET_DEPTH_MM) {
  let prev = false;
  let blood = false;
  for (let s = -SEARCH.atrial; s <= depthMm; s += SEARCH.step) {
    const hit = sample(add(q, scale(down, s))) >= threshold;
    if (!hit) blood = true;
    else if (prev && blood) return -(s - SEARCH.step);
    prev = hit;
  }
  return null;
}

/** Height of the reference surface above the picked plane at q (mm, towards the atrium). */
export function referenceAt(result, q) {
  return result.refHeight ? result.refHeight(q) : 0;
}

/**
 * Leaflet height at the plane point q relative to the result's reference
 * surface: the search starts on the reference, so it covers the same range
 * whatever the reference is. Returns { h, r } with r the reference height.
 */
export function heightFromReference(sample, result, q, down, threshold) {
  const r = referenceAt(result, q);
  const h = leafletHeight(sample, r ? add(q, scale(down, -r)) : q, down, threshold);
  return { h, r };
}

/**
 * Prolapse height map over the valve outline, on the key-map grid.
 * heights[i] is NaN outside the outline or where no leaflet was found.
 * Leaflet below the reference counts as tenting: its volume is the space
 * between the reference surface and the leaflets.
 */
export function heightMap(sample, result, threshold, mmPerPx = 0.5) {
  const frame = result.keyMap;
  const down = towardVentricle(result);
  const poly = roi2d(result);
  const width = Math.max(2, Math.round((frame.xMax - frame.xMin) / mmPerPx));
  const height = Math.max(2, Math.round((frame.yMax - frame.yMin) / mmPerPx));
  const heights = new Float32Array(width * height).fill(NaN);
  const segStats = {};
  result.segments.forEach((s) => {
    segStats[s] = { maxHeight: null, prolapseAreaMm2: 0, areaMm2: 0, maxTentingMm: 0, tentingVolumeMm3: 0 };
  });
  let maxHeight = null;
  let maxTentingMm = 0;
  let maxTentingAt = null;
  let tentingVolumeMm3 = 0;
  let tentingAreaMm2 = 0;
  let foundAreaMm2 = 0;
  let outlineAreaMm2 = 0;
  let maxAt = null;
  let maxSegment = null;
  let prolapseAreaMm2 = 0;
  // Extent of the prolapsing region along the key map's x axis, which for
  // the MV is the commissural direction (the EVEREST "flail width").
  let alongMin = Infinity;
  let alongMax = -Infinity;
  const pxArea = mmPerPx * mmPerPx;
  for (let j = 0; j < height; j++) {
    const y = frame.yMin + (j + 0.5) * mmPerPx;
    for (let i = 0; i < width; i++) {
      const x = frame.xMin + (i + 0.5) * mmPerPx;
      if (!pointInPolygon(poly, x, y)) continue;
      outlineAreaMm2 += pxArea;
      const q = frameToWorld(frame, x, y);
      const seg = result.segmentAt(q);
      if (seg && segStats[seg]) segStats[seg].areaMm2 += pxArea;
      const { h } = heightFromReference(sample, result, q, down, threshold);
      if (h == null) continue;
      heights[j * width + i] = h;
      foundAreaMm2 += pxArea;
      if (h < 0) {
        tentingVolumeMm3 += -h * pxArea;
        tentingAreaMm2 += pxArea;
        if (-h > maxTentingMm) {
          maxTentingMm = -h;
          maxTentingAt = q;
        }
        if (seg && segStats[seg]) {
          segStats[seg].tentingVolumeMm3 += -h * pxArea;
          segStats[seg].maxTentingMm = Math.max(segStats[seg].maxTentingMm, -h);
        }
      }
      if (maxHeight == null || h > maxHeight) {
        maxHeight = h;
        maxAt = q;
        maxSegment = seg;
      }
      if (seg && segStats[seg]) {
        const st = segStats[seg];
        if (st.maxHeight == null || h > st.maxHeight) st.maxHeight = h;
        if (h > PROLAPSE_MM) st.prolapseAreaMm2 += pxArea;
      }
      if (h > PROLAPSE_MM) {
        prolapseAreaMm2 += pxArea;
        alongMin = Math.min(alongMin, x);
        alongMax = Math.max(alongMax, x);
      }
    }
  }
  return {
    frame,
    mmPerPx,
    width,
    height,
    heights,
    stats: {
      maxHeight,
      maxAt,
      maxSegment,
      prolapseAreaMm2,
      prolapseWidthMm: alongMax >= alongMin ? alongMax - alongMin + mmPerPx : 0,
      maxTentingMm,
      maxTentingAt,
      tentingVolumeMm3,
      tentingAreaMm2,
      foundAreaMm2,
      outlineAreaMm2,
      reference: result.reference || 'picked',
      segments: segStats,
    },
  };
}

/**
 * Leaflet trace along one cut at valve level, inside the valve outline.
 * Returns the trace, the highest point, the width of the prolapsing run
 * around it, the coaptation gap (the run without tissue at the target), and
 * the tenting: the area between the reference and the leaflets below it, and
 * the depth of the leaflets at the coaptation (within 3 mm of the target).
 * Each trace point is { x, h, r }: h relative to the reference, r the
 * reference height above the picked plane (the trace sits at y = −(h + r)).
 */
export function cutProfile(sample, result, cut, threshold, step = 0.25) {
  const down = towardVentricle(result);
  const pts = [];
  for (let x = cut.xMin; x <= cut.xMax; x += step) {
    const q = frameToWorld(cut, x, 0);
    if (!insideValve(result, q)) continue;
    const { h, r } = heightFromReference(sample, result, q, down, threshold);
    pts.push({ x, h, r });
  }
  if (!pts.length) {
    return {
      points: [],
      maxHeight: null,
      maxX: null,
      maxLeaflet: null,
      prolapseWidthMm: 0,
      gapMm: 0,
      tentingAreaMm2: 0,
      tentingHeightMm: null,
    };
  }
  let best = -1;
  pts.forEach((p, i) => {
    if (p.h != null && (best < 0 || p.h > pts[best].h)) best = i;
  });
  let prolapseWidthMm = 0;
  if (best >= 0 && pts[best].h > PROLAPSE_MM) {
    let a = best;
    let b = best;
    while (a > 0 && pts[a - 1].h != null && pts[a - 1].h > PROLAPSE_MM) a--;
    while (b < pts.length - 1 && pts[b + 1].h != null && pts[b + 1].h > PROLAPSE_MM) b++;
    prolapseWidthMm = (b - a + 1) * step;
  }
  // Gap: the run of samples without tissue at valve level that contains the
  // coaptation target (deeper tissue, e.g. chordae, does not close it).
  const open = (p) => p.h == null || p.h < -SEARCH.ventricular;
  let k = 0;
  pts.forEach((p, i) => {
    if (Math.abs(p.x - cut.target.x) < Math.abs(pts[k].x - cut.target.x)) k = i;
  });
  let gapMm = 0;
  if (open(pts[k])) {
    let a = k;
    let b = k;
    while (a > 0 && open(pts[a - 1])) a--;
    while (b < pts.length - 1 && open(pts[b + 1])) b++;
    // A run that reaches the edge of the outline is not bounded by two leaflets.
    if (a > 0 && b < pts.length - 1) gapMm = (b - a + 1) * step;
  }
  let tentingAreaMm2 = 0;
  let deepest = null;
  pts.forEach((p) => {
    if (p.h == null) return;
    if (p.h < 0) tentingAreaMm2 += -p.h * step;
    if (Math.abs(p.x - cut.target.x) <= 3 && (deepest == null || p.h < deepest)) deepest = p.h;
  });
  const maxX = best >= 0 ? pts[best].x : null;
  return {
    points: pts,
    maxHeight: best >= 0 ? pts[best].h : null,
    maxX,
    maxLeaflet: maxX == null ? null : maxX < cut.target.x ? cut.leaflets.left : cut.leaflets.right,
    prolapseWidthMm,
    gapMm,
    tentingAreaMm2,
    tentingHeightMm: deepest == null || gapMm > 0 ? null : Math.max(0, -deepest),
  };
}

/**
 * The cuts sample their lines more finely (0.25 mm) than the map grid, so a
 * cut can find a point a little higher or deeper than the map. The summary
 * takes the more extreme of the two, overall and per segment, so no cut ever
 * reads beyond the summary (e.g. a coaptation depth deeper than the deepest
 * leaflet point). Returns new stats; the map itself is unchanged.
 */
export function mergeCutExtremes(stats, profiles, result) {
  const segments = {};
  Object.entries(stats.segments).forEach(([k, v]) => {
    segments[k] = { ...v };
  });
  const out = { ...stats, segments };
  result.cuts.forEach((cut, i) => {
    const prof = profiles[i];
    if (!prof) return;
    prof.points.forEach((pt) => {
      if (pt.h == null) return;
      const q = frameToWorld(cut, pt.x, 0);
      const seg = result.segmentAt(q);
      const st = seg ? segments[seg] : null;
      if (out.maxHeight == null || pt.h > out.maxHeight) {
        out.maxHeight = pt.h;
        out.maxAt = q;
        out.maxSegment = seg;
      }
      if (st && (st.maxHeight == null || pt.h > st.maxHeight)) st.maxHeight = pt.h;
      if (-pt.h > out.maxTentingMm) {
        out.maxTentingMm = -pt.h;
        out.maxTentingAt = q;
      }
      if (st && -pt.h > st.maxTentingMm) st.maxTentingMm = -pt.h;
    });
  });
  return out;
}

/**
 * Orifice area for one frame: at planes from the valve level towards the
 * ventricle, flood-fill the blood region around the seed inside the valve
 * outline; regions that reach the outline are not enclosed by leaflets and
 * are skipped. The smallest enclosed area over depth is the orifice at the
 * leaflet tips. An enclosed region only counts when, going deeper, it carries
 * on (overlapping from one depth to the next) until it opens into the
 * ventricle: the funnel of a closed, tented valve is enclosed too, but it
 * ends in the leaflets. With an annulus reference (saddle) the sections
 * follow that surface instead of flat planes, so a saddle-shaped valve can
 * seal them. Depths are below the reference.
 * Returns null when no enclosed orifice is found.
 */
export function orificeAt(sample, result, threshold, seedWorld, { mmPerPx = 0.4, maxDepthMm = 15 } = {}) {
  const frame = result.keyMap;
  const down = towardVentricle(result);
  const poly = roi2d(result);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.ceil((Math.max(...xs) - x0) / mmPerPx) + 1;
  const h = Math.ceil((Math.max(...ys) - y0) / mmPerPx) + 1;
  const inside = new Uint8Array(w * h);
  const coords = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + i * mmPerPx;
      const y = y0 + j * mmPerPx;
      const k = j * w + i;
      coords.push({ x, y, q: null });
      if (pointInPolygon(poly, x, y)) {
        inside[k] = 1;
        const q = frameToWorld(frame, x, y);
        // Point on the reference surface above this pixel
        coords[k].q = add(q, scale(down, -referenceAt(result, q)));
      }
    }
  }
  const seedF = worldToFrame(frame, seedWorld);
  // State per depth: 'closed' (tissue across the seed or a sliver of blood),
  // 'open' (the blood reaches the outline) or 'enclosed', with the region.
  const states = [];
  for (let d = -2; d <= maxDepthMm; d += 0.5) {
    const dark = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) {
      if (!inside[k]) continue;
      if (sample(add(coords[k].q, scale(down, d))) < threshold) dark[k] = 1;
    }
    // Seed: nearest dark pixel to the valve centre, within 4 mm.
    let seed = -1;
    let seedD = 4;
    for (let k = 0; k < w * h; k++) {
      if (!dark[k]) continue;
      const dd = Math.hypot(coords[k].x - seedF.x, coords[k].y - seedF.y);
      if (dd < seedD) {
        seedD = dd;
        seed = k;
      }
    }
    if (seed < 0) {
      states.push('closed');
      continue;
    }
    const mask = new Uint8Array(w * h);
    const queue = [seed];
    mask[seed] = 1;
    let count = 0;
    let leaked = false;
    while (queue.length) {
      const k = queue.pop();
      count++;
      const i = k % w;
      const j = (k - i) / w;
      const nbrs = [
        i > 0 ? k - 1 : -1,
        i < w - 1 ? k + 1 : -1,
        j > 0 ? k - w : -1,
        j < h - 1 ? k + w : -1,
      ];
      for (const nb of nbrs) {
        if (nb < 0 || !inside[nb]) {
          leaked = true;
          continue;
        }
        if (!mask[nb] && dark[nb]) {
          mask[nb] = 1;
          queue.push(nb);
        }
      }
    }
    if (leaked) {
      states.push({ kind: 'open', mask });
      continue;
    }
    const areaMm2 = count * mmPerPx * mmPerPx;
    if (areaMm2 < 3) states.push('closed');
    else states.push({ kind: 'enclosed', count, mask, areaMm2, depthMm: d, grid: { x0, y0, w, h, mmPerPx } });
  }
  let best = null;
  let below = null; // region at the next depth that leads into the ventricle
  for (let i = states.length - 1; i >= 0; i--) {
    const st = states[i];
    if (st === 'closed') {
      below = null;
    } else if (st.kind === 'open') {
      below = st.mask;
    } else {
      let common = 0;
      if (below) for (let k = 0; k < st.mask.length; k++) if (st.mask[k] && below[k]) common++;
      if (common >= 0.5 * st.count) {
        below = st.mask;
        if (!best || st.areaMm2 < best.areaMm2) {
          best = { areaMm2: st.areaMm2, depthMm: st.depthMm, mask: st.mask, grid: st.grid };
        }
      } else {
        below = null;
      }
    }
  }
  return best;
}

/** Orifice per frame and the largest over the cycle (taken as the diastolic MVA). */
export function orificeOverCycle(volume, result, seedWorld, thresholdFor) {
  const perFrame = [];
  for (let t = 0; t < volume.dims.t; t++) {
    const sample = makeSampler(volume, t);
    const thr = thresholdFor(sample, t);
    perFrame.push(orificeAt(sample, result, thr, seedWorld));
  }
  let bestFrame = -1;
  perFrame.forEach((o, t) => {
    if (o && (bestFrame < 0 || o.areaMm2 > perFrame[bestFrame].areaMm2)) bestFrame = t;
  });
  return { perFrame, bestFrame, best: bestFrame >= 0 ? perFrame[bestFrame] : null };
}

/**
 * Rough geometric estimate of the orifice left after an edge-to-edge device:
 * closes a band across the orifice, centred at `clipWorld` and perpendicular
 * to the coaptation line (`coaptDir`), of the device width plus a margin of
 * approximated tissue on each side. Not a validated predictor.
 */
export function virtualClip(orifice, result, clipWorld, coaptDir, deviceWidthMm) {
  const { mask, grid } = orifice;
  const band = deviceWidthMm + 2 * CLIP_TISSUE_MARGIN_MM;
  const frame = result.keyMap;
  const c = worldToFrame(frame, clipWorld);
  const dirF = { x: dot(coaptDir, frame.right), y: dot(coaptDir, frame.down) };
  const len = Math.hypot(dirF.x, dirF.y) || 1;
  const ux = dirF.x / len;
  const uy = dirF.y / len;
  const px = grid.mmPerPx * grid.mmPerPx;
  let sideA = 0;
  let sideB = 0;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    const i = k % grid.w;
    const j = (k - i) / grid.w;
    const along = (grid.x0 + i * grid.mmPerPx - c.x) * ux + (grid.y0 + j * grid.mmPerPx - c.y) * uy;
    if (along < -band / 2) sideA += px;
    else if (along > band / 2) sideB += px;
  }
  return { bandMm: band, beforeMm2: orifice.areaMm2, afterMm2: sideA + sideB, sideAMm2: sideA, sideBMm2: sideB };
}

/** Clip position and coaptation direction for a cut. */
export function clipSiteForCut(result, cut) {
  const site = frameToWorld(cut, cut.target.x, 0);
  return { site, coaptDir: cut.coaptDir };
}

export const TEER_STEPS = [
  { key: 'hingeL', label: (c) => `${cap(c.leaflets.left)} hinge (annulus)` },
  { key: 'hingeR', label: (c) => `${cap(c.leaflets.right)} hinge (annulus)` },
  { key: 'coapt', label: () => 'Coaptation point (first contact)' },
  { key: 'tipL', label: (c) => `${cap(c.leaflets.left)} leaflet tip` },
  { key: 'tipR', label: (c) => `${cap(c.leaflets.right)} leaflet tip` },
];

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * TEER measurements from points clicked in one cut (cut-frame mm). `ySign`
 * is +1 when the cut's y axis points towards the ventricle.
 */
export function teerMeasures(pts, cut, ySign = 1) {
  const out = { leaflets: cut.leaflets };
  if (pts.hingeL && pts.hingeR) out.annulusMm = d2(pts.hingeL, pts.hingeR);
  if (pts.hingeL && pts.tipL) out.lengthLMm = d2(pts.hingeL, pts.tipL);
  if (pts.hingeR && pts.tipR) out.lengthRMm = d2(pts.hingeR, pts.tipR);
  if (pts.tipL && pts.tipR) out.tipGapMm = d2(pts.tipL, pts.tipR);
  if (pts.hingeL && pts.hingeR && pts.coapt) {
    const hx = pts.hingeR.x - pts.hingeL.x;
    const hy = pts.hingeR.y - pts.hingeL.y;
    const hl = Math.hypot(hx, hy) || 1;
    let nx = -hy / hl;
    let ny = hx / hl;
    if (ny * ySign < 0) {
      nx = -nx;
      ny = -ny;
    }
    out.coaptDepthMm = (pts.coapt.x - pts.hingeL.x) * nx + (pts.coapt.y - pts.hingeL.y) * ny;
  }
  if (pts.coapt && pts.tipL && pts.tipR) {
    const mid = { x: (pts.tipL.x + pts.tipR.x) / 2, y: (pts.tipL.y + pts.tipR.y) / 2 };
    out.coaptLengthMm = d2(pts.coapt, mid);
  }
  return out;
}

/**
 * Anatomical suitability checks for mitral TEER (EVEREST-style criteria),
 * from the TEER measurements, the widest prolapse, and the MVA.
 */
export function teerCriteria({ measures: measuresIn, flailWidthMm = null, mvaMm2 = null }) {
  const measures = measuresIn || {};
  const posteriorLen =
    measures.leaflets?.left === 'posterior'
      ? measures.lengthLMm
      : measures.leaflets?.right === 'posterior'
        ? measures.lengthRMm
        : undefined;
  const row = (label, value, unit, ok, rule) => ({
    label,
    value: value == null ? null : value,
    unit,
    ok: value == null ? null : ok(value),
    rule,
  });
  return [
    row('Coaptation length', measures.coaptLengthMm, 'mm', (v) => v >= 2, '≥ 2 mm'),
    row('Coaptation depth', measures.coaptDepthMm, 'mm', (v) => v <= 11, '≤ 11 mm'),
    row('Tip-to-tip (flail) gap', measures.tipGapMm, 'mm', (v) => v < 10, '< 10 mm'),
    row('Prolapse width (this frame)', flailWidthMm, 'mm', (v) => v < 15, '< 15 mm'),
    row('Posterior leaflet length', posteriorLen, 'mm', (v) => v >= 10, '≥ 10 mm'),
    row('MVA (planimetry)', mvaMm2 == null ? null : mvaMm2 / 100, 'cm²', (v) => v >= 4, '≥ 4.0 cm²'),
  ];
}


/** Point the orifice flood fill starts from (the coaptation centre). */
export function orificeSeed(result) {
  return result.kind === 'mv' ? result.projected.mid : result.projected.c;
}

/**
 * Summary of one frame for the cycle charts: the highest leaflet point, the
 * widest coaptation gap over the cuts, the tenting, and the orifice area.
 * Same sampling as the live analysis of a frame (0.5 mm map, 0.25 mm cuts),
 * so a chart reads the same value as the panel for the frame on screen.
 */
export function frameMetrics(sample, result, threshold, { mmPerPx = 0.5, cutStepMm = 0.25, withOrifice = true } = {}) {
  const map = heightMap(sample, result, threshold, mmPerPx);
  const profiles = result.cuts.map((cut) => cutProfile(sample, result, cut, threshold, cutStepMm));
  let gapMm = 0;
  let gapCut = null;
  profiles.forEach((p, i) => {
    if (p.gapMm > gapMm) {
      gapMm = p.gapMm;
      gapCut = result.cuts[i].index;
    }
  });
  const orifice = withOrifice ? orificeAt(sample, result, threshold, orificeSeed(result)) : null;
  const st = mergeCutExtremes(map.stats, profiles, result);
  return {
    threshold,
    maxHeightMm: st.maxHeight,
    maxSegment: st.maxSegment,
    prolapseAreaMm2: st.prolapseAreaMm2,
    gapMm,
    gapCut,
    maxTentingMm: st.maxTentingMm,
    tentingVolumeMm3: st.tentingVolumeMm3,
    orificeMm2: orifice ? orifice.areaMm2 : null,
    orifice,
    // Share of the valve area where a leaflet was found: close to 1 when the
    // valve is closed, lower when the orifice is open.
    coverage: st.outlineAreaMm2 > 0 ? st.foundAreaMm2 / st.outlineAreaMm2 : 0,
  };
}

/**
 * A frame counts as closed when its leaflet coverage is near the best of the
 * cycle, and it has no orifice comparable with the largest of the cycle
 * (once that one is big enough to be a diastolic orifice).
 */
export const CLOSED_COVERAGE = 0.85;
const OPEN_ORIFICE_SHARE = 0.4;
const DIASTOLIC_ORIFICE_MM2 = 100;

/** The frame with the largest value of a metric, or null when it never applies. */
function argMax(frames, key, min = -Infinity, use = null) {
  let best = null;
  frames.forEach((m, t) => {
    const v = m?.[key];
    if ((use && !use[t]) || v == null || !(v > min)) return;
    if (best == null || v > frames[best][key]) best = t;
  });
  return best;
}

/**
 * Frames worth jumping to after a cycle analysis: the worst prolapse and the
 * widest gap (systole in degenerative MR), the most tenting (systole in
 * functional MR/TR) and the largest orifice (diastole). The systolic ones are
 * looked for in closed frames only (an open orifice reads as a gap, and open
 * leaflets as tenting); the orifice in open frames only (a regurgitant gap is
 * not the MVA). `closed[t]` says how each frame was classed.
 */
export function cycleJumps(frames) {
  const best = Math.max(0, ...frames.map((m) => m?.coverage || 0));
  const maxOrifice = Math.max(0, ...frames.map((m) => m?.orificeMm2 || 0));
  const bigOrifice = (m) =>
    maxOrifice >= DIASTOLIC_ORIFICE_MM2 && (m.orificeMm2 || 0) >= OPEN_ORIFICE_SHARE * maxOrifice;
  const closed = frames.map(
    (m) => Boolean(m) && best > 0 && m.coverage >= CLOSED_COVERAGE * best && !bigOrifice(m)
  );
  const open = closed.map((c) => !c);
  return {
    closed,
    maxProlapse: argMax(frames, 'maxHeightMm', -Infinity, closed),
    widestGap: argMax(frames, 'gapMm', 0, closed),
    maxTenting: argMax(frames, 'tentingVolumeMm3', 0, closed),
    largestOrifice: argMax(frames, 'orificeMm2', 0, open),
  };
}
