import { useEffect, useRef, useState } from 'react';
import { snapshotMeasurementPlane } from '../../../utils/mprGeometry';
import { pickMeasureColor } from '../../../utils/measurements';

/**
 * Length/area measurements, the selected one, and the live draft mirrored
 * into the 3D view. Cleared whenever a new volume is loaded.
 */
export default function useMeasurements({ volume, timeIndex, mprCenter, mprBasis }) {
  const [measurements, setMeasurements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [liveDraft, setLiveDraft] = useState(null);
  const [clearDraftSignal, setClearDraftSignal] = useState(0);
  const labelCounters = useRef({ d: 0, a: 0 });

  const clear = () => {
    setMeasurements([]);
    setSelectedId(null);
    setClearDraftSignal((n) => n + 1);
    labelCounters.current = { d: 0, a: 0 };
  };

  useEffect(() => {
    setMeasurements([]);
    setSelectedId(null);
    setLiveDraft(null);
    setClearDraftSignal((n) => n + 1);
    labelCounters.current = { d: 0, a: 0 };
  }, [volume]);

  const add = (partial) => {
    const isDist = partial.type === 'distance';
    const n = isDist ? ++labelCounters.current.d : ++labelCounters.current.a;
    const snap = snapshotMeasurementPlane(volume, partial.axis, mprCenter, mprBasis);
    const next = {
      ...partial,
      ...snap,
      label: isDist ? `D${n}` : `A${n}`,
      timeIndex,
    };
    setMeasurements((prev) => [...prev, { ...next, color: pickMeasureColor(prev) }]);
    setSelectedId(next.id);
  };

  const update = (id, updater) => {
    setMeasurements((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  const remove = (id) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  return {
    measurements,
    selectedId,
    setSelectedId,
    liveDraft,
    setLiveDraft,
    clearDraftSignal,
    add,
    update,
    remove,
    clear,
  };
}
