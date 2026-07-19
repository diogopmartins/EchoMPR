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
  nudgeCenterAlongNormal,
  viewSpec,
} from '../utils/mprGeometry';
import { exportToNRRD } from '../utils/dicomParser';
import VolumeRenderer from './VolumeRenderer';

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
  object-fit: contain;
  cursor: crosshair;
  image-rendering: pixelated;
  background: #000;
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
  const sw = canvas.width;
  const sh = canvas.height;
  const scale = Math.min(rect.width / sw, rect.height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = (rect.width - dw) / 2;
  const oy = (rect.height - dh) / 2;
  return { rect, sw, sh, scale, dw, dh, ox, oy };
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
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const sliceRef = useRef(null);
  const dragRef = useRef(null);

  const drawOverlay = useCallback(
    (slice) => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      const container = containerRef.current;
      const s = slice || sliceRef.current;
      if (!canvas || !overlay || !container || !s) return;

      const { rect, dw, dh, ox, oy } = getViewLayout(container, canvas);
      overlay.width = rect.width * window.devicePixelRatio;
      overlay.height = rect.height * window.devicePixelRatio;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      const ctx = overlay.getContext('2d');
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const cx = ox + dw / 2;
      const cy = oy + dh / 2;
      const half = Math.max(dw, dh);

      drawTiltedLine(
        ctx,
        cx,
        cy,
        s.dirs.a.u,
        s.dirs.a.v,
        half,
        s.dirs.a.color
      );
      drawTiltedLine(
        ctx,
        cx,
        cy,
        s.dirs.b.u,
        s.dirs.b.v,
        half,
        s.dirs.b.color
      );

      ctx.fillStyle = '#fff';
      ctx.strokeStyle = AXIS_META[axis].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
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
      axis
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
      const delta = e.deltaY > 0 ? 1 : -1;
      const spec = viewSpec(axis);
      onCenterChange(
        nudgeCenterAlongNormal(volume, mprCenter, mprBasis, spec.normalKey, delta)
      );
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [axis, mprBasis, mprCenter, onCenterChange, volume]);

  const clientToImage = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;
    const { rect, dw, dh, ox, oy, sw, sh } = getViewLayout(container, canvas);
    const lx = (clientX - rect.left - ox) / dw;
    const ly = (clientY - rect.top - oy) / dh;
    if (lx < 0 || lx > 1 || ly < 0 || ly > 1) return null;
    return {
      imgU: lx * (sw - 1),
      imgV: ly * (sh - 1),
      nx: lx * 2 - 1,
      ny: ly * 2 - 1,
      cx: 0.5 * (sw - 1),
      cy: 0.5 * (sh - 1),
    };
  };

  const hitTestMode = (img) => {
    const slice = sliceRef.current;
    if (!slice) return 'move';
    const dx = img.imgU - img.cx;
    const dy = img.imgV - img.cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) return 'move';

    const distToLine = (dir) => {
      const len = Math.hypot(dir.u, dir.v) || 1;
      const u = dir.u / len;
      const v = dir.v / len;
      return Math.abs(dx * v - dy * u);
    };
    const dA = distToLine(slice.dirs.a);
    const dB = distToLine(slice.dirs.b);
    if (Math.min(dA, dB) < 12) return 'tilt';
    return 'move';
  };

  const onPointerDown = (e) => {
    const img = clientToImage(e.clientX, e.clientY);
    if (!img) return;
    const mode = e.shiftKey || e.altKey ? 'tilt' : hitTestMode(img);
    dragRef.current = {
      mode,
      lastU: img.imgU,
      lastV: img.imgV,
      lastAngle: Math.atan2(img.ny, img.nx),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = mode === 'tilt' ? 'grabbing' : 'move';
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const img = clientToImage(e.clientX, e.clientY);
    if (!img) return;

    if (drag.mode === 'tilt') {
      const angle = Math.atan2(img.ny, img.nx);
      let delta = angle - drag.lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      drag.lastAngle = angle;
      const spec = viewSpec(axis);
      onBasisChange(rotateBasisInPlane(mprBasis, spec.normalKey, delta));
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
      <SliceCanvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Drag center to move · Drag near a line (or Shift+drag) to tilt · Wheel to scroll"
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
  const [opacity, setOpacity] = useState(0.9);
  const [renderMode, setRenderMode] = useState('dvr');
  const [colorStyle, setColorStyle] = useState('philips');
  const [useCutPlanes, setUseCutPlanes] = useState(false);
  const [lightAzimuth, setLightAzimuth] = useState(35);
  const [lightElevation, setLightElevation] = useState(40);
  const [lightIntensity, setLightIntensity] = useState(1.15);
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
          <Button onClick={resetMprOrientation} title="Reset plane tilt to orthogonal">
            Reset tilt
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
              if (next === 'glass') setOpacity(0.75);
              if (next === 'philips') setOpacity(0.95);
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
        />
        <Pane>
          <PaneLabel $color="#3d9a8b">3D Volume</PaneLabel>
          <Canvas
            camera={{ position: [1.6, 1.2, 1.6], fov: 45 }}
            style={{
              width: '100%',
              height: '100%',
              background:
                colorStyle === 'philips'
                  ? '#0a0706'
                  : colorStyle === 'glass'
                    ? '#061018'
                    : '#05070a',
            }}
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
    </Container>
  );
};

export default MPRViewer;
