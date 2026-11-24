import React from 'react';
import styled from 'styled-components';
import { CLIP_DEVICES, PROLAPSE_MM, TEER_STEPS, teerCriteria } from '../../utils/valveAnalysis';
import { HEIGHT_RANGE, heightGradientCss } from './KeyMap';

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-top: 0.45rem;
  border-top: 1px solid #383838;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #9e9e9e;
  font-weight: 600;
`;

export const SmallButton = styled.button`
  background: ${(p) => (p.$active ? '#4caf50' : '#383838')};
  border: 1px solid ${(p) => (p.$active ? '#4caf50' : '#4a4a4a')};
  color: #fff;
  border-radius: 5px;
  padding: 0.18rem 0.45rem;
  font-size: 0.7rem;
  cursor: pointer;

  &:hover {
    background: ${(p) => (p.$active ? '#45a049' : '#4a4a4a')};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
`;

const Legend = styled.div`
  height: 8px;
  border-radius: 3px;
  background: ${heightGradientCss()};
`;

const LegendTicks = styled.div`
  position: relative;
  height: 0.8rem;
  font-size: 0.6rem;
  color: #9e9e9e;

  span {
    position: absolute;
    transform: translateX(-50%);
  }
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;

  th {
    text-align: left;
    color: #9e9e9e;
    font-weight: 600;
    padding: 0.1rem 0.2rem;
  }
  td {
    padding: 0.1rem 0.2rem;
    border-top: 1px solid #2e2e2e;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover td {
    background: #2e2e2e;
  }
`;

const Bad = styled.span`
  color: #ff6e6e;
  font-weight: 600;
`;
const Good = styled.span`
  color: #81c784;
`;
const Warn = styled.span`
  color: #ffb74d;
`;

const Steps = styled.ol`
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.68rem;
  line-height: 1.45;

  li.done {
    color: #81c784;
  }
  li.current {
    color: #fff;
    font-weight: 600;
  }
`;

const SmallSelect = styled.select`
  background: #383838;
  border: 1px solid #4a4a4a;
  color: #fff;
  border-radius: 5px;
  padding: 0.15rem 0.3rem;
  font-size: 0.7rem;
  max-width: 100%;
`;

const Note = styled.div`
  font-size: 0.64rem;
  line-height: 1.4;
  color: #9e9e9e;
`;

const mm = (v, d = 1) => (v == null ? '–' : `${v.toFixed(d)} mm`);
const LEGEND_TICKS = [-4, 0, 2, 6, 10];

function ProlapseSection({ result, frame, showHeights, setShowHeights }) {
  const { stats } = frame.map;
  const [lo, hi] = HEIGHT_RANGE;
  return (
    <Section>
      <SectionHead>
        Prolapse map
        <SmallButton type="button" $active={showHeights} onClick={() => setShowHeights(!showHeights)}>
          {showHeights ? 'Colours on' : 'Colours off'}
        </SmallButton>
      </SectionHead>
      <Legend />
      <LegendTicks>
        {LEGEND_TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - lo) / (hi - lo)) * 100}%` }}>
            {t > 0 ? `+${t}` : t}
          </span>
        ))}
      </LegendTicks>
      <Note>
        Leaflet height above the plane of your points, in mm (towards the{' '}
        {result.kind === 'tv' ? 'RA' : 'LA'} is positive). Prolapse: &gt; {PROLAPSE_MM} mm.
      </Note>
      <div>
        Max{' '}
        {stats.maxHeight != null && stats.maxHeight > PROLAPSE_MM ? (
          <Bad>{mm(stats.maxHeight)}</Bad>
        ) : (
          mm(stats.maxHeight)
        )}{' '}
        {stats.maxSegment ? `in ${stats.maxSegment}` : ''}
        {stats.prolapseAreaMm2 > 0 ? ` · ${stats.prolapseAreaMm2.toFixed(0)} mm² above ${PROLAPSE_MM} mm` : ''}
        {result.kind === 'mv' && stats.prolapseWidthMm > 0
          ? ` · ${mm(stats.prolapseWidthMm)} wide along the coaptation line`
          : ''}
      </div>
      <Table>
        <thead>
          <tr>
            <th>Segment</th>
            <th>Max</th>
            <th>Area &gt; {PROLAPSE_MM} mm</th>
          </tr>
        </thead>
        <tbody>
          {result.segments.map((s) => {
            const st = stats.segments[s];
            const pro = st.maxHeight != null && st.maxHeight > PROLAPSE_MM;
            return (
              <tr key={s}>
                <td>{pro ? <Bad>{s}</Bad> : s}</td>
                <td>{pro ? <Bad>{mm(st.maxHeight)}</Bad> : mm(st.maxHeight)}</td>
                <td>{st.prolapseAreaMm2 > 0 ? `${st.prolapseAreaMm2.toFixed(0)} mm²` : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

function CutsSection({ result, frame, onOpenCut }) {
  return (
    <Section>
      <SectionHead>Cuts</SectionHead>
      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Cut</th>
            <th>Max</th>
            <th>Gap</th>
          </tr>
        </thead>
        <tbody>
          {result.cuts.map((cut, i) => {
            const p = frame.profiles[i];
            const pro = p.maxHeight != null && p.maxHeight > PROLAPSE_MM;
            return (
              <tr key={cut.index} className="clickable" onClick={() => onOpenCut(cut.index)}>
                <td>{cut.index}</td>
                <td>{cut.label}</td>
                <td>{pro ? <Bad>{mm(p.maxHeight)}</Bad> : mm(p.maxHeight)}</td>
                <td>{p.gapMm > 0 ? <Warn>{mm(p.gapMm)}</Warn> : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

function ThresholdSection({ analysis }) {
  const { frame, thresholdOverride, setThresholdOverride } = analysis;
  return (
    <Section>
      <SectionHead>
        Tissue threshold
        <SmallButton
          type="button"
          $active={thresholdOverride == null}
          onClick={() => setThresholdOverride(null)}
          title="Halfway between blood and leaflet tissue, per frame"
        >
          Auto
        </SmallButton>
      </SectionHead>
      <Row>
        <input
          type="range"
          min={1}
          max={254}
          value={Math.round(frame.threshold)}
          onChange={(e) => setThresholdOverride(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#4caf50' }}
        />
        <span>{Math.round(frame.threshold)}</span>
      </Row>
      <Note>Raise it if speckle in the atrium shows as tissue; lower it if thin leaflets are missed.</Note>
    </Section>
  );
}

function TeerSection({ result, frame, analysis, teer, clip, timeIndex, frameCount, onOpenCut }) {
  const cut = result.cuts.find((c) => c.index === teer.cutIndex) || result.cuts[0];
  const nextStep = TEER_STEPS.find((s) => !teer.points[s.key]);
  const orifice = analysis.cycle?.best;
  const criteria = teerCriteria({
    measures: teer.measures,
    flailWidthMm: frame.map.stats.prolapseWidthMm || null,
    mvaMm2: orifice ? orifice.areaMm2 : null,
  });
  return (
    <Section>
      <SectionHead>TEER planning</SectionHead>
      <Row>
        <span>Cut</span>
        <SmallSelect value={teer.cutIndex} onChange={(e) => teer.setCutIndex(Number(e.target.value))}>
          {result.cuts.map((c) => (
            <option key={c.index} value={c.index}>
              {c.index} · {c.label}
            </option>
          ))}
        </SmallSelect>
        <SmallButton
          type="button"
          $active={teer.active}
          onClick={() => {
            teer.start();
            onOpenCut(teer.cutIndex);
          }}
          title="Open the cut and click the points in order"
        >
          {teer.active ? 'Measuring…' : 'Measure'}
        </SmallButton>
      </Row>
      <Steps>
        {TEER_STEPS.map((s) => (
          <li
            key={s.key}
            className={teer.points[s.key] ? 'done' : teer.active && nextStep?.key === s.key ? 'current' : ''}
          >
            {s.label(cut)}
          </li>
        ))}
      </Steps>
      <Row>
        <SmallButton type="button" onClick={teer.undo} disabled={!Object.keys(teer.points).length}>
          Undo
        </SmallButton>
        <SmallButton type="button" onClick={teer.clear} disabled={!Object.keys(teer.points).length}>
          Clear
        </SmallButton>
      </Row>
      {teer.measures && Object.keys(teer.points).length > 1 ? (
        <Table>
          <tbody>
            <tr>
              <td>{teer.measures.leaflets.left} leaflet</td>
              <td>{mm(teer.measures.lengthLMm)}</td>
            </tr>
            <tr>
              <td>{teer.measures.leaflets.right} leaflet</td>
              <td>{mm(teer.measures.lengthRMm)}</td>
            </tr>
            <tr>
              <td>Annulus (this cut)</td>
              <td>{mm(teer.measures.annulusMm)}</td>
            </tr>
          </tbody>
        </Table>
      ) : null}

      <Row>
        <SmallButton type="button" onClick={analysis.runMva} title="Planimetry of the orifice in every frame">
          {analysis.cycle ? 'Recompute MVA' : 'Find MVA over the cycle'}
        </SmallButton>
      </Row>
      {analysis.cycle ? (
        orifice ? (
          <div>
            MVA <strong>{(orifice.areaMm2 / 100).toFixed(2)} cm²</strong> at T{analysis.cycle.bestFrame + 1}/
            {frameCount}, {orifice.depthMm.toFixed(1)} mm below the valve plane
            {analysis.cycle.bestFrame !== timeIndex ? ' (go to that frame to see it)' : ''}
          </div>
        ) : (
          <Warn>No enclosed orifice found. Check the threshold or the points.</Warn>
        )
      ) : null}

      <Row>
        <span>Clip</span>
        <SmallSelect value={clip.device} onChange={(e) => clip.setDevice(Number(e.target.value))}>
          {CLIP_DEVICES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </SmallSelect>
        <span>at cut</span>
        <SmallSelect value={clip.cutIndex} onChange={(e) => clip.setCutIndex(Number(e.target.value))}>
          {result.cuts.map((c) => (
            <option key={c.index} value={c.index}>
              {c.index}
            </option>
          ))}
        </SmallSelect>
      </Row>
      {clip.result ? (
        <div>
          After clip ≈ <strong>{(clip.result.afterMm2 / 100).toFixed(2)} cm²</strong> (
          {(clip.result.sideAMm2 / 100).toFixed(2)} + {(clip.result.sideBMm2 / 100).toFixed(2)})
          <Note>
            Rough geometric estimate: closes a {clip.result.bandMm} mm band across the orifice (device width plus
            2 mm of approximated tissue each side). Not a validated predictor.
          </Note>
        </div>
      ) : (
        <Note>Find the MVA first to estimate the orifice after a clip.</Note>
      )}

      <Table>
        <thead>
          <tr>
            <th>Criterion</th>
            <th>Value</th>
            <th>Ref.</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>
                {r.value == null ? (
                  '–'
                ) : r.ok ? (
                  <Good>
                    {r.value.toFixed(r.unit === 'cm²' ? 2 : 1)} {r.unit}
                  </Good>
                ) : (
                  <Bad>
                    {r.value.toFixed(r.unit === 'cm²' ? 2 : 1)} {r.unit}
                  </Bad>
                )}
              </td>
              <td>{r.rule}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Note>
        Reference values are the EVEREST anatomical criteria. Prolapse width is measured along the coaptation line
        from the prolapse map of the current frame (use systole). For planning discussion only; confirm every value
        on the images.
      </Note>
    </Section>
  );
}

export default function SidePanel(props) {
  const { result, analysis, showHeights, setShowHeights, onOpenCut } = props;
  const { frame } = analysis;
  if (!frame) return null;
  return (
    <>
      <ProlapseSection result={result} frame={frame} showHeights={showHeights} setShowHeights={setShowHeights} />
      <CutsSection result={result} frame={frame} onOpenCut={onOpenCut} />
      <ThresholdSection analysis={analysis} />
      {result.kind === 'mv' ? <TeerSection {...props} frame={frame} /> : null}
    </>
  );
}
