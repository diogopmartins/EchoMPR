import { useEffect, useMemo, useReducer } from 'react';
import { DEFAULT_SECTIONS } from '../constants';

/** Opacity each 3D color style starts from when it is picked. */
const STYLE_OPACITY = { glass: 0.72, philips: 0.92, gray: 0.8 };

export const initialViewerSettings = {
  // 3D volume
  renderMode: 'dvr',
  colorStyle: 'glass',
  opacity: 0.72,
  useCutPlanes: false,
  cropPlaneKey: 'z',
  cropFlip: false,
  showMprLines: true,
  lightAzimuth: 38,
  lightElevation: 42,
  lightIntensity: 1.55,
  cameraResetToken: 0,
  // 2D panes
  zoom: 1.5,
  slabMm: 0,
  slabMode: 'mean',
  viewEpoch: 0,
  tool: 'navigate',
  annulusPlanes: 6,
  // Layout
  maximizedPane: null,
  openSections: DEFAULT_SECTIONS,
  viewMenu: null,
};

export function viewerSettingsReducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.payload };
    case 'toggle':
      return { ...state, [action.key]: !state[action.key] };
    case 'bump':
      return { ...state, [action.key]: state[action.key] + 1 };
    case 'colorStyle': {
      const style = action.payload;
      const next = { ...state, colorStyle: style };
      if (style === 'philips' || style === 'glass') next.renderMode = 'dvr';
      if (STYLE_OPACITY[style] != null) next.opacity = STYLE_OPACITY[style];
      return next;
    }
    case 'cropPlane':
      return { ...state, cropPlaneKey: action.payload, useCutPlanes: true };
    case 'toggleMaximized':
      return {
        ...state,
        maximizedPane: state.maximizedPane === action.pane ? null : action.pane,
      };
    case 'toggleSection':
      return {
        ...state,
        openSections: {
          ...state.openSections,
          [action.id]: !state.openSections[action.id],
        },
      };
    case 'volumeChanged':
      return { ...state, tool: 'navigate', maximizedPane: null };
    default:
      return state;
  }
}

/**
 * Display and layout settings for the MPR workspace, held in one reducer so
 * panels can share a single `settings` object and a stable `actions` API.
 */
export default function useViewerSettings(volume) {
  const [settings, dispatch] = useReducer(
    viewerSettingsReducer,
    initialViewerSettings
  );

  const actions = useMemo(
    () => ({
      set: (payload) => dispatch({ type: 'set', payload }),
      toggle: (key) => dispatch({ type: 'toggle', key }),
      bump: (key) => dispatch({ type: 'bump', key }),
      setColorStyle: (style) => dispatch({ type: 'colorStyle', payload: style }),
      setCropPlane: (key) => dispatch({ type: 'cropPlane', payload: key }),
      toggleMaximized: (pane) => dispatch({ type: 'toggleMaximized', pane }),
      toggleSection: (id) => dispatch({ type: 'toggleSection', id }),
    }),
    []
  );

  useEffect(() => {
    dispatch({ type: 'volumeChanged' });
  }, [volume]);

  return [settings, actions];
}
