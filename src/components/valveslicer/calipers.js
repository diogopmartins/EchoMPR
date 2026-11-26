/**
 * Measurement calipers drawn on the slicer canvases: a line with end ticks
 * and a value label, on a dark halo so they read on any echo background.
 * Points are canvas pixels.
 */

export const CALIPER_COLORS = {
  prolapse: '#ff8a80',
  gap: '#ffb74d',
};

/** A label on a dark pill, centred on (x, y). */
export function drawTag(ctx, x, y, text, color, fontPx) {
  ctx.save();
  ctx.font = `600 ${Math.round(fontPx)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + fontPx * 0.7;
  const h = fontPx * 1.35;
  const left = Math.max(1, Math.min(ctx.canvas.width - w - 1, x - w / 2));
  const top = Math.max(1, Math.min(ctx.canvas.height - h - 1, y - h / 2));
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(left, top, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
  ctx.fillStyle = color;
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  ctx.restore();
}

/** A straight line between two canvas points, on a dark halo. */
export function drawLine(ctx, a, b, color, width, dash = null) {
  ctx.save();
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = width + 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Caliper from a to b: the line, ticks across both ends, and the label beside
 * the middle, on the side given by `side` (+1 or −1 along the line's normal).
 */
export function drawCaliper(ctx, a, b, { color, width = 2, tick = 6, label = null, fontPx = 11, side = -1 }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  drawLine(ctx, a, b, color, width);
  [a, b].forEach((p) =>
    drawLine(ctx, { x: p.x - nx * tick, y: p.y - ny * tick }, { x: p.x + nx * tick, y: p.y + ny * tick }, color, width)
  );
  if (label) {
    const off = tick + fontPx * 0.9;
    drawTag(ctx, (a.x + b.x) / 2 + side * nx * off, (a.y + b.y) / 2 + side * ny * off, label, color, fontPx);
  }
}
