/**
 * Tricuspid valve slicer: cuts across each of the three coaptation lines
 * (anteroseptal, posteroseptal, anteroposterior) to look for prolapse and
 * coaptation gaps, e.g. when planning tricuspid edge-to-edge repair.
 *
 * The user marks the three commissures (A–S, P–S, A–P) and the centre of
 * coaptation, preferably in an en-face view of the valve. For each
 * coaptation line (centre → commissure) three cuts are placed at 1/4, 1/2 and
 * 3/4 of its length, perpendicular to the line and containing the valve axis,
 * so each cut shows the two leaflets that meet on that line.
 *
 * Orientation: RA at the top. RA→RV comes from the anatomy: seen from the RA
 * with the septal leaflet at 6 o'clock (the same base-of-heart view in which
 * the mitral surgical view has the AoV at 12 o'clock and AL at 9), the
 * commissures run A–S → A–P → P–S clockwise. "Flip RA/RV" overrides it.
 *
 * Vectors are volume-local millimetres, as in mprGeometry.
 */
import { add, cross, dot, normalize, scale, sub, vecLen } from './mprGeometry';

export const TV_POINT_COLORS = { as: '#ffb74d', ps: '#ffb74d', ap: '#ffb74d', c: '#4fc3f7' };

export const TV_POINTS = [
  { key: 'as', label: 'Anteroseptal commissure', short: 'A–S', color: TV_POINT_COLORS.as },
  { key: 'ps', label: 'Posteroseptal commissure', short: 'P–S', color: TV_POINT_COLORS.ps },
  { key: 'ap', label: 'Anteroposterior commissure', short: 'A–P', color: TV_POINT_COLORS.ap },
  { key: 'c', label: 'Centre of coaptation', short: 'C', color: TV_POINT_COLORS.c },
];
export const TV_SEGMENTS = ['A', 'S', 'P'];
const LEAFLET_NAME = { A: 'anterior', S: 'septal', P: 'posterior' };

/** Fractions along each coaptation line (centre → commissure) where cuts sit. */
const CUT_FRACTIONS = [0.25, 0.5, 0.75];
const FRACTION_LABELS = ['inner', 'mid', 'outer'];

const MARGIN = { half: 20, ra: 20, rv: 25, keyMap: 10 };

const reject = (v, axis) => sub(v, scale(axis, dot(v, axis)));

/**
 * @param {{as, ps, ap, c}} points world-mm points
 * @param {number[]|null} viewNormal normal of the view the points were picked in
 * @param {{flipVertical?, mirror?}} options
 */
export function buildTvSlicer(points, viewNormal, options = {}) {
  const { flipVertical = false, mirror = false } = options;
  const { as, ps, ap, c } = points || {};
  if (!as || !ps || !ap || !c) return { ok: false, error: 'Place all four points first.' };

  const tri = cross(sub(ps, as), sub(ap, as));
  if (vecLen(tri) < 20) {
    return { ok: false, error: 'The three commissures are almost in a line; check the points.' };
  }
  const pointsNormal = normalize(tri);
  let n = pointsNormal;
  let normalSource = 'points';
  if (viewNormal && vecLen(viewNormal) > 0) {
    const vn = normalize(viewNormal);
    if (Math.abs(dot(vn, pointsNormal)) >= 0.7) {
      n = vn;
      normalSource = 'view';
    }
  }

  const c0 = scale(add(add(as, ps), add(ap, c)), 1 / 4);
  const proj = (p) => sub(p, scale(n, dot(sub(p, c0), n)));
  const AS = proj(as);
  const PS = proj(ps);
  const AP = proj(ap);
  const C = proj(c);
  for (const [K, name] of [[AS, 'A–S'], [PS, 'P–S'], [AP, 'A–P']]) {
    if (vecLen(sub(K, C)) < 4) {
      return { ok: false, error: `The ${name} commissure is less than 4 mm from the centre.` };
    }
  }

  // RA→RV: A–S → A–P is clockwise when seen from the RA (into the screen).
  const chir = dot(cross(sub(AS, C), sub(AP, C)), n);
  let raToRv = chir >= 0 ? n : scale(n, -1);
  if (flipVertical) raToRv = scale(raToRv, -1);

  // Each coaptation line, its two leaflets (left | right) and the commissure on
  // the right-hand leaflet's side.
  const lines = [
    { name: 'A–S', K: AS, left: 'A', right: 'S', towards: PS, away: AP },
    { name: 'P–S', K: PS, left: 'S', right: 'P', towards: AP, away: AS },
    { name: 'A–P', K: AP, left: 'A', right: 'P', towards: PS, away: AS },
  ];

  const cuts = [];
  for (const line of lines) {
    const dir = normalize(sub(line.K, C));
    let right = normalize(reject(sub(line.towards, C), dir));
    const awaySide = dot(reject(sub(line.away, C), dir), right);
    if (awaySide >= 0) {
      return {
        ok: false,
        error: 'The centre of coaptation must lie inside the three commissures; check the points.',
      };
    }
    let sides = { left: line.left, right: line.right };
    if (mirror) {
      right = scale(right, -1);
      sides = { left: line.right, right: line.left };
    }
    const length = vecLen(sub(line.K, C));
    CUT_FRACTIONS.forEach((f, i) => {
      const ref = add(C, scale(dir, f * length));
      cuts.push({
        index: cuts.length + 1,
        label: `${line.name} · ${FRACTION_LABELS[i]}`,
        line: line.name,
        ref,
        right,
        down: raToRv,
        xMin: -MARGIN.half,
        xMax: MARGIN.half,
        yMin: -MARGIN.ra,
        yMax: MARGIN.rv,
        target: { x: 0, y: 0 },
        ao: null,
        sideLabels: sides,
        leaflets: { left: LEAFLET_NAME[sides.left], right: LEAFLET_NAME[sides.right] },
        coaptDir: dir,
        segment: [add(ref, scale(right, -MARGIN.half)), add(ref, scale(right, MARGIN.half))],
      });
    });
  }

  // Valve outline for the analysis: a circle through (about) the commissures.
  const comCenter = scale(add(add(AS, PS), AP), 1 / 3);
  const radius =
    1.1 * ((vecLen(sub(AS, comCenter)) + vecLen(sub(PS, comCenter)) + vecLen(sub(AP, comCenter))) / 3);
  const u0 = normalize(sub(AS, comCenter));
  const v0 = normalize(cross(n, u0));
  const roiPolygon = [];
  for (let i = 0; i < 72; i++) {
    const th = (2 * Math.PI * i) / 72;
    roiPolygon.push(add(comCenter, add(scale(u0, radius * Math.cos(th)), scale(v0, radius * Math.sin(th)))));
  }

  // Leaflet sectors: a point is in the sector between two commissures when it
  // is on the same side of each bounding line as the other bounding commissure.
  // side(K, q): which side of the ray C→K the point q lies on.
  const side = (K, q) => dot(cross(sub(K, C), sub(q, C)), n);
  const inSector = (K1, K2, q) => side(K1, q) * side(K1, K2) >= 0 && side(K2, q) * side(K2, K1) >= 0;
  const sectors = [
    { seg: 'S', K1: AS, K2: PS },
    { seg: 'A', K1: AS, K2: AP },
    { seg: 'P', K1: PS, K2: AP },
  ];
  const segmentAt = (q) => {
    const hit = sectors.find((s) => inSector(s.K1, s.K2, q));
    return hit ? hit.seg : null;
  };

  // Key map: en-face from the RA, septal leaflet at 6 o'clock.
  let septal = normalize(add(normalize(sub(AS, C)), normalize(sub(PS, C))));
  if (dot(septal, sub(AP, C)) > 0) septal = scale(septal, -1);
  const keyRight = normalize(cross(septal, raToRv));
  const keyPts = [AS, PS, AP, C, ...roiPolygon, ...cuts.flatMap((k) => k.segment)];
  const kx = keyPts.map((p) => dot(sub(p, C), keyRight));
  const ky = keyPts.map((p) => dot(sub(p, C), septal));
  const keyMap = {
    ref: C,
    right: keyRight,
    down: septal,
    xMin: Math.min(...kx) - MARGIN.keyMap,
    xMax: Math.max(...kx) + MARGIN.keyMap,
    yMin: Math.min(...ky) - MARGIN.keyMap,
    yMax: Math.max(...ky) + MARGIN.keyMap,
    slabDir: raToRv,
  };

  return {
    ok: true,
    kind: 'tv',
    title: 'TV slicer',
    modeText: 'Cuts across each coaptation line',
    keyPoints: [
      { key: 'as', text: 'A–S', color: TV_POINT_COLORS.as, point: AS },
      { key: 'ps', text: 'P–S', color: TV_POINT_COLORS.ps, point: PS },
      { key: 'ap', text: 'A–P', color: TV_POINT_COLORS.ap, point: AP },
      { key: 'c', text: 'C', color: TV_POINT_COLORS.c, point: C },
    ],
    guides: [
      { points: [C, AS], closed: false },
      { points: [C, PS], closed: false },
      { points: [C, AP], closed: false },
    ],
    roiPolygon,
    segmentAt,
    segments: TV_SEGMENTS,
    normal: n,
    normalSource,
    raToRv,
    valveCenter: c0,
    projected: { as: AS, ps: PS, ap: AP, c: C },
    orientation: {
      top: flipVertical ? 'RV' : 'RA',
      bottom: flipVertical ? 'RA' : 'RV',
    },
    cuts,
    keyMap,
  };
}
