import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Canvas } from '@react-three/fiber';
import { Play, Pause, Download } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import {
  sampleSlice,
  renderSliceToCanvas,
  physicalSizeMm,
} from '../utils/philipsVolume';
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
  background: #243040;
  border: 1px solid #3a4a5c;
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.4rem 0.65rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;

  &:hover {
    background: #2e3d50;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
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
`;

const PaneLabel = styled.div`
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${(p) => p.$color || '#ccc'};
  text-shadow: 0 1px 2px #000;
  pointer-events: none;
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

const AXIS_META = {
  axial: { label: 'Axial (Z)', color: '#e8c547', key: 'z' },
  coronal: { label: 'Coronal (Y)', color: '#5bb8e0', key: 'y' },
  sagittal: { label: 'Sagittal (X)', color: '#e07a5f', key: 'x' },
};

function MPRSlicePane({
  axis,
  volume,
  timeIndex,
  crosshair,
  windowCenter,
  windowWidth,
  onCrosshairChange,
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(false);

  const axisKey = AXIS_META[axis].key;
  const sliceIndex = crosshair[axisKey];

  useEffect(() => {
    if (!volume || !canvasRef.current) return;
    const slice = sampleSlice(volume, axis, sliceIndex, timeIndex);
    renderSliceToCanvas(canvasRef.current, slice, windowCenter, windowWidth);
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, axis, sliceIndex, timeIndex, windowCenter, windowWidth, crosshair]);

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (!canvas || !overlay || !container || !volume) return;

    const { width: sw, height: sh } = canvas;
    const rect = container.getBoundingClientRect();
    overlay.width = rect.width * window.devicePixelRatio;
    overlay.height = rect.height * window.devicePixelRatio;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const ctx = overlay.getContext('2d');
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Contain fit (same as CSS object-fit: contain)
    const scale = Math.min(rect.width / sw, rect.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;

    let hLine = 0.5;
    let vLine = 0.5;

    if (axis === 'axial') {
      vLine = (crosshair.x + 0.5) / volume.dims.x;
      hLine = (crosshair.y + 0.5) / volume.dims.y;
    } else if (axis === 'coronal') {
      vLine = (crosshair.x + 0.5) / volume.dims.x;
      hLine = (crosshair.z + 0.5) / volume.dims.z;
    } else {
      vLine = (crosshair.y + 0.5) / volume.dims.y;
      hLine = (crosshair.z + 0.5) / volume.dims.z;
    }

    const x = ox + vLine * dw;
    const y = oy + hLine * dh;

    ctx.strokeStyle = AXIS_META[axis].color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, oy);
    ctx.lineTo(x, oy + dh);
    ctx.moveTo(ox, y);
    ctx.lineTo(ox + dw, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = AXIS_META[axis].color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [axis, crosshair, volume]);

  useEffect(() => {
    const onResize = () => drawOverlay();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawOverlay]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheelNative = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      const max =
        axis === 'axial'
          ? volume.dims.z - 1
          : axis === 'coronal'
            ? volume.dims.y - 1
            : volume.dims.x - 1;
      const nextVal = Math.max(0, Math.min(max, crosshair[axisKey] + delta));
      onCrosshairChange({ [axisKey]: nextVal });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [axis, axisKey, crosshair, onCrosshairChange, volume]);

  const pointerToCrosshair = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !volume) return null;

    const rect = container.getBoundingClientRect();
    const sw = canvas.width;
    const sh = canvas.height;
    const scale = Math.min(rect.width / sw, rect.height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const ox = (rect.width - dw) / 2;
    const oy = (rect.height - dh) / 2;

    const lx = (clientX - rect.left - ox) / dw;
    const ly = (clientY - rect.top - oy) / dh;
    if (lx < 0 || lx > 1 || ly < 0 || ly > 1) return null;

    const next = { ...crosshair };
    if (axis === 'axial') {
      next.x = Math.round(lx * (volume.dims.x - 1));
      next.y = Math.round(ly * (volume.dims.y - 1));
    } else if (axis === 'coronal') {
      next.x = Math.round(lx * (volume.dims.x - 1));
      next.z = Math.round(ly * (volume.dims.z - 1));
    } else {
      next.y = Math.round(lx * (volume.dims.y - 1));
      next.z = Math.round(ly * (volume.dims.z - 1));
    }
    return next;
  };

  const onPointerDown = (e) => {
    dragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = pointerToCrosshair(e.clientX, e.clientY);
    if (next) onCrosshairChange(next);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const next = pointerToCrosshair(e.clientX, e.clientY);
    if (next) onCrosshairChange(next);
  };

  const onPointerUp = () => {
    dragRef.current = false;
  };

  return (
    <Pane ref={containerRef}>
      <PaneLabel $color={AXIS_META[axis].color}>{AXIS_META[axis].label}</PaneLabel>
      <SliceCanvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
    windowCenter,
    windowWidth,
    setWindowLevel,
  } = useEcho();

  const [playing, setPlaying] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const [renderMode, setRenderMode] = useState(0);
  const [useCutPlanes, setUseCutPlanes] = useState(false);
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
          <Label>X {crosshair.x}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.x - 1}
            value={crosshair.x}
            onChange={(e) => setCrosshair({ x: Number(e.target.value) })}
          />
          <Label>Y {crosshair.y}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.y - 1}
            value={crosshair.y}
            onChange={(e) => setCrosshair({ y: Number(e.target.value) })}
          />
          <Label>Z {crosshair.z}</Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims.z - 1}
            value={crosshair.z}
            onChange={(e) => setCrosshair({ z: Number(e.target.value) })}
          />
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
          <Label>3D opacity</Label>
          <Slider
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          <Button
            onClick={() => setRenderMode((m) => (m === 0 ? 1 : 0))}
            title="Toggle MIP / composite"
          >
            {renderMode === 0 ? 'MIP' : 'Alpha'}
          </Button>
          <Button
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
          crosshair={crosshair}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCrosshairChange={setCrosshair}
        />
        <MPRSlicePane
          axis="coronal"
          volume={volume}
          timeIndex={timeIndex}
          crosshair={crosshair}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCrosshairChange={setCrosshair}
        />
        <MPRSlicePane
          axis="sagittal"
          volume={volume}
          timeIndex={timeIndex}
          crosshair={crosshair}
          windowCenter={windowCenter}
          windowWidth={windowWidth}
          onCrosshairChange={setCrosshair}
        />
        <Pane>
          <PaneLabel $color="#3d9a8b">3D Volume</PaneLabel>
          <Canvas
            camera={{ position: [1.6, 1.2, 1.6], fov: 45 }}
            style={{ width: '100%', height: '100%', background: '#05070a' }}
            gl={{ antialias: true }}
          >
            <VolumeRenderer
              volume={volume}
              timeIndex={timeIndex}
              windowCenter={windowCenter}
              windowWidth={windowWidth}
              opacity={opacity}
              renderMode={renderMode}
              crosshair={crosshair}
              useCutPlanes={useCutPlanes}
            />
          </Canvas>
        </Pane>
      </Grid>
    </Container>
  );
};

export default MPRViewer;
