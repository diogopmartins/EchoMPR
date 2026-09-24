import React from 'react';
import { FlipHorizontal, RotateCcw } from 'lucide-react';
import { AXIS_META, CROP_PLANES } from '../constants';
import { Button, ButtonRow, Label, Select, Slider, SliderRow } from '../styles';

const LIGHT_SLIDERS = [
  { key: 'lightAzimuth', label: 'az', min: 0, max: 360, step: 1, title: 'Light azimuth' },
  { key: 'lightElevation', label: 'el', min: -80, max: 80, step: 1, title: 'Light elevation' },
  { key: 'lightIntensity', label: 'int', min: 0.2, max: 2, step: 0.05, title: 'Light intensity' },
];

export default function VolumePanel({ settings, actions }) {
  const { colorStyle, renderMode, opacity, useCutPlanes, showMprLines, cropPlaneKey } =
    settings;
  return (
    <>
      <Select
        value={colorStyle}
        onChange={(e) => actions.setColorStyle(e.target.value)}
        title="Volume color style"
      >
        <option value="philips">Philips</option>
        <option value="glass">Glass</option>
        <option value="gray">Gray</option>
      </Select>
      <ButtonRow>
        <Button
          $grow
          $active={renderMode === 'dvr'}
          onClick={() => actions.set({ renderMode: 'dvr' })}
          title="Shaded volume rendering"
        >
          DVR
        </Button>
        <Button
          $grow
          $active={renderMode === 'mip'}
          onClick={() => actions.set({ renderMode: 'mip' })}
          title="Maximum intensity projection"
        >
          MIP
        </Button>
      </ButtonRow>
      <SliderRow>
        <Label $wide="4.2rem">Opacity</Label>
        <Slider
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => actions.set({ opacity: Number(e.target.value) })}
        />
      </SliderRow>
      <ButtonRow>
        <Button
          $grow
          $active={useCutPlanes}
          onClick={() => actions.toggle('useCutPlanes')}
          title="Crop the 3D volume with an MPR plane"
        >
          {useCutPlanes ? 'Cuts on' : 'Cuts off'}
        </Button>
        <Button
          $grow
          $active={showMprLines}
          onClick={() => actions.toggle('showMprLines')}
          title="Show MPR planes on the 3D volume"
        >
          {showMprLines ? 'MPR lines on' : 'MPR lines off'}
        </Button>
      </ButtonRow>
      <ButtonRow>
        {CROP_PLANES.map((p) => (
          <Button
            key={p.key}
            $grow
            $active={cropPlaneKey === p.key}
            onClick={() => actions.setCropPlane(p.key)}
            title={`Crop with the ${p.name.toLowerCase()} ${AXIS_META[p.axis].label} plane`}
            style={{ color: AXIS_META[p.axis].color }}
          >
            {p.name}
          </Button>
        ))}
      </ButtonRow>
      <Button
        $grow
        onClick={() => actions.toggle('cropFlip')}
        disabled={!useCutPlanes}
        title="Keep the other side of the crop plane"
      >
        <FlipHorizontal size={14} />
        Flip side
      </Button>
      <Button $grow onClick={() => actions.bump('cameraResetToken')} title="Reset 3D camera">
        <RotateCcw size={14} />
        Reset 3D
      </Button>
      {LIGHT_SLIDERS.map((s) => (
        <SliderRow key={s.key}>
          <Label>{s.label}</Label>
          <Slider
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={settings[s.key]}
            onChange={(e) => actions.set({ [s.key]: Number(e.target.value) })}
            title={s.title}
          />
        </SliderRow>
      ))}
    </>
  );
}
