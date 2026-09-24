import { useEffect, useMemo, useRef, useState } from 'react';
import { getVolumeAtTime } from '../../../utils/philipsVolume';
import { mmToVoxel, spacingMm } from '../../../utils/mprGeometry';
import {
  autoThreshold,
  boxBlur,
  countMask,
  maskVolumeMl,
  paintDisc,
  regionGrow,
} from '../../../utils/segmentation';

export const SEGMENT_COLORS = ['#26c6da', '#ffb74d', '#ab47bc', '#66bb6a', '#ef5350', '#ffee58'];

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function pickColor(segments) {
  const used = new Set(segments.map((s) => s.color));
  return SEGMENT_COLORS.find((c) => !used.has(c)) || SEGMENT_COLORS[segments.length % SEGMENT_COLORS.length];
}

/**
 * Segmentations of the current volume. Each segment keeps one mask per
 * timepoint (`masks[t]`) so it can follow the cardiac cycle, plus the seed
 * and settings used to grow it.
 */
export default function useSegmentation({ volume, timeIndex }) {
  const [segments, setSegments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [params, setParams] = useState({ smooth: 1, leakCut: 1, brushMm: 4 });
  const [busy, setBusy] = useState(null);
  const smoothCache = useRef({ key: null, data: null });
  const regrowTimer = useRef(null);
  const counter = useRef(0);
  // A mask created by the first brush event, until React re-renders with it.
  const pendingMask = useRef(null);

  useEffect(() => {
    setSegments([]);
    setSelectedId(null);
    setBusy(null);
    smoothCache.current = { key: null, data: null };
    counter.current = 0;
  }, [volume]);

  useEffect(() => () => clearTimeout(regrowTimer.current), []);

  const smoothed = (t, smooth) => {
    const key = `${t}:${smooth}`;
    if (smoothCache.current.key !== key) {
      smoothCache.current = { key, data: boxBlur(getVolumeAtTime(volume, t), volume.dims, smooth) };
    }
    return smoothCache.current.data;
  };

  /** Grow `seg` at frame t; returns { mask, count, threshold }. */
  const growFrame = (seg, t) => {
    const data = smoothed(t, seg.smooth);
    const seed = mmToVoxel(volume, seg.seedMm);
    const threshold = seg.threshold ?? autoThreshold(data, volume.dims, seed);
    const mask = regionGrow(data, volume.dims, seed, { threshold, leakCut: seg.leakCut });
    return { mask, count: countMask(mask), threshold };
  };

  const updateSeg = (id, fn) => setSegments((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));

  const seed = (mm) => {
    if (!volume || busy) return;
    counter.current += 1;
    const base = {
      id: `seg-${Date.now()}`,
      name: `Segment ${counter.current}`,
      color: pickColor(segments),
      source: 'grow',
      seedMm: mm,
      threshold: null,
      autoThreshold: true,
      leakCut: params.leakCut,
      smooth: params.smooth,
      visible: true,
      masks: {},
      counts: {},
      rev: 0,
    };
    const { mask, count, threshold } = growFrame(base, timeIndex);
    const seg = {
      ...base,
      threshold,
      masks: { [timeIndex]: mask },
      counts: { [timeIndex]: count },
    };
    setSegments((prev) => [...prev, seg]);
    setSelectedId(seg.id);
  };

  const selected = segments.find((s) => s.id === selectedId) || null;

  /** Change settings of the selected grown segment and regrow this frame. */
  const regrowSelected = (patch) => {
    if (!selected || selected.source !== 'grow') return;
    const next = { ...selected, ...patch };
    updateSeg(selected.id, () => next);
    clearTimeout(regrowTimer.current);
    regrowTimer.current = setTimeout(() => {
      const { mask, count, threshold } = growFrame(next, timeIndex);
      // Other frames were grown with the old settings; drop them.
      updateSeg(next.id, (s) => ({
        ...s,
        threshold,
        masks: { [timeIndex]: mask },
        counts: { [timeIndex]: count },
        rev: s.rev + 1,
      }));
    }, 120);
  };

  const growAllFrames = async () => {
    if (!selected || selected.source !== 'grow' || busy) return;
    const n = volume.dims.t;
    const masks = {};
    const counts = {};
    setBusy({ label: 'Growing', i: 0, n });
    for (let t = 0; t < n; t++) {
      // Auto threshold is re-estimated per frame; a manual one is kept.
      const seg = selected.autoThreshold ? { ...selected, threshold: null } : selected;
      const { mask, count } = growFrame(seg, t);
      masks[t] = mask;
      counts[t] = count;
      setBusy({ label: 'Growing', i: t + 1, n });
      await nextTick();
    }
    updateSeg(selected.id, (s) => ({ ...s, masks, counts, rev: s.rev + 1 }));
    setBusy(null);
  };

  const brush = (mm, normal, erase) => {
    if (!selected || busy) return;
    const sp = spacingMm(volume);
    const pending = pendingMask.current;
    const mask =
      selected.masks[timeIndex] ||
      (pending && pending.id === selected.id && pending.t === timeIndex ? pending.mask : null) ||
      new Uint8Array(volume.volumeSize);
    pendingMask.current = { id: selected.id, t: timeIndex, mask };
    const delta = paintDisc(
      mask,
      volume,
      mm,
      normal,
      params.brushMm,
      Math.max(sp.x, sp.y, sp.z) * 0.5,
      erase ? 0 : 1
    );
    if (!delta && selected.masks[timeIndex]) return;
    updateSeg(selected.id, (s) => ({
      ...s,
      masks: { ...s.masks, [timeIndex]: mask },
      counts: { ...s.counts, [timeIndex]: (s.counts[timeIndex] || 0) + delta },
      rev: s.rev + 1,
    }));
  };

  const addEmpty = (name) => {
    counter.current += 1;
    const seg = {
      id: `seg-${Date.now()}`,
      name: name || `Segment ${counter.current}`,
      color: pickColor(segments),
      source: 'manual',
      visible: true,
      masks: {},
      counts: {},
      rev: 0,
    };
    setSegments((prev) => [...prev, seg]);
    setSelectedId(seg.id);
  };

  /** Add ready-made masks (e.g. from the AI model) at frame t. */
  const addMasks = (items, t) => {
    setSegments((prev) => {
      const out = [...prev];
      items.forEach(({ name, mask, color }) => {
        counter.current += 1;
        out.push({
          id: `seg-${Date.now()}-${counter.current}`,
          name,
          color: color || pickColor(out),
          source: 'ai',
          visible: true,
          masks: { [t]: mask },
          counts: { [t]: countMask(mask) },
          rev: 0,
        });
      });
      return out;
    });
  };

  const remove = (id) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const toggleVisible = (id) => updateSeg(id, (s) => ({ ...s, visible: !s.visible }));

  /** Segments with a mask on the current frame, as the panes draw them. */
  const visible = useMemo(
    () =>
      segments
        .filter((s) => s.visible && s.masks[timeIndex])
        .map((s) => ({ id: s.id, color: s.color, mask: s.masks[timeIndex], rev: s.rev })),
    [segments, timeIndex]
  );

  const volumeMl = (seg, t) =>
    seg.counts[t] == null ? null : maskVolumeMl(seg.counts[t], volume.spacingCm);

  return {
    segments,
    selected,
    selectedId,
    setSelectedId,
    params,
    setParams: (patch) => setParams((p) => ({ ...p, ...patch })),
    busy,
    visible,
    seed,
    regrowSelected,
    growAllFrames,
    brush,
    addEmpty,
    addMasks,
    remove,
    toggleVisible,
    volumeMl,
  };
}
