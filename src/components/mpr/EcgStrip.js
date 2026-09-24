import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { frameToSampleIndex, sampleIndexToFrame } from '../../utils/ecg';

const EcgBar = styled.div`
  flex-shrink: 0;
  height: 76px;
  background: #080c10;
  border-top: 1px solid #2a3542;
  position: relative;
`;

const EcgCanvas = styled.canvas`
  width: 100%;
  height: 100%;
  display: block;
  cursor: pointer;
`;

const EcgLegend = styled.div`
  position: absolute;
  top: 5px;
  left: 10px;
  z-index: 1;
  font-size: 0.7rem;
  color: #8ad4c4;
  pointer-events: none;
  text-shadow: 0 1px 2px #000;
`;

export default function EcgStrip({ ecg, timeIndex, frameCount, onSeek }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !ecg?.samples?.length) return undefined;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(8, Math.round(rect.width));
      const h = Math.max(8, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#080c10';
      ctx.fillRect(0, 0, w, h);

      const samples = ecg.samples;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = max - min || 1;
      const padY = 10;
      const padX = 8;
      const usableW = w - padX * 2;
      const usableH = h - padY * 2;

      ctx.strokeStyle = '#1c2a32';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const xAt = (i) => padX + (i / Math.max(1, samples.length - 1)) * usableW;
      const yAt = (v) => padY + (1 - (v - min) / span) * usableH;

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = xAt(i);
        const y = yAt(samples[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const lastX = xAt(samples.length - 1);
      ctx.lineTo(lastX, h - 2);
      ctx.lineTo(xAt(0), h - 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(61, 154, 139, 0.22)';
      ctx.fill();

      ctx.strokeStyle = '#6ee0cc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = xAt(i);
        const y = yAt(samples[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (ecg.beats?.length) {
        ctx.fillStyle = '#e07a5f';
        ecg.beats.forEach((b) => {
          const x = xAt(b);
          ctx.beginPath();
          ctx.moveTo(x, 3);
          ctx.lineTo(x - 4, 11);
          ctx.lineTo(x + 4, 11);
          ctx.closePath();
          ctx.fill();
        });
      }

      const si = frameToSampleIndex(ecg, timeIndex, frameCount);
      const px = xAt(si);
      ctx.strokeStyle = '#ffe082';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ecg, timeIndex, frameCount]);

  const seekFromEvent = (e) => {
    if (!ecg?.samples?.length) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const si = Math.round(x * (ecg.samples.length - 1));
    onSeek(sampleIndexToFrame(ecg, si, frameCount));
  };

  const onPointerDown = (e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    seekFromEvent(e);
  };

  const bpm =
    ecg?.heartRateBpm && Number.isFinite(ecg.heartRateBpm)
      ? Math.round(ecg.heartRateBpm)
      : null;
  const title = `${ecg?.label || 'ECG'}${bpm ? ` · ${bpm} bpm` : ''}`;

  const samp = ecg?.samples;
  let sMin = 0;
  let sMax = 0;
  if (samp?.length) {
    sMin = samp[0];
    sMax = samp[0];
    for (let i = 1; i < samp.length; i++) {
      if (samp[i] < sMin) sMin = samp[i];
      if (samp[i] > sMax) sMax = samp[i];
    }
  }

  return (
    <EcgBar
      ref={wrapRef}
      title="Click to jump to a frame"
      data-ecg-source={ecg?.source || ''}
      data-ecg-beats={(ecg?.beats || []).join(',')}
      data-ecg-bpm={bpm || ''}
      data-ecg-n={samp?.length || 0}
      data-ecg-range={`${sMin.toFixed(3)}:${sMax.toFixed(3)}`}
    >
      <EcgLegend>{title}</EcgLegend>
      <EcgCanvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
      />
    </EcgBar>
  );
}
