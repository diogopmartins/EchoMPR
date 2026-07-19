import React, { createContext, useContext, useReducer } from 'react';
import { identityBasis } from '../utils/mprGeometry';

const EchoContext = createContext();

const initialState = {
  images: [],
  currentImage: null,
  volume: null,
  meta: null,
  timeIndex: 0,
  crosshair: { x: 0, y: 0, z: 0 },
  /** Continuous MPR center in voxel coords */
  mprCenter: { x: 0, y: 0, z: 0 },
  /** Orthonormal triad in mm-space */
  mprBasis: identityBasis(),
  windowCenter: 128,
  windowWidth: 256,
  loading: false,
  loadProgress: 0,
  error: null,
};

const echoReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_LOAD_PROGRESS':
      return { ...state, loadProgress: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'ADD_IMAGES':
      return {
        ...state,
        images: [...state.images, ...action.payload],
        loading: false,
        loadProgress: 1,
      };
    case 'SET_CURRENT_IMAGE':
      return { ...state, currentImage: action.payload };
    case 'SET_VOLUME': {
      const volume = action.payload.volume;
      const mid = volume
        ? {
            x: (volume.dims.x - 1) / 2,
            y: (volume.dims.y - 1) / 2,
            z: (volume.dims.z - 1) / 2,
          }
        : { x: 0, y: 0, z: 0 };
      return {
        ...state,
        volume,
        meta: action.payload.meta || null,
        currentImage: action.payload.dicomData || state.currentImage,
        images: action.payload.dicomData
          ? [action.payload.dicomData]
          : state.images,
        timeIndex: 0,
        mprCenter: mid,
        mprBasis: identityBasis(),
        crosshair: {
          x: Math.round(mid.x),
          y: Math.round(mid.y),
          z: Math.round(mid.z),
        },
        windowCenter: action.payload.dicomData?.windowCenter ?? 128,
        windowWidth: action.payload.dicomData?.windowWidth ?? 256,
        loading: false,
        loadProgress: 1,
        error: null,
      };
    }
    case 'SET_TIME_INDEX':
      return { ...state, timeIndex: action.payload };
    case 'SET_CROSSHAIR': {
      const next = { ...state.crosshair, ...action.payload };
      return {
        ...state,
        crosshair: next,
        mprCenter: {
          x: next.x,
          y: next.y,
          z: next.z,
        },
      };
    }
    case 'SET_MPR_CENTER': {
      const c = action.payload;
      return {
        ...state,
        mprCenter: c,
        crosshair: {
          x: Math.round(c.x),
          y: Math.round(c.y),
          z: Math.round(c.z),
        },
      };
    }
    case 'SET_MPR_BASIS':
      return { ...state, mprBasis: action.payload };
    case 'RESET_MPR_ORIENTATION': {
      const volume = state.volume;
      const mid = volume
        ? {
            x: (volume.dims.x - 1) / 2,
            y: (volume.dims.y - 1) / 2,
            z: (volume.dims.z - 1) / 2,
          }
        : state.mprCenter;
      return {
        ...state,
        mprBasis: identityBasis(),
        mprCenter: mid,
        crosshair: {
          x: Math.round(mid.x),
          y: Math.round(mid.y),
          z: Math.round(mid.z),
        },
      };
    }
    case 'SET_WINDOW_LEVEL':
      return {
        ...state,
        windowCenter: action.payload.windowCenter ?? state.windowCenter,
        windowWidth: action.payload.windowWidth ?? state.windowWidth,
      };
    case 'CLEAR_IMAGES':
      return { ...initialState };
    default:
      return state;
  }
};

export const EchoProvider = ({ children }) => {
  const [state, dispatch] = useReducer(echoReducer, initialState);

  const value = {
    ...state,
    dispatch,
    setLoading: (loading) => dispatch({ type: 'SET_LOADING', payload: loading }),
    setLoadProgress: (progress) =>
      dispatch({ type: 'SET_LOAD_PROGRESS', payload: progress }),
    setError: (error) => dispatch({ type: 'SET_ERROR', payload: error }),
    addImages: (images) => dispatch({ type: 'ADD_IMAGES', payload: images }),
    setCurrentImage: (image) =>
      dispatch({ type: 'SET_CURRENT_IMAGE', payload: image }),
    setVolume: (payload) => dispatch({ type: 'SET_VOLUME', payload }),
    setTimeIndex: (t) => dispatch({ type: 'SET_TIME_INDEX', payload: t }),
    setCrosshair: (partial) =>
      dispatch({ type: 'SET_CROSSHAIR', payload: partial }),
    setMprCenter: (c) => dispatch({ type: 'SET_MPR_CENTER', payload: c }),
    setMprBasis: (b) => dispatch({ type: 'SET_MPR_BASIS', payload: b }),
    resetMprOrientation: () => dispatch({ type: 'RESET_MPR_ORIENTATION' }),
    setWindowLevel: (wl) => dispatch({ type: 'SET_WINDOW_LEVEL', payload: wl }),
    clearImages: () => dispatch({ type: 'CLEAR_IMAGES' }),
  };

  return <EchoContext.Provider value={value}>{children}</EchoContext.Provider>;
};

export const useEcho = () => {
  const context = useContext(EchoContext);
  if (!context) {
    throw new Error('useEcho must be used within an EchoProvider');
  }
  return context;
};
