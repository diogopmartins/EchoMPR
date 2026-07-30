import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Canvas } from '@react-three/fiber';
import {
  Play,
  Pause,
  Download,
  SkipBack,
  SkipForward,
  RotateCcw,
} from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { renderSliceToCanvas, physicalSizeMm } from '../utils/philipsVolume';
import {
  sampleObliquePlane,
  rotateBasisInPlane,
  translateCenterInPlane,
  movePlaneByLineDrag,
  nudgeCenterAlongNormal,
  viewSpec,
} from '../utils/mprGeometry';
import { exportToNRRD } from '../utils/dicomParser';
import VolumeRenderer from './VolumeRenderer';
import { qlab } from '../theme';

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${qlab.bg};
  color: ${qlab.text};
  font-family: 'Segoe UI', Tahoma, sans-serif;
`;

const ControlsBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1rem;
  padding: 0.35rem 0.65rem;
  background: ${qlab.panel};
  border-bottom: 1px solid ${qlab.border};
  flex-shrink: 0;
`;

const ToolGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
`;

const Label = styled.label`
  font-size: 0.7rem;
  color: ${qlab.textMuted};
  white-space: nowrap;
`;

const Slider = styled.input`
  width: 90px;
  accent-color: ${qlab.amber};
  height: 4px;
`;

const Button = styled.button`
  background: ${(p) => (p.$active ? qlab.amberDim : qlab.panelElevated)};
  border: 1px solid ${(p) => (p.$active ? qlab.amber : qlab.border)};
  color: ${(p) => (p.$active ? '#fff8e6' : qlab.text)};
  border-radius: 2px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;

  &:hover {
    border-color: ${qlab.amber};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  background: ${qlab.panelElevated};
  border: 1px solid ${qlab.border};
  color: ${qlab.text};
  border-radius: 2px;
  padding: 0.2rem 0.35rem;
  font-size: 0.72rem;
  cursor: pointer;
`;

const Grid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  min-height: 0;
  background: #2a2a2a;
`;

const Pane = styled.div`
  position: relative;
  background: #000;
  overflow: hidden;
  min-height: 0;
  box-shadow: inset 0 0 0 2px ${(p) => p.$borderColor || qlab.volumeBorder};
`;

const PaneLabel = styled.div`
  position: absolute;
  top: 6px;
  left: 8px;
  z-index: 2;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  color: ${(p) => p.$color || '#ccc'};
  text-shadow: 0 0 3px #000, 0 1px 2px #000;
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
  bottom: 6px;
  right: 8px;
  z-index: 2;
  font-size: 0.65rem;
  color: #ccc;
  text-shadow: 0 1px 2px #000;
  pointer-events: none;
`;

const Empty = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${qlab.textMuted};
  font-size: 0.95rem;
  padding: 2rem;
  text-align: center;
`;

const PlaybackBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.4rem 0.75rem;
  background: ${qlab.panel};
  border-top: 1px solid ${qlab.border};
  flex-shrink: 0;
`;

const FrameInfo = styled.div`
  font-size: 0.75rem;
  color: ${qlab.amberBright};
  min-width: 4.5rem;
  font-variant-numeric: tabular-nums;
`;

const Timeline = styled.input`
  flex: 1;
  accent-color: ${qlab.amber};
  height: 4px;
`;

const PlayMeta = styled.div`
  font-size: 0.7rem;
  color: ${qlab.textMuted};
  white-space: nowrap;
`;

// QLAB-style RGB: green / red / blue pane borders
const AXIS_META = {
  coronal: { label: 'A', color: qlab.green, key: 'y' },
  sagittal: { label: 'B', color: qlab.red, key: 'x' },
  axial: { label: 'C', color: qlab.blue, key: 'z' },
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
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const sliceRef = useRef(null);
  const dragRef = useRef(null);
  const [paneSize, setPaneSize] = useState({ w: 512, h: 512 });
  const basisRef = useRef(mprBasis);
  basisRef.current = mprBasis;

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

      const { rect, dw, dh, ox, oy } = getViewLayout(container, canvas);
      const dpr = window.devicePixelRatio || 1;
      overlay.width = Math.round(rect.width * dpr);
      overlay.height = Math.round(rect.height * dpr);
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      const ctx = overlay.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const cx = ox + dw / 2;
      const cy = oy + dh / 2;
      const half = Math.hypot(dw, dh);

      drawTiltedLine(ctx, cx, cy, s.dirs.a.u, s.dirs.a.v, half, s.dirs.a.color);
      drawTiltedLine(ctx, cx, cy, s.dirs.b.u, s.dirs.b.v, half, s.dirs.b.color);

      // Rotation handles on each line
      const drawHandle = (dir, color) => {
        const len = Math.hypot(dir.u, dir.v) || 1;
        const u = dir.u / len;
        const v = dir.v / len;
        const hx = cx + u * Math.min(dw, dh) * 0.42;
        const hy = cy + v * Math.min(dw, dh) * 0.42;
        ctx.fillStyle = color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx - u * Math.min(dw, dh) * 0.42, cy - v * Math.min(dw, dh) * 0.42, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      drawHandle(s.dirs.a, s.dirs.a.color);
      drawHandle(s.dirs.b, s.dirs.b.color);

      ctx.fillStyle = '#fff';
      ctx.strokeStyle = AXIS_META[axis].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    },
    [axis]
  );

  const redraw = useCallback(() => {
    if (!volume || !canvasRef.current) return;
    const slice = sampleObliquePlane(
      volume,
      timeIndex,
      mprCenter,
      mprBasis,
      axis,
      { width: paneSize.w, height: paneSize.h, zoom }
    );
    sliceRef.current = slice;
    renderSliceToCanvas(canvasRef.current, slice, windowCenter, windowWidth);
    drawOverlay(slice);
  }, [
    volume,
    timeIndex,
    mprCenter,
    mprBasis,
    axis,
    windowCenter,
    windowWidth,
    drawOverlay,
    paneSize.w,
    paneSize.h,
    zoom,
  ]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onResize = () => drawOverlay(sliceRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawOverlay]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheelNative = (e) => {
      e.preventDefault();
      // Wheel = zoom; Shift+wheel = scroll through volume
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

  const clientToImage = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;
    const { rect, dw, dh, ox, oy, sw, sh } = getViewLayout(container, canvas);
    const lx = (clientX - rect.left - ox) / dw;
    const ly = (clientY - rect.top - oy) / dh;
    if (lx < -0.02 || lx > 1.02 || ly < -0.02 || ly > 1.02) return null;
    return {
      imgU: lx * (sw - 1),
      imgV: ly * (sh - 1),
      nx: lx * 2 - 1,
      ny: ly * 2 - 1,
      cx: 0.5 * (sw - 1),
      cy: 0.5 * (sh - 1),
      screenDist: Math.hypot(
        clientX - (rect.left + ox + dw / 2),
        clientY - (rect.top + oy + dh / 2)
      ),
    };
  };

  const hitTestMode = (img, movePlane) => {
    const slice = sliceRef.current;
    if (!slice) return { mode: 'move' };
    const dx = img.imgU - img.cx;
    const dy = img.imgV - img.cy;
    const dist = Math.hypot(dx, dy);
    // Hit tolerance scales with sample resolution
    const hitTol = Math.max(14, Math.min(slice.width, slice.height) * 0.035);
    const centerTol = Math.max(12, Math.min(slice.width, slice.height) * 0.03);
    if (dist < centerTol) return { mode: 'move' };

    const distToLine = (dir) => {
      const len = Math.hypot(dir.u, dir.v) || 1;
      const u = dir.u / len;
      const v = dir.v / len;
      return Math.abs(dx * v - dy * u);
    };
    const dA = distToLine(slice.dirs.a);
    const dB = distToLine(slice.dirs.b);
    const nearA = dA < hitTol;
    const nearB = dB < hitTol;

    if (nearA || nearB) {
      const useA = nearA && (!nearB || dA <= dB);
      const dir = useA ? slice.dirs.a : slice.dirs.b;
      const planeKey = dir.planeKey;
      // Default: rotate any grabbed line. Ctrl/Alt = translate that plane.
      if (movePlane) {
        return { mode: 'moveLine', planeKey, dir };
      }
      return { mode: 'tilt', planeKey, dir };
    }
    return { mode: 'move' };
  };

  const onPointerDown = (e) => {
    const img = clientToImage(e.clientX, e.clientY);
    if (!img) return;
    const hit = hitTestMode(img, e.ctrlKey || e.metaKey || e.altKey);
    dragRef.current = {
      ...hit,
      lastU: img.imgU,
      lastV: img.imgV,
      lastAngle: Math.atan2(img.imgV - img.cy, img.imgU - img.cx),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor =
      hit.mode === 'tilt' ? 'grabbing' : hit.mode === 'moveLine' ? 'ns-resize' : 'move';
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const img = clientToImage(e.clientX, e.clientY);
    if (!img) return;

    if (drag.mode === 'tilt') {
      const angle = Math.atan2(img.imgV - img.cy, img.imgU - img.cx);
      let delta = angle - drag.lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      drag.lastAngle = angle;
      const spec = viewSpec(axis);
      // Rotate whole cross around view normal so every line rotates together
      const next = rotateBasisInPlane(basisRef.current, spec.normalKey, delta);
      basisRef.current = next;
      onBasisChange(next);
    } else if (drag.mode === 'moveLine' && drag.dir && drag.planeKey) {
      const dU = img.imgU - drag.lastU;
      const dV = img.imgV - drag.lastV;
      drag.lastU = img.imgU;
      drag.lastV = img.imgV;
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
          dV
        )
      );
    } else {
      const dU = img.imgU - drag.lastU;
      const dV = img.imgV - drag.lastV;
      drag.lastU = img.imgU;
      drag.lastV = img.imgV;
      onCenterChange(
        translateCenterInPlane(volume, mprCenter, mprBasis, axis, dU, dV)
      );
    }
  };

  const onPointerUp = (e) => {
    dragRef.current = null;
    e.currentTarget.style.cursor = 'crosshair';
  };

  const planeColor = AXIS_META[axis].color;

  return (
    <Pane ref={containerRef} $borderColor={planeColor}>
      <PaneLabel $color={planeColor}>{AXIS_META[axis].label}</PaneLabel>
      <ZoomBadge>{Math.round(zoom * 100)}%</ZoomBadge>
      <SliceCanvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag any line to rotate · Ctrl+drag line to move plane · Drag center to pan · Wheel zoom · Shift+wheel scroll"
      />
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
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
  const [opacity, setOpacity] = useState(0.5);
  const [renderMode, setRenderMode] = useState('dvr');
  const [colorStyle, setColorStyle] = useState('glass');
  const [useCutPlanes, setUseCutPlanes] = useState(false);
  const [lightAzimuth, setLightAzimuth] = useState(30);
  const [lightElevation, setLightElevation] = useState(48);
  const lightIntensity = 1.35;
  const [zoom, setZoom] = useState(1.5);
  const timeRef = useRef(timeIndex);
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
        <Empty>No volume loaded. Use Load to open a QLAB Cartesian DICOM.</Empty>
      </Container>
    );
  }

  const sizeMm = physicalSizeMm(volume);
  const frameTime = volume.frameTimeMs || 50;
  const tSec = ((timeIndex * frameTime) / 1000).toFixed(2);

  return (
    <Container>
      <ControlsBar>
        <ToolGroup>
          <Label style={{ color: AXIS_META.sagittal.color }}>X</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.x - 1}
            value={crosshair.x}
            onChange={(e) => setCrosshair({ x: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.sagittal.color }}
          />
          <Label style={{ color: AXIS_META.coronal.color }}>Y</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.y - 1}
            value={crosshair.y}
            onChange={(e) => setCrosshair({ y: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.coronal.color }}
          />
          <Label style={{ color: AXIS_META.axial.color }}>Z</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.z - 1}
            value={crosshair.z}
            onChange={(e) => setCrosshair({ z: Number(e.target.value) })}
            style={{ accentColor: AXIS_META.axial.color }}
          />
          <Button onClick={resetMprOrientation} title="Reset tilt">
            <RotateCcw size={12} />
            Reset
          </Button>
        </ToolGroup>

        <ToolGroup>
          <Label>Zoom</Label>
          <Slider
            type="range"
            min={0.4}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <Button onClick={() => setZoom(1.5)}>Fit</Button>
        </ToolGroup>

        <ToolGroup>
          <Label>WC</Label>
          <Slider
            type="range"
            min={0}
            max={255}
            value={windowCenter}
            onChange={(e) =>
              setWindowLevel({ windowCenter: Number(e.target.value) })
            }
          />
          <Label>WW</Label>
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
          <Label>3D</Label>
          <Select
            value={colorStyle}
            onChange={(e) => {
              const next = e.target.value;
              setColorStyle(next);
              if (next === 'philips' || next === 'glass') setRenderMode('dvr');
              if (next === 'glass') setOpacity(0.5);
              if (next === 'philips') setOpacity(0.85);
            }}
          >
            <option value="glass">Glass</option>
            <option value="philips">Tissue</option>
            <option value="gray">Gray</option>
          </Select>
          <Button $active={renderMode === 'dvr'} onClick={() => setRenderMode('dvr')}>
            DVR
          </Button>
          <Button $active={renderMode === 'mip'} onClick={() => setRenderMode('mip')}>
            MIP
          </Button>
          <Label>Op</Label>
          <Slider
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          <Label>Light</Label>
          <Slider
            type="range"
            min={0}
            max={360}
            value={lightAzimuth}
            onChange={(e) => setLightAzimuth(Number(e.target.value))}
          />
          <Slider
            type="range"
            min={-80}
            max={80}
            value={lightElevation}
            onChange={(e) => setLightElevation(Number(e.target.value))}
          />
          <Button $active={useCutPlanes} onClick={() => setUseCutPlanes((v) => !v)}>
            Crop
          </Button>
          <Button onClick={exportFrame}>
            <Download size={12} />
            NRRD
          </Button>
        </ToolGroup>
      </ControlsBar>

      <Grid>
        {/* QLAB order: A green | B red / C blue | 3D */}
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
        />
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
        />
        <Pane $borderColor={qlab.volumeBorder}>
          <PaneLabel $color={qlab.amberBright}>3D</PaneLabel>
          <Canvas
            camera={{ position: [1.6, 1.2, 1.6], fov: 45 }}
            style={{ width: '100%', height: '100%', background: '#000' }}
            gl={{ antialias: true }}
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
              lightAzimuth={lightAzimuth}
              lightElevation={lightElevation}
              lightIntensity={lightIntensity}
            />
          </Canvas>
        </Pane>
      </Grid>

      <PlaybackBar>
        <Button
          onClick={() => {
            setPlaying(false);
            setTimeIndex(0);
          }}
          disabled={volume.dims.t <= 1}
          title="First frame"
        >
          <SkipBack size={14} />
        </Button>
        <Button
          onClick={() => setPlaying((p) => !p)}
          disabled={volume.dims.t <= 1}
          title="Play / pause"
          $active={playing}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <Button
          onClick={() => {
            setPlaying(false);
            setTimeIndex(volume.dims.t - 1);
          }}
          disabled={volume.dims.t <= 1}
          title="Last frame"
        >
          <SkipForward size={14} />
        </Button>
        <FrameInfo>
          {timeIndex + 1}/{volume.dims.t}
        </FrameInfo>
        <Timeline
          type="range"
          min={0}
          max={Math.max(0, volume.dims.t - 1)}
          value={timeIndex}
          onChange={(e) => {
            setPlaying(false);
            setTimeIndex(Number(e.target.value));
          }}
        />
        <PlayMeta>
          {tSec}s · {sizeMm.x.toFixed(0)}×{sizeMm.y.toFixed(0)}×{sizeMm.z.toFixed(0)} mm
        </PlayMeta>
      </PlaybackBar>
    </Container>
  );
};

export default MPRViewer;
