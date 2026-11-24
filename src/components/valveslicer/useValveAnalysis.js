import { useEffect, useMemo, useState } from 'react';
import {
  PROLAPSE_MM,
  cutProfile,
  estimateThreshold,
  heightMap,
  makeSampler,
  orificeOverCycle,
} from '../../utils/valveAnalysis';

/**
 * Leaflet analysis for the current frame of a slicer result: tissue
 * threshold (automatic or set by the user), prolapse height map, and a
 * leaflet trace per cut. MVA is computed over the cycle on request.
 */
export default function useValveAnalysis({ volume, timeIndex, result }) {
  const [thresholdOverride, setThresholdOverride] = useState(null);
  const [cycle, setCycle] = useState(null);

  useEffect(() => {
    setCycle(null);
  }, [result, thresholdOverride]);

  useEffect(() => {
    setThresholdOverride(null);
  }, [volume]);

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

  /** Orifice per frame over the cycle (the largest is taken as the MVA). */
  const runMva = () => {
    if (!result?.ok) return;
    const seed = result.kind === 'mv' ? result.projected.mid : result.projected.c;
    setCycle(
      orificeOverCycle(volume, result, seed, (sample) =>
        thresholdOverride ?? estimateThreshold(sample, result).threshold
      )
    );
  };

  return { frame, thresholdOverride, setThresholdOverride, cycle, runMva };
}
