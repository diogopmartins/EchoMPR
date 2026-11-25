/**
 * 3D leaflet model of a valve slicer result for one frame, in volume-local mm:
 * - the leaflet surface (the atrial face found by the height map), as a
 *   triangle mesh coloured by leaflet height above the reference,
 * - the annulus (the traced 3D curve, or the estimated outline on the picked
 *   plane),
 * - the coaptation line(s) lifted onto the leaflets,
 * - the key points (commissures, AoV, coaptation centre) and segment labels.
 *
 * Colours are sRGB in 0–1. Nothing here depends on three.js.
 */
import { heightColor } from './heightColors';
import { add, dot, scale, sub } from './mprGeometry';
import { frameToWorld, worldToFrame } from './mvSlicer';
import { heightFromReference, heightMap, referenceAt, towardVentricle } from './valveAnalysis';

/** Steepest slope kept between neighbouring vertices (height step per mm of
 * grid), so the mesh does not hang curtains across gaps and orifice edges. */
const MAX_SLOPE = 2.5;

/** Mean of the valid neighbours within `radius` pixels (display smoothing of speckle). */
function smooth(values, width, height, radius) {
  const out = new Float32Array(values.length).fill(NaN);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (Number.isNaN(values[j * width + i])) continue;
      let sum = 0;
      let n = 0;
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= width || jj >= height) continue;
          const v = values[jj * width + ii];
          if (Number.isNaN(v)) continue;
          sum += v;
          n++;
        }
      }
      out[j * width + i] = sum / n;
    }
  }
  return out;
}

/**
 * @param sample   trilinear sampler of the frame (valveAnalysis.makeSampler)
 * @param result   the slicer result as analysed (annulusFit.withAnnulus)
 * @param threshold tissue threshold for the frame
 * @param options  { mmPerPx = 0.5, rawPoints } — rawPoints: the picked points
 *   as clicked (MV: the AoV marker sits at the real AoV, above the plane)
 */
export function buildLeafletModel(sample, result, threshold, { mmPerPx = 0.5, rawPoints = null } = {}) {
  const down = towardVentricle(result);
  const up = scale(down, -1);
  const map = heightMap(sample, result, threshold, mmPerPx);
  const { width, height, frame } = map;

  // Absolute height above the picked plane = height above the reference + reference
  const abs = new Float32Array(width * height).fill(NaN);
  const pts = new Array(width * height).fill(null);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const h = map.heights[k];
      if (Number.isNaN(h)) continue;
      const q = frameToWorld(frame, frame.xMin + (i + 0.5) * mmPerPx, frame.yMin + (j + 0.5) * mmPerPx);
      pts[k] = q;
      abs[k] = h + referenceAt(result, q);
    }
  }
  // Smooth over ~2.5 mm whatever the grid
  const smoothAbs = smooth(abs, width, height, Math.max(1, Math.round(1 / mmPerPx)));
  const maxStepMm = MAX_SLOPE * Math.max(mmPerPx, 0.5);

  // Vertices: one per valid pixel
  const vertexOf = new Int32Array(width * height).fill(-1);
  const positions = [];
  const colors = [];
  const vertexHeights = [];
  const vertexSegments = [];
  const segSums = {};
  for (let k = 0; k < width * height; k++) {
    if (!pts[k]) continue;
    vertexOf[k] = positions.length / 3;
    const p = add(pts[k], scale(up, smoothAbs[k]));
    positions.push(p[0], p[1], p[2]);
    const c = heightColor(map.heights[k]);
    colors.push(c[0] / 255, c[1] / 255, c[2] / 255);
    vertexHeights.push(map.heights[k]);
    const seg = result.segmentAt(pts[k]);
    vertexSegments.push(seg || null);
    if (seg) {
      const s = segSums[seg] || (segSums[seg] = { sum: [0, 0, 0], n: 0 });
      s.sum = add(s.sum, p);
      s.n++;
    }
  }

  // Triangles over the grid, skipping steep jumps
  const indices = [];
  const tri = (a, b, c) => {
    const va = vertexOf[a];
    const vb = vertexOf[b];
    const vc = vertexOf[c];
    if (va < 0 || vb < 0 || vc < 0) return;
    const hs = [smoothAbs[a], smoothAbs[b], smoothAbs[c]];
    if (Math.max(...hs) - Math.min(...hs) > maxStepMm) return;
    indices.push(va, vb, vc);
  };
  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const a = j * width + i;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      tri(a, b, d);
      tri(a, d, c);
    }
  }

  // Annulus: the traced curve, or the estimated outline on the picked plane
  const annulusTraced = Boolean(result.annulus);
  const annulus = annulusTraced ? result.annulus.curve.filter((_, i) => i % 3 === 0) : result.roiPolygon;

  // A plane point lifted onto the leaflets (or the reference where none is found)
  const lift = (q, extraMm = 0) => {
    const { h, r } = heightFromReference(sample, result, q, down, threshold);
    return add(q, scale(up, (h == null ? 0 : h) + r + extraMm));
  };
  // A plane point moved onto the annulus (nearest point in the valve plane)
  const toAnnulus = (q) => {
    if (!annulusTraced) return q;
    const f = worldToFrame(frame, q);
    let best = annulus[0];
    let bestD = Infinity;
    annulus.forEach((p) => {
      const g = worldToFrame(frame, p);
      const d = Math.hypot(g.x - f.x, g.y - f.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return best;
  };

  // Coaptation line(s), a little above the leaflets so they stay visible
  const guides = result.guides.map((g) => {
    const out = [];
    for (let i = 0; i < g.points.length - 1; i++) {
      const a = g.points[i];
      const b = g.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(...sub(b, a)) / 1.5));
      for (let s = 0; s < n; s++) out.push(lift(add(a, scale(sub(b, a), s / n)), 0.4));
    }
    out.push(lift(g.points[g.points.length - 1], 0.4));
    return out;
  });

  const centreKeys = ['mid', 'c'];
  const markers = result.keyPoints.map((kp) => {
    let mm;
    if (kp.key === 'ao') mm = rawPoints?.ao || kp.point;
    else if (centreKeys.includes(kp.key)) mm = lift(kp.point, 0.4);
    else mm = toAnnulus(kp.point);
    return { key: kp.key, text: kp.text, color: kp.color, mm };
  });

  const segments = Object.entries(segSums).map(([text, s]) => ({
    text,
    mm: add(scale(s.sum, 1 / s.n), scale(up, 1.5)),
  }));

  return {
    kind: result.kind,
    reference: result.reference || 'picked',
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    // Per vertex: leaflet height above the reference (what the colour shows) and segment
    heights: Float32Array.from(vertexHeights),
    vertexSegments,
    indices: Uint32Array.from(indices),
    annulus,
    annulusTraced,
    guides,
    markers,
    segments,
    stats: map.stats,
    // En-face view axes of the key map (MV: surgical view, AoV up; TV: from the RA)
    view: {
      center: result.valveCenter,
      right: frame.right,
      down: frame.down,
      sizeMm: Math.max(frame.xMax - frame.xMin, frame.yMax - frame.yMin),
    },
    /** Height of a model vertex above the picked plane (for tests and tooltips). */
    heightAbove: (p) => dot(sub(p, result.valveCenter), up),
  };
}
