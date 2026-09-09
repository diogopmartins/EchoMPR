export function captureElementToCanvas(el, { dpr = 2, even = false } = {}) {
  if (!el) throw new Error('Nothing to capture');
  const rect = el.getBoundingClientRect();
  let w = Math.max(2, Math.round(rect.width * dpr));
  let h = Math.max(2, Math.round(rect.height * dpr));
  if (even) {
    w &= ~1;
    h &= ~1;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, w, h);
  const sx = w / Math.max(1, rect.width);
  const sy = h / Math.max(1, rect.height);
  el.querySelectorAll('canvas').forEach((src) => {
    if (!src.width || !src.height) return;
    const style = window.getComputedStyle(src);
    if (style.visibility === 'hidden' || style.display === 'none') return;
    const r = src.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    ctx.drawImage(
      src,
      (r.left - rect.left) * sx,
      (r.top - rect.top) * sy,
      r.width * sx,
      r.height * sy
    );
  });
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      type,
      quality
    );
  });
}

export async function canvasToJpegBytes(canvas, quality = 0.84) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return new Uint8Array(await blob.arrayBuffer());
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function waitPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

export function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
