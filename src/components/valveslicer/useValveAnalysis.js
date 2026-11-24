import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PROLAPSE_MM,
  cutProfile,
  cycleJumps,
  estimateThreshold,
  frameMetrics,
  heightMap,
  makeSampler,
} from '../../utils/valveAnalysis';

/**
 * Leaflet analysis for the current frame of a slicer result: tissue
 * threshold (automatic or set by the user), prolapse and tenting height map,
 * and a leaflet trace per cut. On request, every frame of the cycle is
 * measured (a frame at a time, so the page stays responsive); the largest
 * orifice over the cycle is the MVA.
 */
export default function useValveAnalysis({ volume, timeIndex, result }) {
  const [thresholdOverride, setThresholdOverride] = useState(null);
  const [cycle, setCycle] = useState(null);
  const [progress, setProgress] = useState(null);
  const runRef = useRef(0);

  // A new result, reference or threshold makes the cycle stale (and stops a run).
  useEffect(() => {
    runRef.current += 1;
    setCycle(null);
    setProgress(null);
  }, [volume, result, thresholdOverride]);

  useEffect(() => {
    setThresholdOverride(null);
  }, [volume]);

  useEffect(
    () => () => {
      runRef.current += 1;
    },
    []
  );

  const frame = useMemo(() => {
    if (!result?.ok) return null;
    const sample = makeSampler(volume, timeIndex);
    const auto = estimateThreshold(sample, result).threshold;
    const threshold = thresholdOverride ?? auto;
    const map = heightMap(sample, result, threshold);
    const profiles = result.cuts.map((cut) => cutProfile(sample, result, cut, threshold));
    let worst = null;
    profiles.forEach((p, i) => {
      if (p.maxHeight != null && (worst == null || p.maxHeight > profiles[worst].maxHeight)) worst = i;
    });
    let widestGap = null;
    profiles.forEach((p, i) => {
      if (p.gapMm > 0 && (widestGap == null || p.gapMm > profiles[widestGap].gapMm)) widestGap = i;
    });
    return {
      autoThreshold: auto,
      threshold,
      map,
      profiles,
      worst,
      worstProlapses: worst != null && profiles[worst].maxHeight > PROLAPSE_MM,
      widestGap,
    };
  }, [volume, timeIndex, result, thresholdOverride]);

  /** Measure every frame; the charts, the jumps and the MVA come from this. */
  const runCycle = () => {
    if (!result?.ok) return;
    const run = ++runRef.current;
    const total = volume.dims.t;
    const frames = [];
    const thresholdFor = (sample) => thresholdOverride ?? estimateThreshold(sample, result).threshold;
    setProgress({ done: 0, total });
    const step = () => {
      if (run !== runRef.current) return;
      const sample = makeSampler(volume, frames.length);
      frames.push(frameMetrics(sample, result, thresholdFor(sample)));
      if (frames.length < total) {
        setProgress({ done: frames.length, total });
        setTimeout(step, 0);
        return;
      }
      const jumps = cycleJumps(frames);
      const bestFrame = jumps.largestOrifice ?? -1;
      setCycle({
        frames,
        jumps,
        perFrame: frames.map((f) => f.orifice),
        bestFrame,
        best: bestFrame >= 0 ? frames[bestFrame].orifice : null,
      });
      setProgress(null);
    };
    setTimeout(step, 0);
  };

  return { frame, thresholdOverride, setThresholdOverride, cycle, progress, runCycle, runMva: runCycle };
}
