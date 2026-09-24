/** Screen-space helpers for mapping between a pane's CSS pixels and its slice image. */
import type { SampledSlice } from './types';

type SliceSize = Pick<SampledSlice, 'width' | 'height'>;

export interface CssPoint {
  x: number;
  y: number;
}

/** Keep a popup menu of size w×h fully inside the window. */
export function clampMenuPos(x: number, y: number, w = 196, h = 320): CssPoint {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
  };
}

export function getViewLayout(container: HTMLElement, canvas: HTMLCanvasElement) {
  const rect = container.getBoundingClientRect();
  const sw = canvas.width || 1;
  const sh = canvas.height || 1;
  // Sample buffer matches pane aspect → fill the pane
  const dw = rect.width;
  const dh = rect.height;
  return { rect, sw, sh, scale: dw / sw, dw, dh, ox: 0, oy: 0 };
}

export function imageToCss(
  slice: SliceSize,
  imgU: number,
  imgV: number,
  dw: number,
  dh: number
): CssPoint {
  return {
    x: (imgU / Math.max(1, slice.width - 1)) * dw,
    y: (imgV / Math.max(1, slice.height - 1)) * dh,
  };
}

export function cssToImage(
  slice: SliceSize,
  x: number,
  y: number,
  dw: number,
  dh: number
): { imgU: number; imgV: number } {
  return {
    imgU: (x / dw) * (slice.width - 1),
    imgV: (y / dh) * (slice.height - 1),
  };
}

/** Keep rotate handles on-screen along a line through the crosshair. */
function handleReach(
  cx: number,
  cy: number,
  u: number,
  v: number,
  dw: number,
  dh: number
): number {
  const preferred = Math.min(dw, dh) * 0.4;
  const pad = 18;
  const hits = [preferred];
  if (u > 1e-6) hits.push((dw - pad - cx) / u);
  if (u < -1e-6) hits.push((pad - cx) / u);
  if (v > 1e-6) hits.push((dh - pad - cy) / v);
  if (v < -1e-6) hits.push((pad - cy) / v);
  const ok = hits.filter((t) => t > 14);
  return ok.length ? Math.min(...ok) : preferred;
}

export function lineHandlesCss(
  cx: number,
  cy: number,
  dirU: number,
  dirV: number,
  dw: number,
  dh: number
): [CssPoint, CssPoint] {
  const len = Math.hypot(dirU, dirV) || 1;
  const u = dirU / len;
  const v = dirV / len;
  const r1 = handleReach(cx, cy, u, v, dw, dh);
  const r2 = handleReach(cx, cy, -u, -v, dw, dh);
  return [
    { x: cx + u * r1, y: cy + v * r1 },
    { x: cx - u * r2, y: cy - v * r2 },
  ];
}
