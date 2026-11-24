import { useEffect, useMemo, useState } from 'react';
import { MV_POINTS, buildMvSlicer, moveKeepingDepth } from '../../utils/mvSlicer';

/**
 * State of the mitral valve slicer: the four picked points (AL, Mid, PM,
 * AoV), the normal of the view they were picked in, display options, and
 * whether the nine-cut view is open.
 */
export default function useMvSlicer({ volume }) {
  const [points, setPoints] = useState({});
  const [viewNormal, setViewNormal] = useState(null);
  const [mode, setMode] = useState('fan');
  const [flipVertical, setFlipVertical] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPoints({});
    setViewNormal(null);
    setOpen(false);
  }, [volume]);

  const next = MV_POINTS.find((p) => !points[p.key]) || null;
  const placedCount = MV_POINTS.filter((p) => points[p.key]).length;

  const result = useMemo(
    () => (next ? null : buildMvSlicer(points, viewNormal, { mode, flipVertical, mirror })),
    [next, points, viewNormal, mode, flipVertical, mirror]
  );

  /** Place the next point; returns true when that was the last one. */
  const addPoint = (mm, paneNormal) => {
    if (!next) return false;
    if (next.key === 'al') setViewNormal(paneNormal ? paneNormal.slice() : null);
    setPoints((prev) => ({ ...prev, [next.key]: mm.slice() }));
    return next.key === MV_POINTS[MV_POINTS.length - 1].key;
  };

  /**
   * Move a placed point to `inPlaneMm` (a point on the valve-level plane, e.g.
   * from the en-face key map), keeping its height above or below the valve.
   */
  const movePoint = (key, inPlaneMm) => {
    const normal = result?.ok ? result.normal : viewNormal;
    setPoints((prev) => {
      if (!prev[key]) return prev;
      const moved = normal ? moveKeepingDepth(prev[key], inPlaneMm, normal) : inPlaneMm.slice();
      const candidate = { ...prev, [key]: moved };
      // Ignore a move that would make the cuts impossible (e.g. AL onto PM).
      const ok = buildMvSlicer(candidate, viewNormal, { mode, flipVertical, mirror }).ok;
      return ok ? candidate : prev;
    });
  };

  const undo = () => {
    const last = [...MV_POINTS].reverse().find((p) => points[p.key]);
    if (!last) return;
    setPoints((prev) => {
      const out = { ...prev };
      delete out[last.key];
      return out;
    });
    if (last.key === 'al') setViewNormal(null);
    setOpen(false);
  };

  const clear = () => {
    setPoints({});
    setViewNormal(null);
    setOpen(false);
  };

  /** What the 2D panes draw. */
  const overlay = useMemo(
    () =>
      placedCount
        ? {
            points: MV_POINTS.filter((p) => points[p.key]).map((p) => ({
              key: p.key,
              short: p.short,
              mm: points[p.key],
            })),
            result: result?.ok ? result : null,
          }
        : null,
    [placedCount, points, result]
  );

  return {
    points,
    next,
    placedCount,
    complete: !next,
    result,
    mode,
    setMode,
    flipVertical,
    setFlipVertical,
    mirror,
    setMirror,
    open,
    setOpen,
    addPoint,
    movePoint,
    undo,
    clear,
    overlay,
  };
}
