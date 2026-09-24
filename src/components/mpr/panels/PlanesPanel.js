import React from 'react';
import { AXIS_META } from '../constants';
import { Button, ButtonRow, Label, Slider, SliderRow } from '../styles';

const PLANE_SLIDERS = [
  { key: 'x', axis: 'sagittal', dim: 'x' },
  { key: 'y', axis: 'coronal', dim: 'y' },
  { key: 'z', axis: 'axial', dim: 'z' },
];

export default function PlanesPanel({
  volume,
  crosshair,
  onCrosshairChange,
  onResetTilt,
  slabMm,
  slabMode,
  onSettingsChange,
}) {
  return (
    <>
      {PLANE_SLIDERS.map(({ key, axis, dim }) => (
        <SliderRow key={key}>
          <Label style={{ color: AXIS_META[axis].color }}>
            {key.toUpperCase()} {crosshair[key]}
          </Label>
          <Slider
            type="range"
            min={0}
            max={volume.dims[dim] - 1}
            value={crosshair[key]}
            onChange={(e) => onCrosshairChange({ [key]: Number(e.target.value) })}
            style={{ accentColor: AXIS_META[axis].color }}
          />
        </SliderRow>
      ))}
      <Button $grow onClick={onResetTilt} title="Reset plane tilt to orthogonal">
        Reset tilt
      </Button>
      <SliderRow>
        <Label $wide="4.8rem">{slabMm < 1 ? 'Thin' : `${slabMm} mm`}</Label>
        <Slider
          type="range"
          min={0}
          max={8}
          step={1}
          value={slabMm}
          onChange={(e) => onSettingsChange({ slabMm: Number(e.target.value) })}
          title="Slice thickness (0 = single plane)"
        />
      </SliderRow>
      <ButtonRow>
        <Button
          $grow
          $active={slabMode === 'mean'}
          onClick={() => onSettingsChange({ slabMode: 'mean' })}
          disabled={slabMm < 1}
          title="Average through the slab"
        >
          Mean
        </Button>
        <Button
          $grow
          $active={slabMode === 'mip'}
          onClick={() => onSettingsChange({ slabMode: 'mip' })}
          disabled={slabMm < 1}
          title="Maximum intensity through the slab"
        >
          MIP
        </Button>
      </ButtonRow>
    </>
  );
}
