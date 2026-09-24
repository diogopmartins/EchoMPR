import React from 'react';
import { FIT_ZOOM } from '../constants';
import { Button, Label, Slider, SliderRow } from '../styles';

export default function ImagePanel({
  windowCenter,
  windowWidth,
  onWindowLevelChange,
  zoom,
  onZoomChange,
}) {
  return (
    <>
      <SliderRow>
        <Label $wide="3.6rem">WC {windowCenter}</Label>
        <Slider
          type="range"
          min={0}
          max={255}
          value={windowCenter}
          onChange={(e) => onWindowLevelChange({ windowCenter: Number(e.target.value) })}
        />
      </SliderRow>
      <SliderRow>
        <Label $wide="3.6rem">WW {windowWidth}</Label>
        <Slider
          type="range"
          min={1}
          max={255}
          value={windowWidth}
          onChange={(e) => onWindowLevelChange({ windowWidth: Number(e.target.value) })}
        />
      </SliderRow>
      <SliderRow>
        <Label $wide="4.5rem">Zoom {Math.round(zoom * 100)}%</Label>
        <Slider
          type="range"
          min={0.4}
          max={4}
          step={0.05}
          value={zoom}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          title="MPR zoom"
        />
      </SliderRow>
      <Button $grow onClick={() => onZoomChange(FIT_ZOOM)} title="Fit default zoom">
        Fit
      </Button>
    </>
  );
}
