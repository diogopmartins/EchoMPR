import { useEffect, useMemo, useState } from 'react';
import { moveKeepingDepth } from '../../utils/mvSlicer';

/**
 * State of a valve slicer (MV or TV): the picked points, the normal of the
 * view they were picked in, display options, whether the cut view is open,
 * and the annulus traced in the cuts. Annulus hinges are kept in world mm, so
 * they stay valid when the points are adjusted and the cuts move.
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
  // Annulus hinges: { p: world mm, cut: cut index, side: 'L' | 'R', t: frame }
  const [hinges, setHinges] = useState([]);
  // Aortic annulus hinges in one cut (MV): { cut, t, pts: [p1, p2] }
  const [aortic, setAortic] = useState(null);
  const [reference, setReference] = useState('saddle');

  useEffect(() => {
    setPoints({});
    setViewNormal(null);
    setOpen(false);
    setHinges([]);
    setAortic(null);
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
    setHinges([]);
    setAortic(null);
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
    hinges,
    setHinges,
    aortic,
    setAortic,
    reference,
    setReference,
  };
}
