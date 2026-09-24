import React from 'react';
import { Play, Pause } from 'lucide-react';
import { Button, Label, MeasureMetaLine, Slider, SliderRow } from '../styles';

export default function CinePanel({
  volume,
  timeIndex,
  onSeek,
  playing,
  onTogglePlay,
  cineRate,
  exporting,
  ecg,
}) {
  return (
    <>
      <Button
        $grow
        onClick={onTogglePlay}
        disabled={volume.dims.t <= 1 || Boolean(exporting)}
        title="Play/pause (Space). Paused: ← → step frame. Playing: ← slower, → faster up to 1×"
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
        Cine {cineRate === 1 ? '1×' : `${cineRate}×`}
      </Button>
      <SliderRow>
        <Label $wide="4.2rem">
          T {timeIndex + 1}/{volume.dims.t}
        </Label>
        <Slider
          type="range"
          min={0}
          max={Math.max(0, volume.dims.t - 1)}
          value={timeIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </SliderRow>
      {ecg ? (
        <MeasureMetaLine>
          {ecg.label || 'ECG'}
          {ecg.heartRateBpm ? ` · ${Math.round(ecg.heartRateBpm)} bpm` : ''}
        </MeasureMetaLine>
      ) : null}
      <MeasureMetaLine>
        Space play/pause · ← → {playing ? 'speed' : 'frame'}
      </MeasureMetaLine>
    </>
  );
}
