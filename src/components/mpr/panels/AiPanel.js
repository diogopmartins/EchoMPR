import React, { useRef } from 'react';
import styled from 'styled-components';
import { Button, Label, MeasureMetaLine, Select, SliderRow } from '../styles';

const Input = styled.input`
  flex: 1;
  min-width: 0;
  background: #243040;
  border: 1px solid #3a4a5c;
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.3rem 0.45rem;
  font-size: 0.78rem;
`;

const Status = styled.div`
  font-size: 0.72rem;
  line-height: 1.4;
  color: ${(p) => (p.$kind === 'error' ? '#ff8a80' : p.$kind === 'busy' ? '#ffe082' : '#8ad4c4')};
`;

export default function AiPanel({ ai, hasAnnulus }) {
  const fileRef = useRef(null);
  const { model, spec, status } = ai;
  const extentMm = (spec.roi * spec.spacingMm).toFixed(0);

  return (
    <>
      <MeasureMetaLine>
        Loads an ONNX model from your computer and runs it in the browser. See
        scripts/train_mvseg.py to train a mitral leaflet model on MVSeg2023.
      </MeasureMetaLine>
      <input
        ref={fileRef}
        type="file"
        accept=".onnx"
        style={{ display: 'none' }}
        onChange={(e) => {
          ai.loadModel(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Button $grow onClick={() => fileRef.current?.click()} disabled={ai.busy}>
        {model ? `Model: ${model.name}` : 'Load .onnx model…'}
      </Button>
      <SliderRow>
        <Label $wide="4.6rem">Input size</Label>
        <Input
          type="number"
          min={16}
          max={256}
          step={16}
          value={spec.roi}
          disabled={Boolean(model?.fixedRoi)}
          onChange={(e) => ai.setSpec({ roi: Math.max(8, Number(e.target.value) || 8) })}
          title="Voxels per side of the model input cube"
        />
      </SliderRow>
      <SliderRow>
        <Label $wide="4.6rem">Spacing mm</Label>
        <Input
          type="number"
          min={0.1}
          max={3}
          step={0.1}
          value={spec.spacingMm}
          onChange={(e) => ai.setSpec({ spacingMm: Math.max(0.05, Number(e.target.value) || 0.6) })}
          title="Isotropic voxel size the model was trained at"
        />
      </SliderRow>
      <SliderRow>
        <Label $wide="4.6rem">Labels</Label>
        <Input
          type="text"
          value={spec.labels}
          onChange={(e) => ai.setSpec({ labels: e.target.value })}
          title="Names for output classes 1, 2, … (comma separated)"
        />
      </SliderRow>
      <SliderRow>
        <Label $wide="4.6rem">Centre</Label>
        <Select value={ai.centerOn} onChange={(e) => ai.setCenterOn(e.target.value)}>
          <option value="crosshair">Crosshair</option>
          <option value="annulus" disabled={!hasAnnulus}>
            Traced annulus
          </option>
        </Select>
      </SliderRow>
      <MeasureMetaLine>Input cube: {extentMm} mm per side</MeasureMetaLine>
      <Button $grow onClick={ai.run} disabled={!model || ai.busy} title="Segment the current frame">
        Run on this frame
      </Button>
      {status && <Status $kind={status.kind}>{status.text}</Status>}
      <MeasureMetaLine>Research use only. Check every result by eye.</MeasureMetaLine>
    </>
  );
}
