import React from 'react';
import styled from 'styled-components';
import { MIN_ANNULUS_POINTS } from '../../../utils/annulus';
import { ANNULUS_COLOR, ANNULUS_PLANE_OPTIONS } from '../hooks/useAnnulus';
import { Button, ButtonRow, Label, MeasureMetaLine, Select, SliderRow } from '../styles';

const Steps = styled.ol`
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.7rem;
  line-height: 1.45;
  color: #9aa5b1;
`;

const Metrics = styled.dl`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.6rem;
  margin: 0;
  font-size: 0.75rem;

  dt {
    color: #9aa5b1;
  }
  dd {
    margin: 0;
    text-align: right;
    color: #e8e6e3;
    font-variant-numeric: tabular-nums;
  }
`;

const Progress = styled.div`
  font-size: 0.75rem;
  color: ${ANNULUS_COLOR};
  font-weight: 600;
`;

const mm = (v) => `${v.toFixed(1)} mm`;
const cm2 = (v) => `${(v / 100).toFixed(2)} cm²`;

export default function AnnulusPanel({ annulus, planes, onPlanesChange, timeIndex }) {
  const { trace, fit, currentPlane } = annulus;
  const active = Boolean(trace?.active);
  const m = fit?.metrics;

  return (
    <>
      {!trace && (
        <Steps>
          <li>Tilt and move the planes so the blue (axial) plane lies across the mitral annulus, with the crosshair at the valve centre.</li>
          <li>Press Start.</li>
          <li>In the red (sagittal) view, click the two annulus hinge points. The view then rotates to the next angle.</li>
        </Steps>
      )}
      <SliderRow>
        <Label $wide="3.6rem">Planes</Label>
        <Select
          value={planes}
          disabled={active}
          onChange={(e) => onPlanesChange(Number(e.target.value))}
          title="Number of rotated planes (2 points each)"
        >
          {ANNULUS_PLANE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} planes · every {Math.round(180 / n)}°
            </option>
          ))}
        </Select>
      </SliderRow>
      <ButtonRow>
        <Button $grow $active={active} onClick={() => annulus.start(planes)} title="Start a new annulus trace">
          {trace ? 'Restart' : 'Start'}
        </Button>
        <Button $grow onClick={annulus.undo} disabled={!trace?.points.length} title="Remove the last point">
          Undo
        </Button>
        <Button $grow onClick={annulus.clear} disabled={!trace} title="Delete the annulus">
          Clear
        </Button>
      </ButtonRow>
      {active && (
        <Progress>
          Plane {currentPlane + 1}/{trace.planes} · point {(trace.points.length % 2) + 1} of 2
        </Progress>
      )}
      {trace && trace.timeIndex !== timeIndex && (
        <MeasureMetaLine>Traced on frame T{trace.timeIndex + 1}; go back to it to see the curve.</MeasureMetaLine>
      )}
      {trace && !m && (
        <MeasureMetaLine>
          {trace.points.length}/{MIN_ANNULUS_POINTS} points needed for a curve fit
        </MeasureMetaLine>
      )}
      {m && (
        <Metrics>
          <dt>Area (2D projected)</dt>
          <dd>{cm2(m.area2dMm2)}</dd>
          <dt>Area (3D)</dt>
          <dd>{cm2(m.area3dMm2)}</dd>
          <dt>Perimeter</dt>
          <dd>{mm(m.perimeterMm)}</dd>
          <dt>Max diameter (≈ CC)</dt>
          <dd>{mm(m.maxDiameterMm)}</dd>
          <dt>Min diameter (≈ AP)</dt>
          <dd>{mm(m.minDiameterMm)}</dd>
          <dt>Saddle height</dt>
          <dd>{mm(m.heightMm)}</dd>
          <dt>AHCWR</dt>
          <dd>{m.ahcwrPercent.toFixed(1)} %</dd>
          <dt>Points</dt>
          <dd>{m.pointCount}</dd>
        </Metrics>
      )}
    </>
  );
}
