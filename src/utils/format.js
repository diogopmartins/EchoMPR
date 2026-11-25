/**
 * Number formatting shared by every panel, so the same quantity always reads
 * the same way:
 * - lengths and heights in mm with one decimal,
 * - areas in cm² with two decimals,
 * - volumes in mL with two decimals,
 * - angles in whole degrees, ratios in whole percent.
 * Missing values read as an en dash. A rounded value never shows as "-0.0",
 * and signed values use a real minus sign.
 */

export const DASH = '–';
const MINUS = '−';

const ok = (v) => v != null && Number.isFinite(v);

/** Fixed decimals without a negative zero ("-0.0" → "0.0"). */
export function fixed(v, digits) {
  const s = v.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

function signed(v, digits) {
  const s = fixed(Math.abs(v), digits);
  if (Number(s) === 0) return s;
  return `${v < 0 ? MINUS : '+'}${s}`;
}

/** Length in mm: "4.2 mm". */
export function mm(v, digits = 1) {
  return ok(v) ? `${fixed(v, digits)} mm` : DASH;
}

/** Height with its sign, positive towards the atrium: "+2.3 mm", "−1.4 mm". */
export function mmSigned(v, digits = 1) {
  return ok(v) ? `${signed(v, digits)} mm` : DASH;
}

/** Area given in mm², shown in cm²: "1.67 cm²". */
export function cm2(vMm2, digits = 2) {
  return ok(vMm2) ? `${fixed(vMm2 / 100, digits)} cm²` : DASH;
}

/** Volume given in mm³, shown in mL: "2.40 mL". */
export function ml(vMm3, digits = 2) {
  return ok(vMm3) ? `${fixed(vMm3 / 1000, digits)} mL` : DASH;
}

/** Angle in whole degrees: "121°". */
export function deg(v) {
  return ok(v) ? `${fixed(v, 0)}°` : DASH;
}

/** Ratio in whole percent: "20%". */
export function pct(v) {
  return ok(v) ? `${fixed(v, 0)}%` : DASH;
}

/** Frame number as shown in the cine (1-based): "T3/12". */
export function frameLabel(t, count) {
  return count ? `T${t + 1}/${count}` : `T${t + 1}`;
}
