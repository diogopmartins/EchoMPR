import { useMemo, useRef } from 'react';
import { buildLeafletModel } from '../../utils/leafletModel';
import { estimateThreshold, makeSampler } from '../../utils/valveAnalysis';

/**
 * 3D leaflet model of a slicer for the current frame, for the 3D pane.
 * Models are cached per frame, so the cine plays smoothly after one loop; the
 * cache is dropped when the points, the annulus, the reference or the
 * threshold change. Returns null when the slicer is incomplete, the model is
 * switched off, or `enabled` is false (e.g. while the cut view covers the 3D
 * pane).
 */
export default function useLeafletModel(volume, timeIndex, slicer, enabled = true) {
  const result = enabled && slicer.showModel ? slicer.analysisResult : null;
  const { thresholdOverride, points } = slicer;
  const cacheRef = useRef({ frames: new Map() });
  return useMemo(() => {
    if (!volume || !result?.ok) return null;
    const c = cacheRef.current;
    if (c.result !== result || c.threshold !== thresholdOverride || c.volume !== volume || c.points !== points) {
      cacheRef.current = { result, threshold: thresholdOverride, volume, points, frames: new Map() };
    }
    const { frames } = cacheRef.current;
    if (!frames.has(timeIndex)) {
      const sample = makeSampler(volume, timeIndex);
      const threshold = thresholdOverride ?? estimateThreshold(sample, result).threshold;
      frames.set(timeIndex, buildLeafletModel(sample, result, threshold, { rawPoints: points }));
    }
    return frames.get(timeIndex);
  }, [volume, timeIndex, result, thresholdOverride, points]);
}
