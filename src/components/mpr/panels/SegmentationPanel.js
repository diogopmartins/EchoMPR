import React from 'react';
import styled from 'styled-components';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { Button, ButtonRow, Label, MeasureMetaLine, Slider, SliderRow } from '../styles';

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.35rem 0.28rem 0.55rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  background: ${(p) => (p.$active ? 'rgba(61, 154, 139, 0.2)' : '#243040')};
  border: 1px solid ${(p) => (p.$active ? p.$color : '#3a4a5c')};
  box-shadow: inset 3px 0 0 ${(p) => p.$color};
`;

const Name = styled.span`
  color: ${(p) => p.$color};
  font-weight: 600;
`;

const IconBtn = styled.button`
  background: none;
  border: none;
  color: #9aa5b1;
  padding: 2px;
  display: inline-flex;
  cursor: pointer;

  &:hover {
    color: #e8e6e3;
  }
`;

const Cycle = styled.div`
  font-size: 0.72rem;
  color: #c8d2dc;
  line-height: 1.5;
`;

function Sparkline({ values, timeIndex, color }) {
  const w = 200;
  const h = 34;
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const x = (i) => (i / Math.max(1, values.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Volume over the cardiac cycle">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
      />
      <line x1={x(timeIndex)} x2={x(timeIndex)} y1="0" y2={h} stroke="#ffe082" strokeWidth="1" />
    </svg>
  );
}

export default function SegmentationPanel({ seg, tool, onToolChange, timeIndex, frameCount }) {
  const { segments, selected, params, busy } = seg;
  const ml = (s, t) => seg.volumeMl(s, t);
  const series = selected ? Array.from({ length: frameCount }, (_, t) => ml(selected, t)) : [];
  const known = series.filter((v) => v != null);
  const edv = known.length >= 2 ? Math.max(...known) : null;
  const esv = known.length >= 2 ? Math.min(...known) : null;

  return (
    <>
      <ButtonRow>
        <Button $grow $active={tool === 'seed'} onClick={() => onToolChange('seed')} title="Click inside a chamber to grow a segmentation">
          Seed
        </Button>
        <Button $grow $active={tool === 'paint'} onClick={() => onToolChange('paint')} disabled={!selected} title="Paint the selected segmentation">
          Paint
        </Button>
        <Button $grow $active={tool === 'erase'} onClick={() => onToolChange('erase')} disabled={!selected} title="Erase from the selected segmentation">
          Erase
        </Button>
      </ButtonRow>
      <SliderRow>
        <Label $wide="4.4rem">Brush {params.brushMm} mm</Label>
        <Slider
          type="range"
          min={1}
          max={15}
          value={params.brushMm}
          onChange={(e) => seg.setParams({ brushMm: Number(e.target.value) })}
        />
      </SliderRow>

      {segments.length === 0 ? (
        <MeasureMetaLine>None yet · Seed inside a chamber, or Paint after adding an empty one</MeasureMetaLine>
      ) : (
        <List>
          {segments.map((s) => {
            const v = ml(s, timeIndex);
            return (
              <Row
                key={s.id}
                $color={s.color}
                $active={s.id === seg.selectedId}
                onClick={() => seg.setSelectedId(s.id)}
              >
                <span>
                  <Name $color={s.color}>{s.name}</Name>
                  <MeasureMetaLine>
                    {v != null ? `${v.toFixed(1)} mL at T${timeIndex + 1}` : 'not on this frame'}
                    {s.source === 'ai' ? ' · AI' : ''}
                  </MeasureMetaLine>
                </span>
                <IconBtn
                  type="button"
                  title={s.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    seg.toggleVisible(s.id);
                  }}
                >
                  {s.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </IconBtn>
                <IconBtn
                  type="button"
                  title={`Delete ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    seg.remove(s.id);
                  }}
                >
                  <Trash2 size={13} />
                </IconBtn>
              </Row>
            );
          })}
        </List>
      )}
      <Button $grow onClick={() => seg.addEmpty()} title="New empty segmentation to paint by hand">
        New empty
      </Button>

      {selected?.source === 'grow' && (
        <>
          <SliderRow>
            <Label $wide="4.4rem">Thresh {selected.threshold ?? '—'}</Label>
            <Slider
              type="range"
              min={1}
              max={254}
              value={selected.threshold ?? 60}
              onChange={(e) => seg.regrowSelected({ threshold: Number(e.target.value), autoThreshold: false })}
              title="Upper intensity for the blood pool"
            />
          </SliderRow>
          <ButtonRow>
            <Button
              $grow
              $active={selected.autoThreshold}
              onClick={() => seg.regrowSelected({ threshold: null, autoThreshold: true })}
              title="Estimate the threshold from the seed and the surrounding wall"
            >
              Auto
            </Button>
          </ButtonRow>
          <SliderRow>
            <Label $wide="4.4rem">Leak cut {selected.leakCut}</Label>
            <Slider
              type="range"
              min={0}
              max={4}
              value={selected.leakCut}
              onChange={(e) => seg.regrowSelected({ leakCut: Number(e.target.value) })}
              title="Cut thin bridges into neighbouring chambers (voxels)"
            />
          </SliderRow>
          <SliderRow>
            <Label $wide="4.4rem">Smooth {selected.smooth}</Label>
            <Slider
              type="range"
              min={0}
              max={3}
              value={selected.smooth}
              onChange={(e) => seg.regrowSelected({ smooth: Number(e.target.value) })}
              title="Speckle smoothing radius before growing (voxels)"
            />
          </SliderRow>
          <Button
            $grow
            onClick={seg.growAllFrames}
            disabled={Boolean(busy) || frameCount <= 1}
            title="Grow from the same seed on every frame to get volume over the cycle"
          >
            {busy ? `${busy.label} ${busy.i}/${busy.n}` : 'Grow all frames'}
          </Button>
        </>
      )}

      {selected && known.length >= 2 && (
        <Cycle>
          <Sparkline values={series} timeIndex={timeIndex} color={selected.color} />
          Max {edv.toFixed(1)} mL · Min {esv.toFixed(1)} mL
          <br />
          EF {(((edv - esv) / edv) * 100).toFixed(0)} % (if this is the LV)
        </Cycle>
      )}
    </>
  );
}
