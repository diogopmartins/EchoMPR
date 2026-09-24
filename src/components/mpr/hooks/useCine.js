import { useEffect, useRef, useState } from 'react';
import { CINE_RATES } from '../constants';

function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT' && el.type !== 'range') return true;
  return el.isContentEditable;
}

/**
 * Cine playback plus the workspace keyboard shortcuts:
 * Space play/pause, ←/→ step a frame (paused) or change speed (playing),
 * Escape calls `onEscape`.
 */
export default function useCine({ volume, timeIndex, setTimeIndex, exporting, onEscape }) {
  const [playing, setPlaying] = useState(false);
  const [cineRate, setCineRate] = useState(1);
  const timeRef = useRef(timeIndex);
  timeRef.current = timeIndex;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    setPlaying(false);
    setCineRate(1);
  }, [volume]);

  useEffect(() => {
    if (!playing || exporting || !volume || volume.dims.t <= 1) return undefined;
    const ms = Math.max(16, (volume.frameTimeMs || 50) / cineRate);
    const id = setInterval(() => {
      setTimeIndex((timeRef.current + 1) % volume.dims.t);
    }, ms);
    return () => clearInterval(id);
  }, [playing, cineRate, volume, setTimeIndex, exporting]);

  useEffect(() => {
    const onKey = (ev) => {
      if (isTypingTarget(ev.target)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      if (ev.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }

      if (!volume || volume.dims.t <= 1) return;

      if (ev.code === 'Space' || ev.key === ' ') {
        ev.preventDefault();
        if (ev.repeat || exporting) return;
        setPlaying((p) => !p);
        return;
      }

      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const dir = ev.key === 'ArrowRight' ? 1 : -1;
      const n = volume.dims.t;

      if (playingRef.current) {
        if (ev.repeat) return;
        setCineRate((r) => {
          const idx = CINE_RATES.indexOf(r);
          const i = idx < 0 ? CINE_RATES.length - 1 : idx;
          return CINE_RATES[Math.max(0, Math.min(CINE_RATES.length - 1, i + dir))];
        });
        return;
      }

      setTimeIndex((timeRef.current + dir + n) % n);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [volume, setTimeIndex, exporting]);

  return { playing, setPlaying, cineRate };
}
