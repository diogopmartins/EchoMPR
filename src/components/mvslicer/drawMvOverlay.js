/**
 * Draw the MV slicer on a 2D MPR pane: picked points, and on an en-face pane
 * the coaptation curve and the numbered cut lines (the key map).
 */
const POINT_COLORS = { al: '#ffb74d', mid: '#ffb74d', pm: '#ffb74d', ao: '#e57373' };
export const CUT_COLOR = '#4caf50';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export default function drawMvOverlay(ctx, mv, { toCssMm, planePoint, planeNormal, tolMm }) {
  if (!mv) return;
  ctx.save();
  const result = mv.result;
  const enFace = result && Math.abs(dot(result.normal, planeNormal)) > 0.8;

  if (enFace) {
    // Coaptation curve
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    result.coaptationCurve.forEach((p, i) => {
      const c = toCssMm(p);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Cut lines, numbered at the posterior end (farthest from the AoV)
    const ao = toCssMm(result.projected.ao);
    ctx.font = '600 11px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    result.cuts.forEach((cut) => {
      const a = toCssMm(cut.segment[0]);
      const b = toCssMm(cut.segment[1]);
      ctx.strokeStyle = CUT_COLOR;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const far = Math.hypot(a.x - ao.x, a.y - ao.y) > Math.hypot(b.x - ao.x, b.y - ao.y) ? a : b;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(far.x, far.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(cut.index), far.x, far.y + 0.5);
    });
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 11px Arial, Helvetica, sans-serif';
  mv.points.forEach((p) => {
    const dist = Math.abs(dot(sub(p.mm, planePoint), planeNormal));
    if (!enFace && dist > tolMm) return;
    const c = toCssMm(p.mm);
    ctx.fillStyle = POINT_COLORS[p.key];
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeText(p.short, c.x + 8, c.y - 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(p.short, c.x + 8, c.y - 6);
  });
  ctx.restore();
}
