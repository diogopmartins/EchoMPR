/**
 * Where along the coaptation line an edge-to-edge clip could go. Each cut of
 * a valve slicer is a candidate clip position: the cut is the long-axis
 * grasping view through that point of the coaptation line.
 *
 * Per cut, from its leaflet trace in the current frame (read it in systole):
 * - the leaflets on both sides are long enough to grasp,
 * - the coaptation there is clippable (gap and coaptation depth),
 * - there is a lesion to treat there (prolapse or a coaptation gap).
 * Whole-valve limits (flail width, MVA, the orifice left after a clip) apply
 * to every position.
 *
 * MV limits follow the EVEREST anatomical criteria; the posterior leaflet
 * length is a commonly used extra one. TV: a small coaptation gap predicts
 * T-TEER success. This is a geometric screen of the images, not a decision.
 */
import { PROLAPSE_MM } from './valveAnalysis';

export const CLIP_RULES = {
  mv: {
    flailGapMm: 10, // EVEREST: flail gap < 10 mm
    coaptDepthMm: 11, // EVEREST: coaptation depth ≤ 11 mm
    flailWidthMm: 15, // EVEREST: flail width < 15 mm
    mvaMm2: 400, // EVEREST: MVA ≥ 4.0 cm²
    posteriorMm: 10, // commonly used: posterior leaflet ≥ 10 mm
    stenosisMm2: 150, // severe mitral stenosis: MVA ≤ 1.5 cm²
  },
  tv: {
    gapMm: 7.2, // smaller gaps predict T-TEER success
  },
};

export const STATUS = {
  target: { label: 'Clip target', color: '#43a047', text: 'Lesion here, anatomy within the criteria' },
  suitable: { label: 'Suitable', color: '#81c784', text: 'Anatomy within the criteria, no lesion found here' },
  caution: { label: 'Caution', color: '#ffb74d', text: 'Possible, with a concern (hover for why)' },
  unfavourable: { label: 'Unfavourable', color: '#ef5350', text: 'Outside the anatomical criteria' },
  unknown: { label: 'Not assessed', color: '#9e9e9e', text: 'No leaflets found in this cut' },
};

const fmt = (v) => `${v.toFixed(1)} mm`;
const fmtCm2 = (v) => `${(v / 100).toFixed(2)} cm²`;

/**
 * Limits that apply to the whole valve rather than a position (shown apart,
 * so they do not hide where along the coaptation line a clip could go):
 * MV flail width and MVA.
 */
export function valveLimits(result, { prolapseWidthMm = 0, mvaMm2 = null } = {}) {
  if (result.kind !== 'mv') return [];
  const R = CLIP_RULES.mv;
  const out = [];
  if (prolapseWidthMm >= R.flailWidthMm) {
    out.push({
      level: 'caution',
      text: `Prolapse ${fmt(prolapseWidthMm)} wide (EVEREST < 15 mm): one device may not cover it`,
    });
  }
  if (mvaMm2 != null && mvaMm2 < R.mvaMm2) {
    out.push({ level: 'fail', text: `MVA ${fmtCm2(mvaMm2)} (EVEREST ≥ 4.0 cm²): risk of stenosis after any clip` });
  }
  return out;
}

/**
 * @param result   slicer result (as analysed)
 * @param profiles cutProfile per cut, same order as result.cuts
 * Whole-valve limits are reported by valveLimits(), not here.
 * @param options  { afterClipMm2 (per cut, or null),
 *   lengthsKnown: the trace ends are the hinges (a traced 3D annulus is the
 *   outline); without it leaflet lengths are not judged,
 *   openFrame: the frame is open (diastole), so nothing is judged }
 * @returns one entry per cut: { index, label, status, lesion, reasons, lengths }
 *   reasons: [{ level: 'fail' | 'caution' | 'lesion' | 'ok', text }]
 */
export function assessClipSites(
  result,
  profiles,
  {
    afterClipMm2 = null,
    lengthsKnown = Boolean(result.annulus),
    openFrame = false,
  } = {}
) {
  const isMv = result.kind === 'mv';
  const R = isMv ? CLIP_RULES.mv : CLIP_RULES.tv;
  const n = result.cuts.length;

  return result.cuts.map((cut, i) => {
    const p = profiles[i];
    const lengths = {
      known: lengthsKnown,
      left: p?.leafletLengths?.left ?? 0,
      right: p?.leafletLengths?.right ?? 0,
      leftName: cut.leaflets.left,
      rightName: cut.leaflets.right,
    };
    const base = { index: cut.index, label: cut.label, lengths, gapMm: p?.gapMm || 0, depthMm: p?.tentingHeightMm };
    if (openFrame) {
      return {
        ...base,
        status: 'unknown',
        lesion: false,
        reasons: [{ level: 'caution', text: 'Open frame (diastole): clip positions are judged in systole' }],
      };
    }
    if (!p || p.maxHeight == null) {
      return { ...base, status: 'unknown', lesion: false, reasons: [{ level: 'caution', text: 'No leaflets found in this cut' }] };
    }
    const reasons = [];
    const add = (level, text) => reasons.push({ level, text });

    // Lesion to treat at this position
    const prolapse = p.maxHeight > PROLAPSE_MM;
    if (prolapse) add('lesion', `Prolapse +${p.maxHeight.toFixed(1)} mm (${p.maxLeaflet || 'leaflet'})`);
    if (p.gapMm > 0) add('lesion', `Coaptation gap ${fmt(p.gapMm)}`);
    const lesion = prolapse || p.gapMm > 0;

    // Coaptation at this position
    if (isMv) {
      if (p.gapMm >= R.flailGapMm) add('fail', `Gap ${fmt(p.gapMm)} (EVEREST flail gap < 10 mm)`);
      if (p.tentingHeightMm != null && p.tentingHeightMm > R.coaptDepthMm) {
        add('fail', `Coaptation depth ${fmt(p.tentingHeightMm)} (EVEREST ≤ 11 mm)`);
      }
    } else if (p.gapMm > R.gapMm) {
      add('caution', `Gap ${fmt(p.gapMm)}: gaps above about 7 mm predict less T-TEER success`);
    }

    // Leaflets long enough to grasp (measured from the hinges of a traced annulus)
    if (lengthsKnown) {
      const minLen = Math.min(lengths.left, lengths.right);
      if (isMv) {
        const post =
          cut.leaflets.left === 'posterior' ? lengths.left : cut.leaflets.right === 'posterior' ? lengths.right : null;
        if (post != null && post < R.posteriorMm) {
          add('caution', `Posterior leaflet ${fmt(post)} to the coaptation (≥ 10 mm commonly required)`);
        }
      }
      if (minLen < 3) add('fail', `A leaflet is too short to grasp here (${fmt(minLen)})`);
    }

    // Position
    if (isMv && (i === 0 || i === n - 1)) add('caution', 'Commissure: dense chords, harder to grasp');

    // Orifice left after a clip here (once the MVA is known)
    if (isMv && afterClipMm2 && afterClipMm2[i] != null && afterClipMm2[i] <= R.stenosisMm2) {
      add('caution', `About ${fmtCm2(afterClipMm2[i])} left after a clip here (severe stenosis ≤ 1.5 cm²)`);
    }

    let status;
    if (reasons.some((r) => r.level === 'fail')) status = 'unfavourable';
    else if (reasons.some((r) => r.level === 'caution')) status = 'caution';
    else status = lesion ? 'target' : 'suitable';
    if (!reasons.length) {
      add('ok', lengthsKnown ? 'Leaflets long enough, coaptation within the criteria' : 'Coaptation within the criteria');
    }
    if (!lengthsKnown) reasons.push({ level: 'ok', text: 'Leaflet lengths not checked: trace the 3D annulus' });
    return { ...base, status, lesion, reasons };
  });
}
