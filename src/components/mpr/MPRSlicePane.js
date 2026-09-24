import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Maximize2, Minimize2 } from 'lucide-react';
import { renderSliceToCanvas } from '../../utils/philipsVolume';
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
  add as addVec,
  sub as subVec,
} from '../../utils/mprGeometry';
import {
  getViewLayout,
  imageToCss,
  cssToImage,
  lineHandlesCss,
} from '../../utils/paneGeometry';
import {
  distToSegment,
  isSliceMeasurementVisible,
  measureColor,
} from '../../utils/measurements';
import {
  drawTiltedLine,
  drawDistanceMeasure,
  drawAreaMeasure,
} from './overlayDraw';
import { AXIS_META } from './constants';
import { Pane, PaneLabel, PaneTools, IconBtn } from './styles';

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

export default function MPRSlicePane({
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
  slabMm = 0,
  slabMode = 'mean',
  maximized = false,
  hidden = false,
  onToggleMaximize,
  onOpenMenu,
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const sliceRef = useRef(null);
  const dragRef = useRef(null);
  const clickStartRef = useRef(null);
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

      const toCssPoints = (points, cursor) => {
        const all = cursor ? [...points, cursor] : points;
        return all.map((mm) => {
          const im = worldMmToImage(volume, s, mm);
          return toCss(im.u, im.v);
        });
      };

      const drawDistance = (points, cursor, live, extra = {}) =>
        drawDistanceMeasure(
          ctx,
          toCssPoints(points, cursor),
          cursor ? [...points, cursor] : points,
          { ...extra, live }
        );

      const drawArea = (points, cursor, live, extra = {}) =>
        drawAreaMeasure(
          ctx,
          toCssPoints(points, cursor),
          cursor ? [...points, cursor] : points,
          s.right,
          s.down,
          { ...extra, live }
        );

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
        slabMm,
        slabMode,
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
    slabMm,
    slabMode,
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
    if (e.button !== 0) return;
    const pos = pointerCss(e.clientX, e.clientY);
    if (!pos) return;
    const slice = sliceRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    clickStartRef.current = { x: e.clientX, y: e.clientY, consumed: false };

    const editHit = hitMeasurement(pos);
    if (editHit) {
      clickStartRef.current.consumed = true;
      onSelectMeasurement?.(editHit.id);
      dragRef.current = {
        ...editHit,
        lastMm: imageToWorldMm(volume, slice, pos.imgU, pos.imgV),
      };
      e.currentTarget.style.cursor = 'grabbing';
      return;
    }

    if (tool !== 'navigate') {
      clickStartRef.current.consumed = true;
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
    const atCenter = Math.hypot(pos.x - pos.cx, pos.y - pos.cy) < 12;
    if (hit.mode === 'tilt' || hit.mode === 'moveLine' || atCenter) {
      clickStartRef.current.consumed = true;
      dragRef.current = {
        ...hit,
        lastU: pos.imgU,
        lastV: pos.imgV,
        angle0: Math.atan2(pos.y - pos.cy, pos.x - pos.cx),
        basis0: basisRef.current,
      };
      e.currentTarget.style.cursor =
        hit.mode === 'tilt' ? 'grabbing' : hit.mode === 'moveLine' ? 'move' : 'move';
    }
  };

  const onPointerMove = (e) => {
    const start = clickStartRef.current;
    if (start && !start.consumed) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved > 6) start.consumed = true;
    }
    const pos = pointerCss(e.clientX, e.clientY, { clamp: !dragRef.current });
    if (!pos) return;
    const slice = sliceRef.current;
    const drag = dragRef.current;

    if (
      start?.consumed &&
      tool === 'navigate' &&
      !drag &&
      !hitMeasurement(pos)
    ) {
      dragRef.current = {
        mode: 'move',
        lastU: pos.imgU,
        lastV: pos.imgV,
        angle0: Math.atan2(pos.y - pos.cy, pos.x - pos.cx),
        basis0: basisRef.current,
      };
      e.currentTarget.style.cursor = 'move';
      return;
    }

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
    const start = clickStartRef.current;
    clickStartRef.current = null;
    dragRef.current = null;
    e.currentTarget.style.cursor = 'crosshair';
    if (e.button !== 0 || !start || start.consumed) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
    onOpenMenu?.({ x: e.clientX, y: e.clientY, pane: axis });
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    onOpenMenu?.({ x: e.clientX, y: e.clientY, pane: axis });
  };

  const onDoubleClick = (e) => {
    if (tool === 'area' && draft && draft.axis === axis) {
      e.preventDefault();
      finishArea(draft.points);
    }
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
        : 'Left-click empty space for the menu · Drag a line near the ends to rotate · Drag the middle to move it · Wheel zoom · Shift+wheel scroll';

  return (
    <Pane
      ref={containerRef}
      $borderColor={planeColor}
      $maximized={maximized}
      $hidden={hidden}
    >
      <PaneLabel $color={planeColor}>{AXIS_META[axis].label}</PaneLabel>
      <PaneTools>
        <IconBtn
          type="button"
          title={maximized ? 'Restore 2×2' : 'Maximize this view'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMaximize?.();
          }}
        >
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconBtn>
      </PaneTools>
      <ZoomBadge>
        {Math.round(zoom * 100)}%
        {slabMm >= 1 ? ` · ${slabMm} mm${slabMode === 'mip' ? ' MIP' : ''}` : ''}
      </ZoomBadge>
      <SliceCanvas ref={canvasRef} />
      <canvas
        ref={overlayRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => onLiveDraftChange?.(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
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
