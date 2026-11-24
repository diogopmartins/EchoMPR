import { useEffect, useMemo, useState } from 'react';
import { moveKeepingDepth } from '../../utils/mvSlicer';

/**
 * State of a valve slicer (MV or TV): the picked points, the normal of the
 * view they were picked in, display options, and whether the cut view is open.
 *
 * @param {{volume, pointDefs: {key,label,short,color}[], build: Function}} config
 *   `build(points, viewNormal, options)` returns the slicer result.
 */
export default function useValveSlicer({ volume, pointDefs, build }) {
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

  const next = pointDefs.find((p) => !points[p.key]) || null;
  const placedCount = pointDefs.filter((p) => points[p.key]).length;
  const options = useMemo(() => ({ mode, flipVertical, mirror }), [mode, flipVertical, mirror]);

  const result = useMemo(
    () => (next ? null : build(points, viewNormal, options)),
    [next, points, viewNormal, options, build]
  );

  /** Place the next point; returns true when that was the last one. */
  const addPoint = (mm, paneNormal) => {
    if (!next) return false;
    if (next.key === pointDefs[0].key) setViewNormal(paneNormal ? paneNormal.slice() : null);
    setPoints((prev) => ({ ...prev, [next.key]: mm.slice() }));
    return next.key === pointDefs[pointDefs.length - 1].key;
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
      return build(candidate, viewNormal, options).ok ? candidate : prev;
    });
  };

  const undo = () => {
    const last = [...pointDefs].reverse().find((p) => points[p.key]);
    if (!last) return;
    setPoints((prev) => {
      const out = { ...prev };
      delete out[last.key];
      return out;
    });
    if (last.key === pointDefs[0].key) setViewNormal(null);
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
            points: pointDefs
              .filter((p) => points[p.key])
              .map((p) => ({ key: p.key, short: p.short, color: p.color, mm: points[p.key] })),
            result: result?.ok ? result : null,
          }
        : null,
    [placedCount, pointDefs, points, result]
  );

  return {
    pointDefs,
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
