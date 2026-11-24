import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { renderSliceToCanvas } from '../../utils/philipsVolume';
import { frameToPixel, sampleFrame, worldToFrame } from '../../utils/mvSlicer';
import { CUT_COLOR } from './drawMvOverlay';

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #fff;
  font-family: Arial, Helvetica, sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  background: #2e2e2e;
  border-bottom: 1px solid #4a4a4a;
  font-size: 0.78rem;
  flex-shrink: 0;
`;

const Title = styled.div`
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  strong {
    color: #4caf50;
    margin-right: 0.4rem;
  }
  span {
    color: #c8c8c8;
  }
`;

const HeaderButton = styled.button`
  background: ${(p) => (p.$active ? '#4caf50' : '#383838')};
  border: 1px solid ${(p) => (p.$active ? '#4caf50' : '#4a4a4a')};
  color: #fff;
  border-radius: 6px;
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;
  cursor: pointer;

  &:hover {
    background: ${(p) => (p.$active ? '#45a049' : '#4a4a4a')};
  }
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
`;

const Cells = styled.div`
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  background: #4a4a4a;
  grid-template-columns: ${(p) => (p.$single ? '1fr' : 'repeat(3, 1fr)')};
  grid-template-rows: ${(p) => (p.$single ? '1fr' : 'repeat(3, 1fr)')};
`;

const Cell = styled.div`
  position: relative;
  background: #000;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  cursor: zoom-in;
  ${(p) => (p.$single ? 'cursor: zoom-out;' : '')}

  canvas {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
`;

const CellLabel = styled.div`
  position: absolute;
  top: 5px;
  left: 6px;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  border: 1px solid ${CUT_COLOR};
  pointer-events: none;
`;

const Orient = styled.div`
  position: absolute;
  font-size: 0.62rem;
  color: #c8c8c8;
  pointer-events: none;
  text-shadow: 0 1px 2px #000;
  ${(p) => p.$pos}
`;

const Side = styled.div`
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  background: #212121;
  border-left: 1px solid #4a4a4a;
  font-size: 0.7rem;
  color: #c8c8c8;

  canvas {
    width: 100%;
    height: auto;
    display: block;
    background: #000;
    cursor: pointer;
  }
`;

const Note = styled.div`
  line-height: 1.4;
`;

const CELL_PX = 320;
const SINGLE_PX = 900;
const KEY_PX = 240;
const KEY_SLAB_MM = 10;

/** One cut, resampled for the current frame, with AoV and coaptation markers. */
function CutCanvas({ volume, timeIndex, cut, windowCenter, windowWidth, widthPx }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const mmPerPx = (cut.xMax - cut.xMin) / widthPx;
    const img = sampleFrame(volume, timeIndex, cut, mmPerPx);
    renderSliceToCanvas(canvas, img, windowCenter, windowWidth);
    const ctx = canvas.getContext('2d');
    const r = Math.max(4, img.width * 0.014);

    // Level of the picked points (the annular plane when they were picked there)
    const level = frameToPixel(cut, 0, 0, mmPerPx).py;
    ctx.strokeStyle = 'rgba(76, 175, 80, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, level);
    ctx.lineTo(img.width, level);
    ctx.stroke();
    ctx.setLineDash([]);

    // Coaptation target: small marker at the top edge
    const t = frameToPixel(cut, cut.target.x, cut.target.y, mmPerPx);
    ctx.fillStyle = CUT_COLOR;
    ctx.beginPath();
    ctx.moveTo(t.px, 2);
    ctx.lineTo(t.px - r, 2 + r * 1.4);
    ctx.lineTo(t.px + r, 2 + r * 1.4);
    ctx.closePath();
    ctx.fill();

    // AoV centre (dimmed when it is off this plane, in parallel mode)
    if (cut.ao.offPlaneMm < 10) {
      const a = frameToPixel(cut, cut.ao.x, cut.ao.y, mmPerPx);
      ctx.globalAlpha = cut.ao.offPlaneMm < 3 ? 1 : 0.45;
      ctx.strokeStyle = '#e57373';
      ctx.lineWidth = Math.max(1.5, r * 0.35);
      ctx.beginPath();
      ctx.moveTo(a.px - r, a.py);
      ctx.lineTo(a.px + r, a.py);
      ctx.moveTo(a.px, a.py - r);
      ctx.lineTo(a.px, a.py + r);
      ctx.stroke();
      ctx.font = `600 ${Math.round(r * 2.4)}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = '#e57373';
      ctx.fillText('Ao', a.px + r * 1.3, a.py - r * 0.6);
      ctx.globalAlpha = 1;
    }
  }, [volume, timeIndex, cut, windowCenter, windowWidth, widthPx]);
  return <canvas ref={ref} />;
}

/** En-face key map (valve-level slab MIP) with the numbered cut lines. */
function KeyMap({ volume, timeIndex, result, windowCenter, windowWidth, active, onPick }) {
  const ref = useRef(null);
  const geomRef = useRef(null);
  const { keyMap } = result;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const mmPerPx = (keyMap.xMax - keyMap.xMin) / KEY_PX;
    const img = sampleFrame(volume, timeIndex, keyMap, mmPerPx, { slabMm: KEY_SLAB_MM });
    renderSliceToCanvas(canvas, img, windowCenter, windowWidth);
    const ctx = canvas.getContext('2d');
    const px = (mm) => {
      const f = worldToFrame(keyMap, mm);
      const p = frameToPixel(keyMap, f.x, f.y, mmPerPx);
      return { x: p.px, y: p.py };
    };
    const ao = px(result.projected.ao);
    const segs = result.cuts.map((cut) => {
      const a = px(cut.segment[0]);
      const b = px(cut.segment[1]);
      const far = Math.hypot(a.x - ao.x, a.y - ao.y) > Math.hypot(b.x - ao.x, b.y - ao.y) ? a : b;
      return { a, b, far, index: cut.index };
    });
    geomRef.current = { segs, width: img.width, height: img.height };

    segs.forEach((s) => {
      const on = active === s.index;
      ctx.strokeStyle = on ? '#ffffff' : CUT_COLOR;
      ctx.lineWidth = on ? 2.2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
    });
    ctx.font = '600 10px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    segs.forEach((s) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(s.far.x, s.far.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = active === s.index ? '#4caf50' : '#ffffff';
      ctx.fillText(String(s.index), s.far.x, s.far.y + 0.5);
    });
    const label = (mm, text, color) => {
      const p = px(mm);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText(text, p.x + 6, p.y - 6);
    };
    label(result.projected.al, 'AL', '#ffb74d');
    label(result.projected.pm, 'PM', '#ffb74d');
    label(result.projected.ao, 'Ao', '#e57373');
  }, [volume, timeIndex, result, keyMap, windowCenter, windowWidth, active]);

  const onClick = (e) => {
    const g = geomRef.current;
    if (!g) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * g.width;
    const y = ((e.clientY - rect.top) / rect.height) * g.height;
    let best = null;
    let bestD = 12;
    g.segs.forEach((s) => {
      const vx = s.b.x - s.a.x;
      const vy = s.b.y - s.a.y;
      const l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - s.a.x) * vx + (y - s.a.y) * vy) / l2));
      const d = Math.hypot(x - (s.a.x + t * vx), y - (s.a.y + t * vy));
      if (d < bestD) {
        bestD = d;
        best = s.index;
      }
    });
    if (best) onPick(best);
  };

  return <canvas ref={ref} onClick={onClick} title="Click a line to open that cut" />;
}

export default function MvSlicerView({
  volume,
  timeIndex,
  frameCount,
  result,
  windowCenter,
  windowWidth,
  flipVertical,
  mirror,
  onFlip,
  onMirror,
  onClose,
}) {
  const [single, setSingle] = useState(null);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') setSingle(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const o = result.orientation;
  const cuts = single ? result.cuts.filter((c) => c.index === single) : result.cuts;
  const modeText = result.mode === 'parallel' ? 'Parallel cuts' : 'Fan through the AoV';

  return (
    <Overlay>
      <Header>
        <Title>
          <strong>MV slicer</strong>
          <span>
            {modeText} · {result.cuts.length} cuts · {result.spacingMm.toFixed(1)} mm apart on the
            coaptation line · T {timeIndex + 1}/{frameCount}
          </span>
        </Title>
        <HeaderButton type="button" $active={flipVertical} onClick={onFlip} title="Swap LA and LV (top/bottom)">
          Flip LA/LV
        </HeaderButton>
        <HeaderButton type="button" $active={mirror} onClick={onMirror} title="Put the aortic side on the left">
          Ao left
        </HeaderButton>
        <HeaderButton type="button" onClick={onClose} title="Back to the MPR views">
          Back to MPR
        </HeaderButton>
      </Header>
      <Body>
        <Cells $single={Boolean(single)}>
          {cuts.map((cut) => (
            <Cell
              key={cut.index}
              $single={Boolean(single)}
              onClick={() => setSingle(single ? null : cut.index)}
              title={single ? 'Back to all cuts' : 'Enlarge this cut'}
            >
              <CutCanvas
                volume={volume}
                timeIndex={timeIndex}
                cut={cut}
                windowCenter={windowCenter}
                windowWidth={windowWidth}
                widthPx={single ? SINGLE_PX : CELL_PX}
              />
              <CellLabel>
                {cut.index} · {cut.label}
              </CellLabel>
              <Orient $pos="top: 6px; left: 50%; transform: translateX(-50%);">{o.top}</Orient>
              <Orient $pos="bottom: 4px; left: 50%; transform: translateX(-50%);">{o.bottom}</Orient>
              <Orient $pos="top: 50%; left: 6px;">{o.left}</Orient>
              <Orient $pos="top: 50%; right: 6px;">{o.right}</Orient>
            </Cell>
          ))}
        </Cells>
        <Side>
          <div>Surgical view (valve level, {KEY_SLAB_MM} mm slab)</div>
          <KeyMap
            volume={volume}
            timeIndex={timeIndex}
            result={result}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            active={single}
            onPick={(index) => setSingle(index)}
          />
          <Note>
            Cuts 1 and 9 sit on the commissures; 2–3 cross A1/P1, 4–6 A2/P2, 7–8 A3/P3 (approximate
            Carpentier segments). The dashed line is the level the points were picked at; pick them
            with the en-face plane on the annulus, and leaflet tissue above the line towards the LA
            in systole suggests prolapse of that scallop.
          </Note>
          <Note>Click a cut to enlarge it. Space plays the cine; ← → step frames.</Note>
          {result.normalSource === 'points' && (
            <Note style={{ color: '#ffb74d' }}>
              The points were not picked in an en-face view, so the valve plane was taken from the
              commissures and the AoV. Re-pick in an en-face view for best results.
            </Note>
          )}
        </Side>
      </Body>
    </Overlay>
  );
}
