import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Canvas } from '@react-three/fiber';
import { Play, Pause, Download, Trash2 } from 'lucide-react';
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
  planeAxes,
  snapshotMeasurementPlane,
  measurementOnCurrentPlane,
  add as addVec,
  sub as subVec,
} from '../utils/mprGeometry';
import { exportToNRRD } from '../utils/dicomParser';
import {
  getVolumeEcg,
  frameToSampleIndex,
  sampleIndexToFrame,
} from '../utils/ecg';
import VolumeRenderer, { STYLE_BG } from './VolumeRenderer';

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: row;
  background: #0f1419;
  color: #e8e6e3;
  font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
  min-height: 0;
`;

const ControlSidebar = styled.aside`
  width: 248px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.85rem 0.8rem 1rem;
  background: #1a222c;
  border-right: 1px solid #2a3542;
  overflow-y: auto;
`;

const Viewport = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const EcgBar = styled.div`
  flex-shrink: 0;
  height: 76px;
  background: #080c10;
  border-top: 1px solid #2a3542;
  position: relative;
`;

const EcgCanvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
  cursor: pointer;
`;

const EcgLegend = styled.div`
  position: absolute;
  top: 5px;
  left: 10px;
  z-index: 1;
  font-size: 0.7rem;
  color: #8ad4c4;
  pointer-events: none;
  text-shadow: 0 1px 2px #000;
`;

const ToolGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid #243040;

  &:last-of-type {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const GroupTitle = styled.div`
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7a8a99;
  font-weight: 600;
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

const Label = styled.label`
  font-size: 0.75rem;
  color: #9aa5b1;
  white-space: nowrap;
  min-width: ${(p) => p.$wide || '4.6rem'};
  flex-shrink: 0;
`;

const Slider = styled.input`
  flex: 1;
  min-width: 0;
  accent-color: #3d9a8b;
`;

const Button = styled.button`
  background: ${(p) => (p.$active ? '#3d9a8b' : '#243040')};
  border: 1px solid ${(p) => (p.$active ? '#4db8a6' : '#3a4a5c')};
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  flex: ${(p) => (p.$grow ? '1 1 auto' : '0 1 auto')};
  min-width: 0;

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
  width: 100%;
`;

const Meta = styled.div`
  margin-top: auto;
  padding-top: 0.6rem;
  font-size: 0.72rem;
  color: #9aa5b1;
  line-height: 1.45;
`;

const MeasureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 11rem;
  overflow-y: auto;
`;

const MeasureRow = styled.div`
  display: grid;
  grid-template-columns: 2.1rem 1fr auto;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  text-align: left;
  background: ${(p) => (p.$active ? hexToRgba(p.$color, 0.22) : '#243040')};
  border: 1px solid ${(p) => (p.$active ? p.$color : p.$visible ? '#3a4a5c' : '#2a3542')};
  box-shadow: inset 3px 0 0 ${(p) => p.$color || '#ffd54f'};
  color: ${(p) => (p.$visible ? '#e8e6e3' : '#7a8a99')};
  border-radius: 6px;
  padding: 0.28rem 0.35rem 0.28rem 0.55rem;
  cursor: pointer;
  font-size: 0.75rem;
`;

const MeasureLabel = styled.strong`
  color: ${(p) => p.$color || '#ffd54f'};
  font-weight: 700;
`;

const MeasureValue = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MeasureMetaLine = styled.span`
  display: block;
  font-size: 0.65rem;
  color: #7a8a99;
`;

const MeasureDelete = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: #9aa5b1;

  &:hover {
    background: #3a2a30;
    color: #f0b4b4;
  }
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
  sagittal: { label: 'Sagittal (X)', short: 'Sag', color: '#e53935', key: 'x' },
  coronal: { label: 'Coronal (Y)', short: 'Cor', color: '#43a047', key: 'y' },
  axial: { label: 'Axial (Z)', short: 'Ax', color: '#1e88e5', key: 'z' },
};

const MEASURE_COLORS = [
  '#ffd54f',
  '#4fc3f7',
  '#81c784',
  '#ff8a65',
  '#ce93d8',
  '#f48fb1',
  '#26c6da',
  '#aed581',
  '#90caf9',
  '#ef9a9a',
  '#fff176',
  '#b39ddb',
];

const CINE_RATES = [0.25, 0.5, 0.75, 1];

function hexToRgba(hex, alpha) {
  const n = (hex || '#ffd54f').replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pickMeasureColor(existing) {
  const used = new Set((existing || []).map((m) => m.color).filter(Boolean));
  const free = MEASURE_COLORS.find((c) => !used.has(c));
  return free || MEASURE_COLORS[(existing || []).length % MEASURE_COLORS.length];
}

function measureColor(m) {
  return m?.color || MEASURE_COLORS[0];
}

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

function drawMeasureLabel(ctx, x, y, text, color = '#ffe082') {
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

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function measurementCaption(m) {
  if (m.type === 'distance') {
    return formatDistance(distanceMm(m.points[0], m.points[1]));
  }
  const spec = viewSpec(m.axis);
  const { right, down } = planeAxes(m.normal || [0, 0, 1], spec.worldUp);
  return formatArea(polygonAreaMm2(m.points, right, down));
}

function isSliceMeasurementVisible(m, axis, timeIndex, volume, mprCenter, mprBasis) {
  return (
    m.axis === axis &&
    m.timeIndex === timeIndex &&
    measurementOnCurrentPlane(volume, m, mprCenter, mprBasis)
  );
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
  selectedMeasurementId,
  onSelectMeasurement,
  onAddMeasurement,
  onUpdateMeasurement,
  onLiveDraftChange,
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
    onLiveDraftChange?.(null);
  }, [tool, onClearDraftSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(null);
    onLiveDraftChange?.(null);
  }, [timeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

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

      const drawPts = (points, cursor) => {
        const all = cursor ? [...points, cursor] : points;
        return all.map((mm) => {
          const im = worldMmToImage(volume, s, mm);
          return toCss(im.u, im.v);
        });
      };

      const drawDistance = (points, cursor, live, extra = {}) => {
        const pts = drawPts(points, cursor);
        if (pts.length < 1) return;
        const selected = extra.selected;
        const color = extra.color || '#ffd54f';
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
        pts.forEach((p) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, selected ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = selected ? '#fff' : '#111';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
        const mmPts = cursor ? [...points, cursor] : points;
        if (mmPts.length >= 2) {
          const mid = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          };
          const prefix = extra.label ? `${extra.label} · ` : '';
          drawMeasureLabel(
            ctx,
            mid.x,
            mid.y,
            `${prefix}${formatDistance(distanceMm(mmPts[0], mmPts[1]))}`,
            color
          );
        }
      };

      const drawArea = (points, cursor, live, extra = {}) => {
        const mmPts = cursor ? [...points, cursor] : points;
        const pts = drawPts(points, cursor);
        if (!pts.length) return;
        const selected = extra.selected;
        const color = extra.color || '#ffd54f';
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
        pts.forEach((p) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, selected ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = selected ? '#fff' : '#111';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
        if (mmPts.length >= 3) {
          const cxp = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
          const cyp = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
          const prefix = extra.label ? `${extra.label} · ` : '';
          drawMeasureLabel(
            ctx,
            cxp,
            cyp,
            `${prefix}${formatArea(polygonAreaMm2(mmPts, s.right, s.down))}`,
            color
          );
        }
      };

      measurements
        .filter((m) =>
          isSliceMeasurementVisible(m, axis, timeIndex, volume, mprCenter, mprBasis)
        )
        .forEach((m) => {
          const extra = {
            label: m.label,
            selected: m.id === selectedMeasurementId,
            color: measureColor(m),
          };
          if (m.type === 'distance') drawDistance(m.points, null, false, extra);
          else drawArea(m.points, null, false, extra);
        });

      if (draft && draft.axis === axis) {
        if (draft.type === 'distance') drawDistance(draft.points, draft.cursor, true);
        else drawArea(draft.points, draft.cursor, true);
      }
    },
    [axis, draft, measurements, mprBasis, mprCenter, selectedMeasurementId, timeIndex, tool, volume]
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

  const visibleMeasurements = () =>
    measurements.filter((m) =>
      isSliceMeasurementVisible(m, axis, timeIndex, volume, mprCenter, mprBasis)
    );

  const mmToCssPos = (slice, mm, dw, dh) => {
    const im = worldMmToImage(volume, slice, mm);
    return imageToCss(slice, im.u, im.v, dw, dh);
  };

  const hitMeasurement = (pos) => {
    const slice = sliceRef.current;
    if (!slice || !pos || draftRef.current) return null;
    const vis = visibleMeasurements();
    let bestPt = null;
    let bestPtD = 10;
    vis.forEach((m) => {
      m.points.forEach((mm, index) => {
        const p = mmToCssPos(slice, mm, pos.dw, pos.dh);
        const d = Math.hypot(pos.x - p.x, pos.y - p.y);
        if (d < bestPtD) {
          bestPtD = d;
          bestPt = { mode: 'editPoint', id: m.id, index };
        }
      });
    });
    if (bestPt) return bestPt;

    let bestBody = null;
    let bestBodyD = 8;
    vis.forEach((m) => {
      const pts = m.points.map((mm) => mmToCssPos(slice, mm, pos.dw, pos.dh));
      const segs =
        m.type === 'area' && pts.length >= 3
          ? pts.map((p, i) => [p, pts[(i + 1) % pts.length]])
          : pts.length >= 2
            ? [[pts[0], pts[1]]]
            : [];
      segs.forEach(([a, b]) => {
        const d = distToSegment(pos.x, pos.y, a.x, a.y, b.x, b.y);
        if (d < bestBodyD) {
          bestBodyD = d;
          bestBody = { mode: 'editMove', id: m.id };
        }
      });
    });
    return bestBody;
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

    const editHit = hitMeasurement(pos);
    if (editHit) {
      onSelectMeasurement?.(editHit.id);
      dragRef.current = {
        ...editHit,
        lastMm: imageToWorldMm(volume, slice, pos.imgU, pos.imgV),
      };
      e.currentTarget.style.cursor = 'grabbing';
      return;
    }

    if (tool !== 'navigate') {
      const mm = imageToWorldMm(volume, slice, pos.imgU, pos.imgV);
      if (tool === 'distance') {
        if (!draft || draft.type !== 'distance') {
          setDraft({ axis, type: 'distance', points: [mm], cursor: mm });
          onLiveDraftChange?.({
            axis,
            type: 'distance',
            points: [mm],
            cursor: mm,
          });
        } else {
          onAddMeasurement({
            id: `${axis}-dist-${Date.now()}`,
            axis,
            type: 'distance',
            points: [draft.points[0], mm],
          });
          setDraft(null);
          onLiveDraftChange?.({
            axis,
            type: 'distance',
            points: [],
            cursor: mm,
          });
        }
        return;
      }
      if (tool === 'area') {
        if (!draft || draft.type !== 'area') {
          setDraft({ axis, type: 'area', points: [mm], cursor: mm });
          onLiveDraftChange?.({
            axis,
            type: 'area',
            points: [mm],
            cursor: mm,
          });
        } else {
          const first = draft.points[0];
          const close =
            draft.points.length >= 3 && distanceMm(first, mm) < (slice.pixelMm || 1) * 14;
          if (close) {
            finishArea(draft.points);
            onLiveDraftChange?.({
              axis,
              type: 'area',
              points: [],
              cursor: mm,
            });
          } else {
            const points = [...draft.points, mm];
            setDraft({ ...draft, points, cursor: mm });
            onLiveDraftChange?.({
              axis,
              type: 'area',
              points,
              cursor: mm,
            });
          }
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
    const drag = dragRef.current;

    if (drag?.mode === 'editPoint' || drag?.mode === 'editMove') {
      const mm = imageToWorldMm(volume, slice, pos.imgU, pos.imgV);
      if (drag.mode === 'editPoint') {
        onUpdateMeasurement?.(drag.id, (m) => {
          const points = m.points.slice();
          points[drag.index] = mm;
          return { ...m, points };
        });
      } else {
        const delta = subVec(mm, drag.lastMm);
        drag.lastMm = mm;
        onUpdateMeasurement?.(drag.id, (m) => ({
          ...m,
          points: m.points.map((p) => addVec(p, delta)),
        }));
      }
      e.currentTarget.style.cursor = 'grabbing';
      return;
    }

    if (tool !== 'navigate') {
      const hover = hitMeasurement(pos);
      e.currentTarget.style.cursor = hover ? 'grab' : 'crosshair';
      const mm = imageToWorldMm(volume, slice, pos.imgU, pos.imgV);
      if (draftRef.current && draftRef.current.axis === axis) {
        setDraft((d) => (d ? { ...d, cursor: mm } : d));
      }
      onLiveDraftChange?.({
        axis,
        type: (draftRef.current && draftRef.current.type) || tool,
        points: draftRef.current?.points || [],
        cursor: mm,
      });
      return;
    }

    if (!drag) {
      const hover = hitMeasurement(pos);
      if (hover) {
        e.currentTarget.style.cursor = 'grab';
        return;
      }
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
    e.currentTarget.style.cursor = 'crosshair';
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
      ? 'Click two points to measure length · Drag points to edit'
      : tool === 'area'
        ? 'Click to add points · Double-click or Enter to close · Drag points to edit · Esc cancel'
        : 'Drag a line near the ends to rotate (stays 90°) · Drag the middle to move it · Drag center to move the crosshair · Drag measurement points to edit · Wheel zoom · Shift+wheel scroll';

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
        onPointerLeave={() => onLiveDraftChange?.(null)}
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

function EcgStrip({ ecg, timeIndex, frameCount, onSeek }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !ecg?.samples?.length) return undefined;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(8, Math.round(rect.width));
      const h = Math.max(8, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#080c10';
      ctx.fillRect(0, 0, w, h);

      const samples = ecg.samples;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = max - min || 1;
      const padY = 10;
      const padX = 8;
      const usableW = w - padX * 2;
      const usableH = h - padY * 2;

      ctx.strokeStyle = '#1c2a32';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const xAt = (i) => padX + (i / Math.max(1, samples.length - 1)) * usableW;
      const yAt = (v) => padY + (1 - (v - min) / span) * usableH;

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = xAt(i);
        const y = yAt(samples[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const lastX = xAt(samples.length - 1);
      ctx.lineTo(lastX, h - 2);
      ctx.lineTo(xAt(0), h - 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(61, 154, 139, 0.22)';
      ctx.fill();

      ctx.strokeStyle = '#6ee0cc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = xAt(i);
        const y = yAt(samples[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (ecg.beats?.length) {
        ctx.fillStyle = '#e07a5f';
        ecg.beats.forEach((b) => {
          const x = xAt(b);
          ctx.beginPath();
          ctx.moveTo(x, 3);
          ctx.lineTo(x - 4, 11);
          ctx.lineTo(x + 4, 11);
          ctx.closePath();
          ctx.fill();
        });
      }

      const si = frameToSampleIndex(ecg, timeIndex, frameCount);
      const px = xAt(si);
      ctx.strokeStyle = '#ffe082';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ecg, timeIndex, frameCount]);

  const seekFromEvent = (e) => {
    if (!ecg?.samples?.length) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const si = Math.round(x * (ecg.samples.length - 1));
    onSeek(sampleIndexToFrame(ecg, si, frameCount));
  };

  const onPointerDown = (e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    seekFromEvent(e);
  };

  const bpm =
    ecg?.heartRateBpm && Number.isFinite(ecg.heartRateBpm)
      ? Math.round(ecg.heartRateBpm)
      : null;
  const title = `${ecg?.label || 'ECG'}${bpm ? ` · ${bpm} bpm` : ''}`;

  const samp = ecg?.samples;
  let sMin = 0;
  let sMax = 0;
  if (samp?.length) {
    sMin = samp[0];
    sMax = samp[0];
    for (let i = 1; i < samp.length; i++) {
      if (samp[i] < sMin) sMin = samp[i];
      if (samp[i] > sMax) sMax = samp[i];
    }
  }

  return (
    <EcgBar
      ref={wrapRef}
      title="Click to jump to a frame"
      data-ecg-source={ecg?.source || ''}
      data-ecg-beats={(ecg?.beats || []).join(',')}
      data-ecg-bpm={bpm || ''}
      data-ecg-n={samp?.length || 0}
      data-ecg-range={`${sMin.toFixed(3)}:${sMax.toFixed(3)}`}
    >
      <EcgLegend>{title}</EcgLegend>
      <EcgCanvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
      />
    </EcgBar>
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
  const [cineRate, setCineRate] = useState(1);
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
  const [selectedMeasurementId, setSelectedMeasurementId] = useState(null);
  const [liveDraft, setLiveDraft] = useState(null);
  const [clearDraftSignal, setClearDraftSignal] = useState(0);
  const timeRef = useRef(timeIndex);
  const labelCounters = useRef({ d: 0, a: 0 });

  useEffect(() => {
    setMeasurements([]);
    setSelectedMeasurementId(null);
    setLiveDraft(null);
    setTool('navigate');
    setClearDraftSignal((n) => n + 1);
    labelCounters.current = { d: 0, a: 0 };
    setPlaying(false);
    setCineRate(1);
  }, [volume]);
  timeRef.current = timeIndex;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    if (!playing || !volume || volume.dims.t <= 1) return undefined;
    const ms = Math.max(16, (volume.frameTimeMs || 50) / cineRate);
    const id = setInterval(() => {
      setTimeIndex((timeRef.current + 1) % volume.dims.t);
    }, ms);
    return () => clearInterval(id);
  }, [playing, cineRate, volume, setTimeIndex]);

  useEffect(() => {
    const isTypingTarget = (el) => {
      if (!el || el === document.body) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT' && el.type !== 'range') return true;
      return el.isContentEditable;
    };

    const onKey = (ev) => {
      if (isTypingTarget(ev.target)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (!volume || volume.dims.t <= 1) return;

      if (ev.code === 'Space' || ev.key === ' ') {
        ev.preventDefault();
        if (ev.repeat) return;
        setPlaying((p) => !p);
        return;
      }

      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const dir = ev.key === 'ArrowRight' ? 1 : -1;
      const n = volume.dims.t;

      if (playingRef.current) {
        if (ev.repeat) return;
        setCineRate((r) => {
          const idx = CINE_RATES.indexOf(r);
          const i = idx < 0 ? CINE_RATES.length - 1 : idx;
          return CINE_RATES[Math.max(0, Math.min(CINE_RATES.length - 1, i + dir))];
        });
        return;
      }

      setTimeIndex((timeRef.current + dir + n) % n);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [volume, setTimeIndex]);

  const addMeasurement = (partial) => {
    const isDist = partial.type === 'distance';
    const n = isDist ? ++labelCounters.current.d : ++labelCounters.current.a;
    const snap = snapshotMeasurementPlane(volume, partial.axis, mprCenter, mprBasis);
    const next = {
      ...partial,
      ...snap,
      label: isDist ? `D${n}` : `A${n}`,
      timeIndex,
      color: pickMeasureColor(measurements),
    };
    setMeasurements((prev) => [...prev, { ...next, color: pickMeasureColor(prev) }]);
    setSelectedMeasurementId(next.id);
  };

  const updateMeasurement = (id, updater) => {
    setMeasurements((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  const deleteMeasurement = (id) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    setSelectedMeasurementId((cur) => (cur === id ? null : cur));
  };

  const restoreMeasurement = (m) => {
    setSelectedMeasurementId(m.id);
    setTimeIndex(m.timeIndex);
    setPlaying(false);
    if (m.center) setMprCenter(m.center);
    if (m.basis) setMprBasis(m.basis);
    setViewEpoch((n) => n + 1);
  };

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
  const ecg = getVolumeEcg(volume);

  return (
    <Container>
      <ControlSidebar>
        <ToolGroup>
          <GroupTitle>Cine</GroupTitle>
          <Button
            $grow
            onClick={() => setPlaying((p) => !p)}
            disabled={volume.dims.t <= 1}
            title="Play/pause (Space). Paused: ← → step frame. Playing: ← slower, → faster up to 1×"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
            Cine {cineRate === 1 ? '1×' : `${cineRate}×`}
          </Button>
          <SliderRow>
            <Label $wide="4.2rem">
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
          </SliderRow>
          {ecg ? (
            <MeasureMetaLine>
              {ecg.label || 'ECG'}
              {ecg.heartRateBpm ? ` · ${Math.round(ecg.heartRateBpm)} bpm` : ''}
            </MeasureMetaLine>
          ) : null}
          <MeasureMetaLine>
            Space play/pause · ← → {playing ? 'speed' : 'frame'}
          </MeasureMetaLine>
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Planes</GroupTitle>
          <SliderRow>
            <Label style={{ color: AXIS_META.sagittal.color }}>X {crosshair.x}</Label>
            <Slider
              type="range"
              min={0}
              max={volume.dims.x - 1}
              value={crosshair.x}
              onChange={(e) => setCrosshair({ x: Number(e.target.value) })}
              style={{ accentColor: AXIS_META.sagittal.color }}
            />
          </SliderRow>
          <SliderRow>
            <Label style={{ color: AXIS_META.coronal.color }}>Y {crosshair.y}</Label>
            <Slider
              type="range"
              min={0}
              max={volume.dims.y - 1}
              value={crosshair.y}
              onChange={(e) => setCrosshair({ y: Number(e.target.value) })}
              style={{ accentColor: AXIS_META.coronal.color }}
            />
          </SliderRow>
          <SliderRow>
            <Label style={{ color: AXIS_META.axial.color }}>Z {crosshair.z}</Label>
            <Slider
              type="range"
              min={0}
              max={volume.dims.z - 1}
              value={crosshair.z}
              onChange={(e) => setCrosshair({ z: Number(e.target.value) })}
              style={{ accentColor: AXIS_META.axial.color }}
            />
          </SliderRow>
          <Button
            $grow
            onClick={() => {
              resetMprOrientation();
              setViewEpoch((n) => n + 1);
            }}
            title="Reset plane tilt to orthogonal"
          >
            Reset tilt
          </Button>
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Tools</GroupTitle>
          <ButtonRow>
            <Button
              $grow
              $active={tool === 'navigate'}
              onClick={() => setTool('navigate')}
              title="Move and rotate MPR lines"
            >
              Nav
            </Button>
            <Button
              $grow
              $active={tool === 'distance'}
              onClick={() => setTool('distance')}
              title="Measure distance on a 2D slice"
            >
              Length
            </Button>
            <Button
              $grow
              $active={tool === 'area'}
              onClick={() => setTool('area')}
              title="Measure area on a 2D slice"
            >
              Area
            </Button>
            <Button
              $grow
              onClick={() => {
                setMeasurements([]);
                setSelectedMeasurementId(null);
                setClearDraftSignal((n) => n + 1);
                labelCounters.current = { d: 0, a: 0 };
              }}
              disabled={measurements.length === 0}
              title="Clear all measurements"
            >
              Clear
            </Button>
          </ButtonRow>
          <SliderRow>
            <Label $wide="4.5rem">Zoom {Math.round(zoom * 100)}%</Label>
            <Slider
              type="range"
              min={0.4}
              max={4}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              title="MPR zoom"
            />
          </SliderRow>
          <Button $grow onClick={() => setZoom(1.35)} title="Fit default zoom">
            Fit
          </Button>
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Measurements</GroupTitle>
          {measurements.length === 0 ? (
            <MeasureMetaLine>None yet · Length or Area on a 2D view</MeasureMetaLine>
          ) : (
            <MeasureList>
              {measurements.map((m) => {
                const visible2d = isSliceMeasurementVisible(
                  m,
                  m.axis,
                  timeIndex,
                  volume,
                  mprCenter,
                  mprBasis
                );
                const visible3d = m.timeIndex === timeIndex;
                return (
                  <MeasureRow
                    key={m.id}
                    $active={m.id === selectedMeasurementId}
                    $visible={visible2d || visible3d}
                    $color={measureColor(m)}
                    onClick={() => restoreMeasurement(m)}
                    title="Jump to this measurement"
                  >
                    <MeasureLabel $color={measureColor(m)}>{m.label}</MeasureLabel>
                    <MeasureValue>
                      {measurementCaption(m)}
                      <MeasureMetaLine>
                        T{m.timeIndex + 1} · {AXIS_META[m.axis]?.short || m.axis}
                      </MeasureMetaLine>
                    </MeasureValue>
                    <MeasureDelete
                      role="button"
                      title={`Delete ${m.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMeasurement(m.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </MeasureDelete>
                  </MeasureRow>
                );
              })}
            </MeasureList>
          )}
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Window</GroupTitle>
          <SliderRow>
            <Label $wide="3.6rem">WC {windowCenter}</Label>
            <Slider
              type="range"
              min={0}
              max={255}
              value={windowCenter}
              onChange={(e) =>
                setWindowLevel({ windowCenter: Number(e.target.value) })
              }
            />
          </SliderRow>
          <SliderRow>
            <Label $wide="3.6rem">WW {windowWidth}</Label>
            <Slider
              type="range"
              min={1}
              max={255}
              value={windowWidth}
              onChange={(e) =>
                setWindowLevel({ windowWidth: Number(e.target.value) })
              }
            />
          </SliderRow>
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Volume</GroupTitle>
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
          <ButtonRow>
            <Button
              $grow
              $active={renderMode === 'dvr'}
              onClick={() => setRenderMode('dvr')}
              title="Shaded volume rendering"
            >
              DVR
            </Button>
            <Button
              $grow
              $active={renderMode === 'mip'}
              onClick={() => setRenderMode('mip')}
              title="Maximum intensity projection"
            >
              MIP
            </Button>
          </ButtonRow>
          <SliderRow>
            <Label $wide="4.2rem">Opacity</Label>
            <Slider
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </SliderRow>
          <ButtonRow>
            <Button
              $grow
              $active={useCutPlanes}
              onClick={() => setUseCutPlanes((v) => !v)}
              title="Cut volume at crosshair"
            >
              {useCutPlanes ? 'Cuts on' : 'Cuts off'}
            </Button>
            <Button
              $grow
              $active={showMprLines}
              onClick={() => setShowMprLines((v) => !v)}
              title="Show MPR planes on the 3D volume"
            >
              {showMprLines ? 'MPR lines on' : 'MPR lines off'}
            </Button>
          </ButtonRow>
        </ToolGroup>

        <ToolGroup>
          <GroupTitle>Light</GroupTitle>
          <SliderRow>
            <Label>az</Label>
            <Slider
              type="range"
              min={0}
              max={360}
              value={lightAzimuth}
              onChange={(e) => setLightAzimuth(Number(e.target.value))}
              title="Light azimuth"
            />
          </SliderRow>
          <SliderRow>
            <Label>el</Label>
            <Slider
              type="range"
              min={-80}
              max={80}
              value={lightElevation}
              onChange={(e) => setLightElevation(Number(e.target.value))}
              title="Light elevation"
            />
          </SliderRow>
          <SliderRow>
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
          </SliderRow>
          <Button $grow onClick={exportFrame}>
            <Download size={16} />
            NRRD
          </Button>
        </ToolGroup>

        <Meta>
          {meta.modality || 'US'} · {volume.dims.x}×{volume.dims.y}×{volume.dims.z}{' '}
          × {volume.dims.t}
          <br />
          {sizeMm.x.toFixed(0)}×{sizeMm.y.toFixed(0)}×{sizeMm.z.toFixed(0)} mm
        </Meta>
      </ControlSidebar>

      <Viewport>
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
          selectedMeasurementId={selectedMeasurementId}
          onSelectMeasurement={setSelectedMeasurementId}
          onAddMeasurement={addMeasurement}
          onUpdateMeasurement={updateMeasurement}
          onLiveDraftChange={setLiveDraft}
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
          selectedMeasurementId={selectedMeasurementId}
          onSelectMeasurement={setSelectedMeasurementId}
          onAddMeasurement={addMeasurement}
          onUpdateMeasurement={updateMeasurement}
          onLiveDraftChange={setLiveDraft}
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
          selectedMeasurementId={selectedMeasurementId}
          onSelectMeasurement={setSelectedMeasurementId}
          onAddMeasurement={addMeasurement}
          onUpdateMeasurement={updateMeasurement}
          onLiveDraftChange={setLiveDraft}
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
              measurements={measurements}
              selectedMeasurementId={selectedMeasurementId}
              liveDraft={liveDraft}
            />
          </Canvas>
        </Pane>
      </Grid>
      {ecg ? (
        <EcgStrip
          ecg={ecg}
          timeIndex={timeIndex}
          frameCount={volume.dims.t}
          onSeek={(t) => {
            setPlaying(false);
            setTimeIndex(t);
          }}
        />
      ) : null}
      </Viewport>
    </Container>
  );
};

export default MPRViewer;
