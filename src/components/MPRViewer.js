import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Canvas } from '@react-three/fiber';
import { Play, Pause, Download } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { renderSliceToCanvas, physicalSizeMm } from '../utils/philipsVolume';
import {
  sampleObliquePlane,
  rotateBasisInPlane,
  translateCenterInPlane,
  movePlaneByLineDrag,
  nudgeCenterAlongNormal,
  projectPointOntoPlane,
  viewSpec,
  imageToWorldMm,
  worldMmToImage,
  distanceMm,
  polygonAreaMm2,
} from '../utils/mprGeometry';
import { exportToNRRD } from '../utils/dicomParser';
import VolumeRenderer, { STYLE_BG } from './VolumeRenderer';

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0f1419;
  color: #e8e6e3;
  font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: #1a222c;
  border-bottom: 1px solid #2a3542;
`;

const ToolGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.75rem;
  color: #9aa5b1;
  white-space: nowrap;
`;

const Slider = styled.input`
  width: 120px;
  accent-color: #3d9a8b;
`;

const Button = styled.button`
  background: ${(p) => (p.$active ? '#3d9a8b' : '#243040')};
  border: 1px solid ${(p) => (p.$active ? '#4db8a6' : '#3a4a5c')};
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.4rem 0.65rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;

  &:hover {
    background: ${(p) => (p.$active ? '#45a994' : '#2e3d50')};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  background: #243040;
  border: 1px solid #3a4a5c;
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
`;

const Meta = styled.div`
  margin-left: auto;
  font-size: 0.8rem;
  color: #9aa5b1;
`;

const Grid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;
  min-height: 0;
  background: #2a3542;
`;

const Pane = styled.div`
  position: relative;
  background: #000;
  overflow: hidden;
  min-height: 0;
  box-shadow: inset 0 0 0 2px ${(p) => p.$borderColor || 'transparent'};
`;

const PaneLabel = styled.div`
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: ${(p) => p.$color || '#666'};
  padding: 0.2rem 0.45rem;
  border-radius: 3px;
  pointer-events: none;
  font-weight: 600;
`;

const SliceCanvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
  object-fit: fill;
  cursor: crosshair;
  image-rendering: auto;
  background: #000;
`;

const ZoomBadge = styled.div`
  position: absolute;
  bottom: 8px;
  right: 10px;
  z-index: 2;
  font-size: 0.7rem;
  color: #e8e6e3;
  background: rgba(0, 0, 0, 0.55);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  pointer-events: none;
`;

const Empty = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa5b1;
  font-size: 1.05rem;
  padding: 2rem;
  text-align: center;
`;

// Standard MPR RGB: sagittal=red (X), coronal=green (Y), axial=blue (Z)
const AXIS_META = {
  sagittal: { label: 'Sagittal (X)', color: '#e53935', key: 'x' },
  coronal: { label: 'Coronal (Y)', color: '#43a047', key: 'y' },
  axial: { label: 'Axial (Z)', color: '#1e88e5', key: 'z' },
};

function getViewLayout(container, canvas) {
  const rect = container.getBoundingClientRect();
  const sw = canvas.width || 1;
  const sh = canvas.height || 1;
  // Sample buffer matches pane aspect → fill the pane
  const dw = rect.width;
  const dh = rect.height;
  return { rect, sw, sh, scale: dw / sw, dw, dh, ox: 0, oy: 0 };
}

function drawTiltedLine(ctx, cx, cy, dirU, dirV, halfLen, color) {
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

function imageToCss(slice, imgU, imgV, dw, dh) {
  return {
    x: (imgU / Math.max(1, slice.width - 1)) * dw,
    y: (imgV / Math.max(1, slice.height - 1)) * dh,
  };
}

function cssToImage(slice, x, y, dw, dh) {
  return {
    imgU: (x / dw) * (slice.width - 1),
    imgV: (y / dh) * (slice.height - 1),
  };
}

/** Keep rotate handles on-screen along a line through the crosshair. */
function handleReach(cx, cy, u, v, dw, dh) {
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

function lineHandlesCss(cx, cy, dirU, dirV, dw, dh) {
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

function formatDistance(mm) {
  if (mm < 10) return `${mm.toFixed(1)} mm`;
  return `${(mm / 10).toFixed(2)} cm`;
}

function formatArea(mm2) {
  return `${(mm2 / 100).toFixed(2)} cm²`;
}

function drawMeasureLabel(ctx, x, y, text) {
  ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif';
  const padX = 5;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 16;
  const lx = Math.max(4, x - w / 2);
  const ly = y - 20;
  ctx.fillStyle = 'rgba(8, 12, 16, 0.78)';
  ctx.strokeStyle = 'rgba(255, 214, 90, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(lx, ly, w, h, 3);
  else ctx.rect(lx, ly, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffe082';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + padX, ly + h / 2);
}

function MPRSlicePane({
  axis,
  volume,
  timeIndex,
  mprCenter,
  mprBasis,
  windowCenter,
  windowWidth,
  onCenterChange,
  onBasisChange,
  zoom,
  onZoomChange,
  viewEpoch,
  tool,
  measurements,
  onAddMeasurement,
  onClearDraftSignal,
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const sliceRef = useRef(null);
  const dragRef = useRef(null);
  const viewOriginRef = useRef(null);
  const [paneSize, setPaneSize] = useState({ w: 512, h: 512 });
  const [draft, setDraft] = useState(null);
  const basisRef = useRef(mprBasis);
  basisRef.current = mprBasis;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    viewOriginRef.current = { ...mprCenter };
  }, [viewEpoch, volume]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(null);
  }, [tool, onClearDraftSignal]);

  const resolveViewOrigin = useCallback(() => {
    const spec = viewSpec(axis);
    if (!viewOriginRef.current) viewOriginRef.current = { ...mprCenter };
    const origin = projectPointOntoPlane(
      volume,
      viewOriginRef.current,
      mprCenter,
      mprBasis[spec.normalKey]
    );
    viewOriginRef.current = origin;
    return origin;
  }, [axis, mprBasis, mprCenter, volume]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setPaneSize({
        w: Math.max(64, Math.round(r.width * dpr)),
        h: Math.max(64, Math.round(r.height * dpr)),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const drawOverlay = useCallback(
    (slice) => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const container = containerRef.current;
      const s = slice || sliceRef.current;
      if (!canvas || !overlay || !container || !s) return;

      const { rect, dw, dh, ox, oy, sw, sh } = getViewLayout(container, canvas);
      const dpr = window.devicePixelRatio || 1;
      overlay.width = Math.round(rect.width * dpr);
      overlay.height = Math.round(rect.height * dpr);
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      const ctx = overlay.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const toCss = (imgU, imgV) => {
        const p = imageToCss(s, imgU, imgV, dw, dh);
        return { x: ox + p.x, y: oy + p.y };
      };

      const cx = toCss(s.crossU ?? (sw - 1) / 2, s.crossV ?? (sh - 1) / 2).x;
      const cy = toCss(s.crossU ?? (sw - 1) / 2, s.crossV ?? (sh - 1) / 2).y;
      const half = Math.hypot(dw, dh);

      drawTiltedLine(ctx, cx, cy, s.dirs.a.u, s.dirs.a.v, half, s.dirs.a.color);
      drawTiltedLine(ctx, cx, cy, s.dirs.b.u, s.dirs.b.v, half, s.dirs.b.color);

      if (tool === 'navigate') {
        const drawHandle = (dir, color) => {
          for (const h of lineHandlesCss(cx, cy, dir.u, dir.v, dw, dh)) {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        };
        drawHandle(s.dirs.a, s.dirs.a.color);
        drawHandle(s.dirs.b, s.dirs.b.color);
      }

      ctx.fillStyle = '#fff';
      ctx.strokeStyle = AXIS_META[axis].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const drawPts = (points, cursor) => {
        const all = cursor ? [...points, cursor] : points;
        return all.map((mm) => {
          const im = worldMmToImage(volume, s, mm);
          return toCss(im.u, im.v);
        });
      };

      const drawDistance = (points, cursor, live) => {
        const pts = drawPts(points, cursor);
        if (pts.length < 1) return;
        ctx.strokeStyle = live ? '#ffe082' : '#ffd54f';
        ctx.fillStyle = '#ffd54f';
        ctx.lineWidth = 1.6;
        ctx.setLineDash(live ? [5, 4] : []);
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        pts.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
        const mmPts = cursor ? [...points, cursor] : points;
        if (mmPts.length >= 2) {
          const mid = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          };
          drawMeasureLabel(ctx, mid.x, mid.y, formatDistance(distanceMm(mmPts[0], mmPts[1])));
        }
      };

      const drawArea = (points, cursor, live) => {
        const mmPts = cursor ? [...points, cursor] : points;
        const pts = drawPts(points, cursor);
        if (!pts.length) return;
        ctx.fillStyle = live ? 'rgba(255, 213, 79, 0.16)' : 'rgba(255, 213, 79, 0.22)';
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 1.6;
        ctx.setLineDash(live ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (!live && pts.length >= 3) ctx.closePath();
        if (pts.length >= 3) ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        pts.forEach((p) => {
          ctx.fillStyle = '#ffd54f';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
        if (mmPts.length >= 3) {
          const cxp = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
          const cyp = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
          drawMeasureLabel(
            ctx,
            cxp,
            cyp,
            formatArea(polygonAreaMm2(mmPts, s.right, s.down))
          );
        }
      };

      measurements
        .filter((m) => m.axis === axis)
        .forEach((m) => {
          if (m.type === 'distance') drawDistance(m.points);
          else drawArea(m.points);
        });

      if (draft && draft.axis === axis) {
        if (draft.type === 'distance') drawDistance(draft.points, draft.cursor, true);
        else drawArea(draft.points, draft.cursor, true);
      }
    },
    [axis, draft, measurements, tool, volume]
  );

  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  const redraw = useCallback(() => {
    if (!volume || !canvasRef.current) return;
    const slice = sampleObliquePlane(
      volume,
      timeIndex,
      mprCenter,
      mprBasis,
      axis,
      {
        width: paneSize.w,
        height: paneSize.h,
        zoom,
        viewOrigin: resolveViewOrigin(),
      }
    );
    sliceRef.current = slice;
    renderSliceToCanvas(canvasRef.current, slice, windowCenter, windowWidth);
    drawOverlayRef.current(slice);
  }, [
    volume,
    timeIndex,
    mprCenter,
    mprBasis,
    axis,
    windowCenter,
    windowWidth,
    paneSize.w,
    paneSize.h,
    zoom,
    resolveViewOrigin,
  ]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    drawOverlay(sliceRef.current);
  }, [drawOverlay]);

  useEffect(() => {
    const onResize = () => drawOverlay(sliceRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawOverlay]);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return undefined;
    const onWheelNative = (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        const delta = e.deltaY > 0 ? 1 : -1;
        const spec = viewSpec(axis);
        onCenterChange(
          nudgeCenterAlongNormal(
            volume,
            mprCenter,
            mprBasis,
            spec.normalKey,
            delta
          )
        );
      } else {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        onZoomChange(Math.max(0.4, Math.min(6, zoom * factor)));
      }
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [axis, mprBasis, mprCenter, onCenterChange, onZoomChange, volume, zoom]);

  const pointerCss = (clientX, clientY, { clamp = true } = {}) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const slice = sliceRef.current;
    if (!canvas || !container || !slice) return null;
    const { rect, dw, dh, ox, oy } = getViewLayout(container, canvas);
    let x = clientX - rect.left - ox;
    let y = clientY - rect.top - oy;
    if (clamp) {
      if (x < -8 || x > dw + 8 || y < -8 || y > dh + 8) return null;
    }
    const img = cssToImage(slice, x, y, dw, dh);
    return {
      x,
      y,
      dw,
      dh,
      imgU: img.imgU,
      imgV: img.imgV,
      cx: imageToCss(slice, slice.crossU, slice.crossV, dw, dh).x,
      cy: imageToCss(slice, slice.crossU, slice.crossV, dw, dh).y,
    };
  };

  const hitTestMode = (pos) => {
    const slice = sliceRef.current;
    if (!slice || !pos) return { mode: 'move' };
    const { x, y, cx, cy, dw, dh } = pos;
    const dist = Math.hypot(x - cx, y - cy);
    const centerTol = 12;
    const lineTol = 9;
    const handleTol = 16;
    const rotateMin = Math.max(52, Math.min(dw, dh) * 0.2);

    const nearHandle = (dir) =>
      lineHandlesCss(cx, cy, dir.u, dir.v, dw, dh).some(
        (h) => Math.hypot(x - h.x, y - h.y) < handleTol
      );

    if (nearHandle(slice.dirs.a) || nearHandle(slice.dirs.b)) {
      const dir = nearHandle(slice.dirs.a) ? slice.dirs.a : slice.dirs.b;
      return { mode: 'tilt', planeKey: dir.planeKey, dir };
    }
    if (dist < centerTol) return { mode: 'move' };

    const distToLine = (dir) => {
      const len = Math.hypot(dir.u, dir.v) || 1;
      const u = dir.u / len;
      const v = dir.v / len;
      return Math.abs((x - cx) * v - (y - cy) * u);
    };
    const dA = distToLine(slice.dirs.a);
    const dB = distToLine(slice.dirs.b);
    const nearA = dA < lineTol;
    const nearB = dB < lineTol;
    if (nearA || nearB) {
      const useA = nearA && (!nearB || dA <= dB);
      const dir = useA ? slice.dirs.a : slice.dirs.b;
      if (dist > rotateMin) {
        return { mode: 'tilt', planeKey: dir.planeKey, dir };
      }
      return { mode: 'moveLine', planeKey: dir.planeKey, dir };
    }
    return { mode: 'move' };
  };

  const finishArea = (points) => {
    if (points.length >= 3) {
      onAddMeasurement({
        id: `${axis}-area-${Date.now()}`,
        axis,
        type: 'area',
        points,
      });
    }
    setDraft(null);
  };

  const onPointerDown = (e) => {
    const pos = pointerCss(e.clientX, e.clientY);
    if (!pos) return;
    const slice = sliceRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool !== 'navigate') {
      const mm = imageToWorldMm(volume, slice, pos.imgU, pos.imgV);
      if (tool === 'distance') {
        if (!draft || draft.type !== 'distance') {
          setDraft({ axis, type: 'distance', points: [mm], cursor: mm });
        } else {
          onAddMeasurement({
            id: `${axis}-dist-${Date.now()}`,
            axis,
            type: 'distance',
            points: [draft.points[0], mm],
          });
          setDraft(null);
        }
        return;
      }
      if (tool === 'area') {
        if (!draft || draft.type !== 'area') {
          setDraft({ axis, type: 'area', points: [mm], cursor: mm });
        } else {
          const first = draft.points[0];
          const close =
            draft.points.length >= 3 && distanceMm(first, mm) < (slice.pixelMm || 1) * 14;
          if (close) finishArea(draft.points);
          else setDraft({ ...draft, points: [...draft.points, mm], cursor: mm });
        }
      }
      return;
    }

    const hit = hitTestMode(pos);
    dragRef.current = {
      ...hit,
      lastU: pos.imgU,
      lastV: pos.imgV,
      angle0: Math.atan2(pos.y - pos.cy, pos.x - pos.cx),
      basis0: basisRef.current,
    };
    e.currentTarget.style.cursor =
      hit.mode === 'tilt' ? 'grabbing' : hit.mode === 'moveLine' ? 'move' : 'move';
  };

  const onPointerMove = (e) => {
    const pos = pointerCss(e.clientX, e.clientY, { clamp: !dragRef.current });
    if (!pos) return;
    const slice = sliceRef.current;

    if (tool !== 'navigate') {
      e.currentTarget.style.cursor = 'crosshair';
      if (draftRef.current && draftRef.current.axis === axis) {
        const mm = imageToWorldMm(volume, slice, pos.imgU, pos.imgV);
        setDraft((d) => (d ? { ...d, cursor: mm } : d));
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) {
      const hit = hitTestMode(pos);
      e.currentTarget.style.cursor =
        hit.mode === 'tilt' ? 'grab' : hit.mode === 'moveLine' ? 'move' : 'crosshair';
      return;
    }

    if (drag.mode === 'tilt') {
      const angle = Math.atan2(pos.y - pos.cy, pos.x - pos.cx);
      let delta = angle - drag.angle0;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      const spec = viewSpec(axis);
      const next = rotateBasisInPlane(drag.basis0, spec.normalKey, delta);
      basisRef.current = next;
      onBasisChange(next);
      return;
    }

    const dU = pos.imgU - drag.lastU;
    const dV = pos.imgV - drag.lastV;
    drag.lastU = pos.imgU;
    drag.lastV = pos.imgV;
    if (drag.mode === 'moveLine' && drag.dir && drag.planeKey) {
      onCenterChange(
        movePlaneByLineDrag(
          volume,
          mprCenter,
          mprBasis,
          axis,
          drag.planeKey,
          drag.dir.u,
          drag.dir.v,
          dU,
          dV,
          slice?.stepX,
          slice?.stepY
        )
      );
    } else {
      onCenterChange(
        translateCenterInPlane(
          volume,
          mprCenter,
          mprBasis,
          axis,
          dU,
          dV,
          slice?.stepX,
          slice?.stepY
        )
      );
    }
  };

  const onPointerUp = (e) => {
    dragRef.current = null;
    if (tool === 'navigate') e.currentTarget.style.cursor = 'crosshair';
  };

  const onDoubleClick = (e) => {
    if (tool !== 'area' || !draft || draft.axis !== axis) return;
    e.preventDefault();
    finishArea(draft.points);
  };

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') setDraft(null);
      if (ev.key === 'Enter' && draftRef.current?.type === 'area') {
        finishArea(draftRef.current.points);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [axis]); // eslint-disable-line react-hooks/exhaustive-deps

  const planeColor = AXIS_META[axis].color;
  const hint =
    tool === 'distance'
      ? 'Click two points to measure length'
      : tool === 'area'
        ? 'Click to add points · Double-click or Enter to close · Esc cancel'
        : 'Drag a line near the ends to rotate (stays 90°) · Drag the middle to move it · Drag center to move the crosshair · Wheel zoom · Shift+wheel scroll';

  return (
    <Pane ref={containerRef} $borderColor={planeColor}>
      <PaneLabel $color={planeColor}>{AXIS_META[axis].label}</PaneLabel>
      <ZoomBadge>{Math.round(zoom * 100)}%</ZoomBadge>
      <SliceCanvas ref={canvasRef} />
      <canvas
        ref={overlayRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        title={hint}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          cursor: 'crosshair',
        }}
      />
    </Pane>
  );
}

const MPRViewer = () => {
  const {
    volume,
    currentImage,
    timeIndex,
    setTimeIndex,
    crosshair,
    setCrosshair,
    mprCenter,
    mprBasis,
    setMprCenter,
    setMprBasis,
    resetMprOrientation,
    windowCenter,
    windowWidth,
    setWindowLevel,
  } = useEcho();

  const [playing, setPlaying] = useState(false);
  const [opacity, setOpacity] = useState(0.72);
  const [renderMode, setRenderMode] = useState('dvr');
  const [colorStyle, setColorStyle] = useState('glass');
  const [useCutPlanes, setUseCutPlanes] = useState(false);
  const [showMprLines, setShowMprLines] = useState(true);
  const [lightAzimuth, setLightAzimuth] = useState(38);
  const [lightElevation, setLightElevation] = useState(42);
  const [lightIntensity, setLightIntensity] = useState(1.55);
  const [zoom, setZoom] = useState(1.5);
  const [viewEpoch, setViewEpoch] = useState(0);
  const [tool, setTool] = useState('navigate');
  const [measurements, setMeasurements] = useState([]);
  const [clearDraftSignal, setClearDraftSignal] = useState(0);
  const timeRef = useRef(timeIndex);

  useEffect(() => {
    setMeasurements([]);
    setTool('navigate');
    setClearDraftSignal((n) => n + 1);
  }, [volume]);
  timeRef.current = timeIndex;

  useEffect(() => {
    if (!playing || !volume || volume.dims.t <= 1) return undefined;
    const ms = volume.frameTimeMs || 50;
    const id = setInterval(() => {
      setTimeIndex((timeRef.current + 1) % volume.dims.t);
    }, ms);
    return () => clearInterval(id);
  }, [playing, volume, setTimeIndex]);

  const exportFrame = () => {
    if (!currentImage?.volume) return;
    try {
      const nrrd = exportToNRRD(currentImage, timeIndex);
      const blob = new Blob([nrrd], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `echo_t${timeIndex}.nrrd`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  if (!volume) {
    return (
      <Container>
        <Empty>
          No volume loaded. Upload a Philips QLAB Cartesian DICOM (.dcm) to start
          MPR.
        </Empty>
      </Container>
    );
  }

  const sizeMm = physicalSizeMm(volume);
  const meta = volume.meta || {};

  return (
    <Container>
      <Toolbar>
        <ToolGroup>
          <Button
            onClick={() => setPlaying((p) => !p)}
            disabled={volume.dims.t <= 1}
            title="Cine play/pause"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
            Cine
          </Button>
          <Label>
            T {timeIndex + 1}/{volume.dims.t}
          </Label>
          <Slider
            type="range"
            min={0}
            max={Math.max(0, volume.dims.t - 1)}
            value={timeIndex}
            onChange={(e) => {
              setPlaying(false);
              setTimeIndex(Number(e.target.value));
            }}
          />
        </ToolGroup>

        <ToolGroup>
          <Label style={{ color: AXIS_META.sagittal.color }}>X {crosshair.x}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.x - 1}
            value={crosshair.x}
            onChange={(e) => setCrosshair({ x: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.sagittal.color }}
          />
          <Label style={{ color: AXIS_META.coronal.color }}>Y {crosshair.y}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.y - 1}
            value={crosshair.y}
            onChange={(e) => setCrosshair({ y: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.coronal.color }}
          />
          <Label style={{ color: AXIS_META.axial.color }}>Z {crosshair.z}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.z - 1}
            value={crosshair.z}
            onChange={(e) => setCrosshair({ z: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.axial.color }}
          />
          <Button
            onClick={() => {
              resetMprOrientation();
              setViewEpoch((n) => n + 1);
            }}
            title="Reset plane tilt to orthogonal"
          >
            Reset tilt
          </Button>
          <Button
            $active={tool === 'navigate'}
            onClick={() => setTool('navigate')}
            title="Move and rotate MPR lines"
          >
            Nav
          </Button>
          <Button
            $active={tool === 'distance'}
            onClick={() => setTool('distance')}
            title="Measure distance on a 2D slice"
          >
            Length
          </Button>
          <Button
            $active={tool === 'area'}
            onClick={() => setTool('area')}
            title="Measure area on a 2D slice"
          >
            Area
          </Button>
          <Button
            onClick={() => {
              setMeasurements([]);
              setClearDraftSignal((n) => n + 1);
            }}
            disabled={measurements.length === 0}
            title="Clear all measurements"
          >
            Clear
          </Button>
          <Label>Zoom {Math.round(zoom * 100)}%</Label>
          <Slider
            type="range"
            min={0.4}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            title="MPR zoom"
          />
          <Button onClick={() => setZoom(1.35)} title="Fit default zoom">
            Fit
          </Button>
        </ToolGroup>

        <ToolGroup>
          <Label>WC {windowCenter}</Label>
          <Slider
            type="range"
            min={0}
            max={255}
            value={windowCenter}
            onChange={(e) =>
              setWindowLevel({ windowCenter: Number(e.target.value) })
            }
          />
          <Label>WW {windowWidth}</Label>
          <Slider
            type="range"
            min={1}
            max={255}
            value={windowWidth}
            onChange={(e) =>
              setWindowLevel({ windowWidth: Number(e.target.value) })
            }
          />
        </ToolGroup>

        <ToolGroup>
          <Label>3D style</Label>
          <Select
            value={colorStyle}
            onChange={(e) => {
              const next = e.target.value;
              setColorStyle(next);
              if (next === 'philips' || next === 'glass') setRenderMode('dvr');
              if (next === 'glass') setOpacity(0.72);
              if (next === 'philips') setOpacity(0.92);
              if (next === 'gray') setOpacity(0.8);
            }}
            title="Volume color style"
          >
            <option value="philips">Philips</option>
            <option value="glass">Glass</option>
            <option value="gray">Gray</option>
          </Select>
          <Button
            $active={renderMode === 'dvr'}
            onClick={() => setRenderMode('dvr')}
            title="Shaded volume rendering"
          >
            DVR
          </Button>
          <Button
            $active={renderMode === 'mip'}
            onClick={() => setRenderMode('mip')}
            title="Maximum intensity projection"
          >
            MIP
          </Button>
          <Label>Opacity</Label>
          <Slider
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </ToolGroup>

        <ToolGroup>
          <Label>Light az</Label>
          <Slider
            type="range"
            min={0}
            max={360}
            value={lightAzimuth}
            onChange={(e) => setLightAzimuth(Number(e.target.value))}
            title="Light azimuth"
          />
          <Label>el</Label>
          <Slider
            type="range"
            min={-80}
            max={80}
            value={lightElevation}
            onChange={(e) => setLightElevation(Number(e.target.value))}
            title="Light elevation"
          />
          <Label>int</Label>
          <Slider
            type="range"
            min={0.2}
            max={2}
            step={0.05}
            value={lightIntensity}
            onChange={(e) => setLightIntensity(Number(e.target.value))}
            title="Light intensity"
          />
          <Button
            $active={useCutPlanes}
            onClick={() => setUseCutPlanes((v) => !v)}
            title="Cut volume at crosshair"
          >
            {useCutPlanes ? 'Cuts on' : 'Cuts off'}
          </Button>
          <Button
            $active={showMprLines}
            onClick={() => setShowMprLines((v) => !v)}
            title="Show MPR planes on the 3D volume"
          >
            {showMprLines ? 'MPR lines on' : 'MPR lines off'}
          </Button>
          <Button onClick={exportFrame}>
            <Download size={16} />
            NRRD
          </Button>
        </ToolGroup>

        <Meta>
          {meta.modality || 'US'} · {volume.dims.x}×{volume.dims.y}×{volume.dims.z}{' '}
          × {volume.dims.t} · {sizeMm.x.toFixed(0)}×{sizeMm.y.toFixed(0)}×
          {sizeMm.z.toFixed(0)} mm
        </Meta>
      </Toolbar>

      <Grid>
        <MPRSlicePane
          axis="axial"
          volume={volume}
          timeIndex={timeIndex}
          mprCenter={mprCenter}
          mprBasis={mprBasis}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCenterChange={setMprCenter}
          onBasisChange={setMprBasis}
          zoom={zoom}
          onZoomChange={setZoom}
          viewEpoch={viewEpoch}
          tool={tool}
          measurements={measurements}
          onAddMeasurement={(m) => setMeasurements((prev) => [...prev, m])}
          onClearDraftSignal={clearDraftSignal}
        />
        <MPRSlicePane
          axis="coronal"
          volume={volume}
          timeIndex={timeIndex}
          mprCenter={mprCenter}
          mprBasis={mprBasis}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCenterChange={setMprCenter}
          onBasisChange={setMprBasis}
          zoom={zoom}
          onZoomChange={setZoom}
          viewEpoch={viewEpoch}
          tool={tool}
          measurements={measurements}
          onAddMeasurement={(m) => setMeasurements((prev) => [...prev, m])}
          onClearDraftSignal={clearDraftSignal}
        />
        <MPRSlicePane
          axis="sagittal"
          volume={volume}
          timeIndex={timeIndex}
          mprCenter={mprCenter}
          mprBasis={mprBasis}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCenterChange={setMprCenter}
          onBasisChange={setMprBasis}
          zoom={zoom}
          onZoomChange={setZoom}
          viewEpoch={viewEpoch}
          tool={tool}
          measurements={measurements}
          onAddMeasurement={(m) => setMeasurements((prev) => [...prev, m])}
          onClearDraftSignal={clearDraftSignal}
        />
        <Pane>
          <PaneLabel $color="#3d9a8b">3D Volume</PaneLabel>
          <Canvas
            flat
            dpr={[1, 2]}
            camera={{ position: [1.15, 0.82, 1.25], fov: 32, near: 0.05, far: 30 }}
            style={{
              width: '100%',
              height: '100%',
              background: STYLE_BG[colorStyle] || STYLE_BG.glass,
            }}
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
              stencil: false,
              preserveDrawingBuffer: false,
            }}
          >
            <VolumeRenderer
              volume={volume}
              timeIndex={timeIndex}
              windowCenter={windowCenter}
              windowWidth={windowWidth}
              opacity={opacity}
              renderMode={renderMode}
              colorStyle={colorStyle}
              crosshair={crosshair}
              useCutPlanes={useCutPlanes}
              showMprLines={showMprLines}
              mprCenter={mprCenter}
              mprBasis={mprBasis}
              lightAzimuth={lightAzimuth}
              lightElevation={lightElevation}
              lightIntensity={lightIntensity}
            />
          </Canvas>
        </Pane>
      </Grid>
    </Container>
  );
};

export default MPRViewer;
