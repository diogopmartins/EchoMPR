import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderSliceToCanvas } from '../../utils/philipsVolume';
import {
  frameToPixel,
  frameToWorld,
  pixelToFrame,
  sampleFrame,
  worldToFrame,
} from '../../utils/mvSlicer';
import { CUT_COLOR, labelAnchor, labelEnd } from './drawSlicerOverlay';
import { HEIGHT_RANGE, heightColor, heightGradientCss } from '../../utils/heightColors';

export const KEY_PX = 260;
export const KEY_SLAB_MM = 10;

/** Grab radius for the point handles and lines, in CSS pixels. */
const HIT_CSS_PX = 11;

export { HEIGHT_RANGE, heightColor, heightGradientCss };

function distToSegment(x, y, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2));
  return Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy));
}

/**
 * En-face key map (valve-level slab MIP) with the numbered cut lines and the
 * picked points, which can be dragged; the cuts update as they move.
 * Optional layers: prolapse height colours, the orifice, a virtual clip band.
 */
export default function KeyMap({
  volume,
  timeIndex,
  result,
  windowCenter,
  windowWidth,
  active,
  onPick,
  onMovePoint,
  heights,
  orifice,
  clip,
  hinges = [],
}) {
  const ref = useRef(null);
  const geomRef = useRef(null);
  const dragRef = useRef(null);
  // While a point is dragged the map keeps the frame it had at the start, so
  // the image does not turn under the cursor as the axes change.
  const [dragFrame, setDragFrame] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const frame = dragFrame || result.keyMap;
  const mmPerPx = (frame.xMax - frame.xMin) / KEY_PX;

  const img = useMemo(
    () => sampleFrame(volume, timeIndex, frame, mmPerPx, { slabMm: KEY_SLAB_MM }),
    [volume, timeIndex, frame, mmPerPx]
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    renderSliceToCanvas(canvas, img, windowCenter, windowWidth);
    const ctx = canvas.getContext('2d');
    const toPx = (fx, fy) => {
      const p = frameToPixel(frame, fx, fy, mmPerPx);
      return { x: p.px, y: p.py };
    };
    const px = (mm) => {
      const f = worldToFrame(frame, mm);
      return toPx(f.x, f.y);
    };
    const live = frame === result.keyMap;

    // Prolapse height colours (only when the map matches the current frame)
    if (heights && live) {
      const off = document.createElement('canvas');
      off.width = heights.width;
      off.height = heights.height;
      const octx = off.getContext('2d');
      const data = octx.createImageData(heights.width, heights.height);
      heights.heights.forEach((h, i) => {
        if (Number.isNaN(h)) return;
        const c = heightColor(h);
        data.data[i * 4] = c[0];
        data.data[i * 4 + 1] = c[1];
        data.data[i * 4 + 2] = c[2];
        data.data[i * 4 + 3] = 185;
      });
      octx.putImageData(data, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    }

    // Valve outline used by the analysis
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    result.roiPolygon.forEach((p, i) => {
      const q = px(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Orifice (MVA) for this frame
    if (orifice && live) {
      const { mask, grid } = orifice;
      const s = grid.mmPerPx / mmPerPx;
      ctx.fillStyle = 'rgba(79, 195, 247, 0.55)';
      for (let k = 0; k < mask.length; k++) {
        if (!mask[k]) continue;
        const i = k % grid.w;
        const j = (k - i) / grid.w;
        const p = toPx(grid.x0 + i * grid.mmPerPx, grid.y0 + j * grid.mmPerPx);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }

    // Virtual clip band edges
    if (clip && live) {
      const c = worldToFrame(frame, clip.site);
      const ux = clip.coaptDir[0] * frame.right[0] + clip.coaptDir[1] * frame.right[1] + clip.coaptDir[2] * frame.right[2];
      const uy = clip.coaptDir[0] * frame.down[0] + clip.coaptDir[1] * frame.down[1] + clip.coaptDir[2] * frame.down[2];
      const ul = Math.hypot(ux, uy) || 1;
      const u = { x: ux / ul, y: uy / ul };
      const v = { x: -u.y, y: u.x };
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      [-1, 1].forEach((side) => {
        const o = { x: c.x + (side * clip.bandMm * u.x) / 2, y: c.y + (side * clip.bandMm * u.y) / 2 };
        const a = toPx(o.x - 14 * v.x, o.y - 14 * v.y);
        const b = toPx(o.x + 14 * v.x, o.y + 14 * v.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
    }

    // Annulus hinges traced in the cuts
    hinges.forEach((h) => {
      const q = px(h.p);
      ctx.fillStyle = '#ffeb3b';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 3.5);
      ctx.lineTo(q.x + 3.5, q.y);
      ctx.lineTo(q.x, q.y + 3.5);
      ctx.lineTo(q.x - 3.5, q.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Guides (coaptation curve or lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    result.guides.forEach((g) => {
      ctx.beginPath();
      g.points.forEach((p, i) => {
        const q = px(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Cut lines and numbers
    const anchor = px(labelAnchor(result));
    const segs = result.cuts.map((cut) => {
      const a = px(cut.segment[0]);
      const b = px(cut.segment[1]);
      return { a, b, end: labelEnd(a, b, anchor), index: cut.index };
    });
    segs.forEach((s) => {
      const on = active === s.index;
      ctx.strokeStyle = on ? '#ffffff' : CUT_COLOR;
      ctx.lineWidth = on ? 2.2 : 1.1;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    });
    ctx.font = '600 10px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    segs.forEach((s) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(s.end.x, s.end.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = active === s.index ? '#4caf50' : '#ffffff';
      ctx.fillText(String(s.index), s.end.x, s.end.y + 0.5);
    });

    // Draggable point handles
    const pts = result.keyPoints.map((p) => ({ ...p, ...px(p.point) }));
    geomRef.current = { segs, pts, width: img.width, height: img.height };
    ctx.textAlign = 'left';
    pts.forEach((p) => {
      const dragging = dragKey === p.key;
      ctx.fillStyle = dragging ? '#ffffff' : p.color;
      ctx.strokeStyle = dragging ? p.color : '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, dragging ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.strokeText(p.text, p.x + 7, p.y - 7);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x + 7, p.y - 7);
    });
  }, [img, result, frame, mmPerPx, windowCenter, windowWidth, active, dragKey, heights, orifice, clip, hinges]);

  useEffect(() => () => cancelAnimationFrame(dragRef.current?.raf), []);

  /** Pointer position in canvas pixels, plus the CSS→canvas scale. */
  const local = (e) => {
    const g = geomRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const k = g.width / rect.width;
    return {
      x: Math.max(0, Math.min(g.width - 1, (e.clientX - rect.left) * k)),
      y: Math.max(0, Math.min(g.height - 1, (e.clientY - rect.top) * k)),
      k,
    };
  };

  const hitPoint = (x, y, k) => {
    let best = null;
    let bestD = HIT_CSS_PX * k;
    geomRef.current.pts.forEach((p) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = p.key;
      }
    });
    return best;
  };

  const hitLine = (x, y, k) => {
    let best = null;
    let bestD = HIT_CSS_PX * k;
    geomRef.current.segs.forEach((s) => {
      const d = distToSegment(x, y, s.a, s.b);
      if (d < bestD) {
        bestD = d;
        best = s.index;
      }
    });
    return best;
  };

  const flush = () => {
    const d = dragRef.current;
    if (!d) return;
    d.raf = null;
    if (d.pending) {
      onMovePoint(d.key, d.pending);
      d.pending = null;
    }
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !geomRef.current) return;
    const { x, y, k } = local(e);
    const key = hitPoint(x, y, k);
    if (!key) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startFrame = result.keyMap;
    dragRef.current = {
      key,
      frame: startFrame,
      mmPerPx: (startFrame.xMax - startFrame.xMin) / KEY_PX,
      pending: null,
      raf: null,
    };
    setDragFrame(startFrame);
    setDragKey(key);
  };

  const onPointerMove = (e) => {
    if (!geomRef.current) return;
    const { x, y, k } = local(e);
    const d = dragRef.current;
    if (d) {
      const f = pixelToFrame(d.frame, x, y, d.mmPerPx);
      d.pending = frameToWorld(d.frame, f.x, f.y);
      if (!d.raf) d.raf = requestAnimationFrame(flush);
      return;
    }
    e.currentTarget.style.cursor = hitPoint(x, y, k) ? 'grab' : hitLine(x, y, k) ? 'pointer' : 'default';
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (d) {
      cancelAnimationFrame(d.raf);
      flush();
      dragRef.current = null;
      setDragFrame(null);
      setDragKey(null);
      return;
    }
    if (e.button !== 0 || !geomRef.current) return;
    const { x, y, k } = local(e);
    const index = hitLine(x, y, k);
    if (index) onPick(index);
  };

  const names = result.keyPoints.map((p) => p.text).join(', ');
  return (
    <canvas
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`Drag ${names} to adjust them · Click a line to open that cut`}
    />
  );
}
