import { initialViewerSettings, viewerSettingsReducer } from './useViewerSettings';

const run = (...actions) => actions.reduce(viewerSettingsReducer, initialViewerSettings);

test('picking a color style also sets its render mode and opacity', () => {
  const s = run({ type: 'set', payload: { renderMode: 'mip' } }, { type: 'colorStyle', payload: 'philips' });
  expect(s).toMatchObject({ colorStyle: 'philips', renderMode: 'dvr', opacity: 0.92 });
  expect(run({ type: 'colorStyle', payload: 'gray' })).toMatchObject({ renderMode: 'dvr', opacity: 0.8 });
});

test('gray keeps MIP when it was selected', () => {
  const s = run({ type: 'set', payload: { renderMode: 'mip' } }, { type: 'colorStyle', payload: 'gray' });
  expect(s.renderMode).toBe('mip');
});

test('choosing a crop plane turns cuts on', () => {
  expect(run({ type: 'cropPlane', payload: 'x' })).toMatchObject({ cropPlaneKey: 'x', useCutPlanes: true });
});

test('maximize toggles per pane', () => {
  const once = run({ type: 'toggleMaximized', pane: 'axial' });
  expect(once.maximizedPane).toBe('axial');
  expect(viewerSettingsReducer(once, { type: 'toggleMaximized', pane: 'axial' }).maximizedPane).toBeNull();
  expect(viewerSettingsReducer(once, { type: 'toggleMaximized', pane: 'volume' }).maximizedPane).toBe('volume');
});

test('a new volume resets the tool and layout but keeps display settings', () => {
  const s = run(
    { type: 'set', payload: { tool: 'area', zoom: 2, maximizedPane: 'coronal' } },
    { type: 'volumeChanged' }
  );
  expect(s).toMatchObject({ tool: 'navigate', maximizedPane: null, zoom: 2 });
});

test('bump and toggleSection', () => {
  const s = run({ type: 'bump', key: 'viewEpoch' }, { type: 'toggleSection', id: 'volume' });
  expect(s.viewEpoch).toBe(1);
  expect(s.openSections.volume).toBe(true);
});
