import React, { useRef } from 'react';
import { useEcho } from '../context/EchoContext';
import { physicalSizeMm } from '../utils/philipsVolume';
import { getVolumeEcg } from '../utils/ecg';
import MPRSlicePane from './mpr/MPRSlicePane';
import VolumePane from './mpr/VolumePane';
import EcgStrip from './mpr/EcgStrip';
import SidebarSection from './mpr/SidebarSection';
import ViewContextMenu from './mpr/ViewContextMenu';
import CinePanel from './mpr/panels/CinePanel';
import PlanesPanel from './mpr/panels/PlanesPanel';
import ToolsPanel from './mpr/panels/ToolsPanel';
import MeasurementsPanel from './mpr/panels/MeasurementsPanel';
import ImagePanel from './mpr/panels/ImagePanel';
import VolumePanel from './mpr/panels/VolumePanel';
import ExportPanel from './mpr/panels/ExportPanel';
import AnnulusPanel from './mpr/panels/AnnulusPanel';
import SegmentationPanel from './mpr/panels/SegmentationPanel';
import useViewerSettings from './mpr/hooks/useViewerSettings';
import useMeasurements from './mpr/hooks/useMeasurements';
import useCine from './mpr/hooks/useCine';
import useExports from './mpr/hooks/useExports';
import useAnnulus from './mpr/hooks/useAnnulus';
import useSegmentation from './mpr/hooks/useSegmentation';
import { FIT_ZOOM } from './mpr/constants';
import {
  Container,
  ControlSidebar,
  Empty,
  Grid,
  Meta,
  Viewport,
} from './mpr/styles';

const SLICE_AXES = ['axial', 'coronal', 'sagittal'];

const MPRViewer = () => {
  const {
    volume,
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

  const viewportRef = useRef(null);
  const [settings, actions] = useViewerSettings(volume);
  const { tool, zoom, maximizedPane, viewMenu, openSections } = settings;

  const measure = useMeasurements({ volume, timeIndex, mprCenter, mprBasis });
  const annulus = useAnnulus({
    volume,
    timeIndex,
    mprCenter,
    mprBasis,
    setMprCenter,
    setMprBasis,
    onStart: () => actions.set({ tool: 'annulus' }),
    onFinish: () => actions.set({ tool: 'navigate' }),
  });
  const seg = useSegmentation({ volume, timeIndex });

  // useExports needs setPlaying and useCine needs `exporting`; route the
  // setter through a ref so the two hooks can reference each other.
  const setPlayingRef = useRef(() => {});
  const exports = useExports({
    volume,
    timeIndex,
    setTimeIndex,
    viewportRef,
    setPlaying: (p) => setPlayingRef.current(p),
    maximizedPane,
    setMaximizedPane: (pane) => actions.set({ maximizedPane: pane }),
  });
  const { exporting } = exports;

  const cine = useCine({
    volume,
    timeIndex,
    setTimeIndex,
    exporting,
    onEscape: () => actions.set({ maximizedPane: null, viewMenu: null }),
  });
  setPlayingRef.current = cine.setPlaying;

  const seek = (t) => {
    cine.setPlaying(false);
    setTimeIndex(t);
  };

  const resetTilt = () => {
    resetMprOrientation();
    actions.bump('viewEpoch');
  };

  const restoreMeasurement = (m) => {
    measure.setSelectedId(m.id);
    seek(m.timeIndex);
    if (m.center) setMprCenter(m.center);
    if (m.basis) setMprBasis(m.basis);
    actions.bump('viewEpoch');
  };

  const runViewMenu = (action) => {
    const pane = viewMenu?.pane;
    actions.set({ viewMenu: null });
    if (action === 'nav') actions.set({ tool: 'navigate' });
    if (action === 'length') actions.set({ tool: 'distance' });
    if (action === 'area') actions.set({ tool: 'area' });
    if (action === 'max' && pane) actions.toggleMaximized(pane);
    if (action === 'fit') actions.set({ zoom: FIT_ZOOM });
    if (action === 'resetTilt') resetTilt();
    if (action === 'reset3d') actions.bump('cameraResetToken');
    if (action === 'mprLines') actions.toggle('showMprLines');
    if (action === 'cuts') actions.toggle('useCutPlanes');
    if (action === 'png') exports.exportPng();
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
  const openMenu = (menu) => actions.set({ viewMenu: menu });
  const setZoom = (z) => actions.set({ zoom: z });

  const section = (id, title, content) => (
    <SidebarSection
      title={title}
      open={openSections[id]}
      onToggle={() => actions.toggleSection(id)}
    >
      {content}
    </SidebarSection>
  );

  return (
    <Container>
      <ControlSidebar>
        {section(
          'cine',
          'Cine',
          <CinePanel
            volume={volume}
            timeIndex={timeIndex}
            onSeek={seek}
            playing={cine.playing}
            onTogglePlay={() => cine.setPlaying((p) => !p)}
            cineRate={cine.cineRate}
            exporting={exporting}
            ecg={ecg}
          />
        )}
        {section(
          'planes',
          'Planes',
          <PlanesPanel
            volume={volume}
            crosshair={crosshair}
            onCrosshairChange={setCrosshair}
            onResetTilt={resetTilt}
            slabMm={settings.slabMm}
            slabMode={settings.slabMode}
            onSettingsChange={actions.set}
          />
        )}
        {section(
          'tools',
          'Tools',
          <ToolsPanel
            tool={tool}
            onToolChange={(next) => actions.set({ tool: next })}
            onClear={measure.clear}
            canClear={measure.measurements.length > 0}
          />
        )}
        {section(
          'measure',
          'Measurements',
          <MeasurementsPanel
            measurements={measure.measurements}
            selectedId={measure.selectedId}
            volume={volume}
            timeIndex={timeIndex}
            mprCenter={mprCenter}
            mprBasis={mprBasis}
            onRestore={restoreMeasurement}
            onDelete={measure.remove}
          />
        )}
        {section(
          'annulus',
          'Mitral annulus',
          <AnnulusPanel
            annulus={annulus}
            planes={settings.annulusPlanes}
            onPlanesChange={(n) => actions.set({ annulusPlanes: n })}
            timeIndex={timeIndex}
          />
        )}
        {section(
          'segment',
          'Segmentation',
          <SegmentationPanel
            seg={seg}
            tool={tool}
            onToolChange={(next) => actions.set({ tool: next })}
            timeIndex={timeIndex}
            frameCount={volume.dims.t}
          />
        )}
        {section(
          'image',
          'Image',
          <ImagePanel
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            onWindowLevelChange={setWindowLevel}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        )}
        {section('volume', 'Volume', <VolumePanel settings={settings} actions={actions} />)}
        {section(
          'export',
          'Export',
          <ExportPanel
            exporting={exporting}
            frameCount={volume.dims.t}
            onPng={exports.exportPng}
            onAvi={exports.exportAvi}
            onNrrd={exports.exportNrrd}
          />
        )}

        <Meta>
          {meta.modality || 'US'} · {volume.dims.x}×{volume.dims.y}×{volume.dims.z}{' '}
          × {volume.dims.t}
          <br />
          {sizeMm.x.toFixed(0)}×{sizeMm.y.toFixed(0)}×{sizeMm.z.toFixed(0)} mm
        </Meta>
      </ControlSidebar>

      <Viewport ref={viewportRef}>
        <Grid>
          {SLICE_AXES.map((axis) => (
            <MPRSlicePane
              key={axis}
              axis={axis}
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
              viewEpoch={settings.viewEpoch}
              tool={tool}
              measurements={measure.measurements}
              selectedMeasurementId={measure.selectedId}
              onSelectMeasurement={measure.setSelectedId}
              onAddMeasurement={measure.add}
              onUpdateMeasurement={measure.update}
              onLiveDraftChange={measure.setLiveDraft}
              onClearDraftSignal={measure.clearDraftSignal}
              slabMm={settings.slabMm}
              slabMode={settings.slabMode}
              maximized={maximizedPane === axis}
              hidden={Boolean(maximizedPane && maximizedPane !== axis)}
              onToggleMaximize={() => actions.toggleMaximized(axis)}
              onOpenMenu={openMenu}
              annulus={annulus.view}
              segments={seg.visible}
              brushRadiusMm={seg.params.brushMm}
              onAnnulusPoint={annulus.addPoint}
              onSeed={seg.seed}
              onBrush={seg.brush}
            />
          ))}
          <VolumePane
            settings={settings}
            maximized={maximizedPane === 'volume'}
            hidden={Boolean(maximizedPane && maximizedPane !== 'volume')}
            onToggleMaximize={() => actions.toggleMaximized('volume')}
            onResetCamera={() => actions.bump('cameraResetToken')}
            onOpenMenu={openMenu}
            forceHighQuality={Boolean(exporting)}
            volume={volume}
            timeIndex={timeIndex}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            mprCenter={mprCenter}
            mprBasis={mprBasis}
            measurements={measure.measurements}
            selectedMeasurementId={measure.selectedId}
            liveDraft={measure.liveDraft}
            annulus={annulus.view}
            segments={seg.visible}
          />
        </Grid>
        {ecg ? (
          <EcgStrip
            ecg={ecg}
            timeIndex={timeIndex}
            frameCount={volume.dims.t}
            onSeek={seek}
          />
        ) : null}
      </Viewport>
      <ViewContextMenu
        menu={viewMenu}
        tool={tool}
        maximized={viewMenu ? maximizedPane === viewMenu.pane : false}
        showMprLines={settings.showMprLines}
        useCutPlanes={settings.useCutPlanes}
        onAction={runViewMenu}
        onClose={() => actions.set({ viewMenu: null })}
      />
    </Container>
  );
};

export default MPRViewer;
