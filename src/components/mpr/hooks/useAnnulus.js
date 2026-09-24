import { useEffect, useMemo, useState } from 'react';
import { rotateBasisInPlane } from '../../../utils/mprGeometry';
import { fitAnnulus } from '../../../utils/annulus';

export const ANNULUS_COLOR = '#ff4fa3';
export const ANNULUS_PLANE_OPTIONS = [4, 6, 8, 9, 12];

/**
 * Mitral annulus tracing on rotated planes.
 *
 * The blue (axial) plane normal at Start is taken as the valve axis. The red
 * (sagittal) plane contains that axis; after each pair of hinge points it is
 * rotated by 180°/planes about the axis, so `planes` rotations collect
 * 2·planes points evenly spread around the annulus.
 */
export default function useAnnulus({
  volume,
  timeIndex,
  mprCenter,
  mprBasis,
  setMprCenter,
  setMprBasis,
  onStart,
  onFinish,
}) {
  const [trace, setTrace] = useState(null);

  useEffect(() => {
    setTrace(null);
  }, [volume]);

  const showPlane = (t, k) => {
    setMprCenter(t.center0);
    setMprBasis(rotateBasisInPlane(t.basis0, 'z', (k * Math.PI) / t.planes));
  };

  const start = (planes) => {
    const t = {
      points: [],
      planes,
      center0: { ...mprCenter },
      basis0: mprBasis,
      timeIndex,
      active: true,
    };
    setTrace(t);
    showPlane(t, 0);
    onStart?.();
  };

  const addPoint = (mm) => {
    if (!trace?.active) return;
    const points = [...trace.points, mm];
    const plane = Math.floor(points.length / 2);
    const done = plane >= trace.planes;
    setTrace({ ...trace, points, active: !done });
    if (points.length % 2 === 0) {
      showPlane(trace, done ? 0 : plane);
      if (done) onFinish?.();
    }
  };

  const undo = () => {
    if (!trace?.points.length) return;
    const points = trace.points.slice(0, -1);
    const wasDone = !trace.active;
    setTrace({ ...trace, points, active: true });
    showPlane(trace, Math.floor(points.length / 2));
    if (wasDone) onStart?.();
  };

  const clear = () => {
    const wasActive = trace?.active;
    setTrace(null);
    if (wasActive) onFinish?.();
  };

  const fit = useMemo(() => (trace ? fitAnnulus(trace.points) : null), [trace]);

  /** What the panes and the 3D view draw; only on the frame it was traced on. */
  const view = useMemo(() => {
    if (!trace || trace.timeIndex !== timeIndex) return null;
    return {
      points: trace.points,
      curve: fit?.curve || null,
      normal: fit?.normal || null,
      color: ANNULUS_COLOR,
    };
  }, [trace, fit, timeIndex]);

  return {
    trace,
    fit,
    view,
    start,
    addPoint,
    undo,
    clear,
    currentPlane: trace ? Math.min(trace.planes, Math.floor(trace.points.length / 2)) : 0,
  };
}
