/**
 * Draw a valve slicer on a 2D MPR pane: the picked points, and on an en-face
 * pane the guide lines (coaptation) and the numbered cut lines.
 */
export const CUT_COLOR = '#4caf50';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** End of a cut line to put its number on: the end away from the anchor point. */
export function labelEnd(a, b, anchor) {
  if (!anchor) return b;
  const da = Math.hypot(a.x - anchor.x, a.y - anchor.y);
  const db = Math.hypot(b.x - anchor.x, b.y - anchor.y);
  return Math.abs(da - db) < 1 ? b : da > db ? a : b;
}

/** Point the cut numbers are placed away from (the AoV for MV, the centre for TV). */
export function labelAnchor(result) {
  return result.kind === 'mv' ? result.projected.ao : result.projected.c;
}

export default function drawSlicerOverlay(ctx, overlay, { toCssMm, planePoint, planeNormal, tolMm }) {
  if (!overlay) return;
  ctx.save();
  const { result } = overlay;
  const enFace = result && Math.abs(dot(result.normal, planeNormal)) > 0.8;

  if (enFace) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    result.guides.forEach((g) => {
      ctx.beginPath();
      g.points.forEach((p, i) => {
        const c = toCssMm(p);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const anchor = toCssMm(labelAnchor(result));
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
      const end = labelEnd(a, b, anchor);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(end.x, end.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(cut.index), end.x, end.y + 0.5);
    });
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 11px Arial, Helvetica, sans-serif';
  overlay.points.forEach((p) => {
    const dist = Math.abs(dot(sub(p.mm, planePoint), planeNormal));
    if (!enFace && dist > tolMm) return;
    const c = toCssMm(p.mm);
    ctx.fillStyle = p.color;
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
