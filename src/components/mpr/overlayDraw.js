import { distanceMm, polygonAreaMm2 } from '../../utils/mprGeometry';
import { formatArea, formatDistance, hexToRgba } from '../../utils/measurements';

export function drawTiltedLine(ctx, cx, cy, dirU, dirV, halfLen, color) {
  const len = Math.hypot(dirU, dirV) || 1;
  const u = dirU / len;
  const v = dirV / len;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - u * halfLen, cy - v * halfLen);
  ctx.lineTo(cx + u * halfLen, cy + v * halfLen);
  ctx.stroke();
}

export function drawMeasureLabel(ctx, x, y, text, color = '#ffe082') {
  ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif';
  const padX = 5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 16;
  const lx = Math.max(4, x - w / 2);
  const ly = y - 20;
  ctx.fillStyle = 'rgba(8, 12, 16, 0.78)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(lx, ly, w, h, 3);
  else ctx.rect(lx, ly, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + padX, ly + h / 2);
}

function drawVertices(ctx, pts, color, selected) {
  pts.forEach((p) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, selected ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selected ? '#fff' : '#111';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

/**
 * Draw a length measurement. `pts` are CSS pixel positions and `mmPts` the
 * matching world-mm points (same order, cursor included for live drafts).
 */
export function drawDistanceMeasure(ctx, pts, mmPts, { live, selected, color = '#ffd54f', label } = {}) {
  if (pts.length < 1) return;
  ctx.strokeStyle = live ? '#7ee8ff' : color;
  ctx.fillStyle = color;
  ctx.lineWidth = selected ? 2.4 : 1.6;
  ctx.setLineDash(live ? [5, 4] : []);
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  drawVertices(ctx, pts, color, selected);
  if (mmPts.length >= 2) {
    const mid = {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
    };
    const prefix = label ? `${label} · ` : '';
    drawMeasureLabel(
      ctx,
      mid.x,
      mid.y,
      `${prefix}${formatDistance(distanceMm(mmPts[0], mmPts[1]))}`,
      color
    );
  }
}

/** Draw an area polygon; `right`/`down` are the slice's in-plane mm axes. */
export function drawAreaMeasure(ctx, pts, mmPts, right, down, { live, selected, color = '#ffd54f', label } = {}) {
  if (!pts.length) return;
  ctx.fillStyle = hexToRgba(color, live ? 0.14 : 0.22);
  ctx.strokeStyle = live ? '#7ee8ff' : color;
  ctx.lineWidth = selected ? 2.4 : 1.6;
  ctx.setLineDash(live ? [5, 4] : []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  if (!live && pts.length >= 3) ctx.closePath();
  if (pts.length >= 3) ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  drawVertices(ctx, pts, color, selected);
  if (mmPts.length >= 3) {
    const cxp = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
    const cyp = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
    const prefix = label ? `${label} · ` : '';
    drawMeasureLabel(
      ctx,
      cxp,
      cyp,
      `${prefix}${formatArea(polygonAreaMm2(mmPts, right, down))}`,
      color
    );
  }
}
