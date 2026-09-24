import React, { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import VolumeRenderer, { STYLE_BG } from '../VolumeRenderer';
import { IconBtn, Pane, PaneLabel, PaneTools } from './styles';

const CLICK_SLOP_PX = 6;

/**
 * The 3D pane. A click without drag (the drag is the camera orbit) opens the
 * view menu, as does right-click.
 */
export default function VolumePane({
  settings,
  maximized,
  hidden,
  onToggleMaximize,
  onResetCamera,
  onOpenMenu,
  forceHighQuality,
  ...rendererProps
}) {
  const clickRef = useRef(null);

  return (
    <Pane
      $borderColor="#3d9a8b"
      $maximized={maximized}
      $hidden={hidden}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        clickRef.current = { x: e.clientX, y: e.clientY, consumed: false };
      }}
      onPointerMove={(e) => {
        const start = clickRef.current;
        if (!start || start.consumed) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) {
          start.consumed = true;
        }
      }}
      onPointerUp={(e) => {
        const start = clickRef.current;
        clickRef.current = null;
        if (e.button !== 0 || !start || start.consumed) return;
        if (e.target.closest('button')) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP_PX) return;
        onOpenMenu({ x: e.clientX, y: e.clientY, pane: 'volume' });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target.closest('button')) return;
        onOpenMenu({ x: e.clientX, y: e.clientY, pane: 'volume' });
      }}
    >
      <PaneLabel $color="#3d9a8b">3D Volume</PaneLabel>
      <PaneTools>
        <IconBtn
          type="button"
          title="Reset 3D camera"
          onClick={(e) => {
            e.stopPropagation();
            onResetCamera();
          }}
        >
          <RotateCcw size={14} />
        </IconBtn>
        <IconBtn
          type="button"
          title={maximized ? 'Restore 2×2' : 'Maximize 3D'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMaximize();
          }}
        >
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconBtn>
      </PaneTools>
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [1.15, 0.82, 1.25], fov: 32, near: 0.05, far: 30 }}
        style={{
          width: '100%',
          height: '100%',
          background: STYLE_BG[settings.colorStyle] || STYLE_BG.glass,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
          preserveDrawingBuffer: true,
        }}
      >
        <VolumeRenderer
          {...rendererProps}
          opacity={settings.opacity}
          renderMode={settings.renderMode}
          colorStyle={settings.colorStyle}
          useCutPlanes={settings.useCutPlanes}
          cropPlaneKey={settings.cropPlaneKey}
          cropFlip={settings.cropFlip}
          showMprLines={settings.showMprLines}
          lightAzimuth={settings.lightAzimuth}
          lightElevation={settings.lightElevation}
          lightIntensity={settings.lightIntensity}
          cameraResetToken={settings.cameraResetToken}
          forceHighQuality={forceHighQuality}
        />
      </Canvas>
    </Pane>
  );
}
