import React from 'react';
import styled from 'styled-components';
import { CLIP_DEVICES, PROLAPSE_MM, TEER_STEPS, teerCriteria } from '../../utils/valveAnalysis';
import { REFERENCES } from '../../utils/annulusFit';
import { DASH, cm2, mm, mmSigned } from '../../utils/format';
import { infoContext } from '../../utils/metricInfo';
import Tip from '../Tip';
import { AnnulusSection, CycleSection, OpenFrameNote, TentingSection } from './AnnulusPanel';
import { HEIGHT_RANGE, heightGradientCss } from './KeyMap';
import {
  Section,
  SectionHead,
  SmallButton,
  Row,
  Table,
  Bad,
  Good,
  Warn,
  Steps,
  SmallSelect,
  Note,
} from './panelStyles';

export { SmallButton };

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

const Val = styled.td`
  text-align: right;
  white-space: nowrap;
`;

const RTh = styled.th`
  text-align: right !important;
`;

const LEGEND_TICKS = [-4, 0, 2, 6, 10];

const refOf = (id) => REFERENCES.find((r) => r.id === id) || REFERENCES[0];

/** Height with prolapse (> +2 mm) in red. */
function Height({ v }) {
  return v != null && v > PROLAPSE_MM ? <Bad>{mmSigned(v)}</Bad> : mmSigned(v);
}

function ProlapseSection({ result, frame, showHeights, setShowHeights, ctx, closedNow, timeIndex }) {
  const { stats } = frame.map;
  const [lo, hi] = HEIGHT_RANGE;
  const isMv = result.kind === 'mv';
  return (
    <Section>
      <SectionHead>
        Prolapse map
        <SmallButton type="button" $active={showHeights} onClick={() => setShowHeights(!showHeights)}>
          {showHeights ? 'Colours on' : 'Colours off'}
        </SmallButton>
      </SectionHead>
      <Tip id="leafletHeight" ctx={ctx}>
        <Legend />
      </Tip>
      <LegendTicks>
        {LEGEND_TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - lo) / (hi - lo)) * 100}%` }}>
            {t > 0 ? `+${t}` : t < 0 ? `−${-t}` : t}
          </span>
        ))}
      </LegendTicks>
      <Note>
        Leaflet height above the {refOf(stats.reference).short}, in mm: + towards the {ctx.atrium}, − towards the{' '}
        {ctx.ventricle}. Prolapse: more than +{PROLAPSE_MM} mm in systole. Hover over the map for the height at a
        point.
      </Note>
      <OpenFrameNote closedNow={closedNow} timeIndex={timeIndex} />
      <Table>
        <tbody>
          <tr>
            <td>
              <Tip id="maxHeight" ctx={ctx}>
                Highest point
              </Tip>
            </td>
            <Val>
              <Height v={stats.maxHeight} />
              {stats.maxSegment ? ` · ${stats.maxSegment}` : ''}
            </Val>
          </tr>
          <tr>
            <td>
              <Tip id="prolapseArea" ctx={ctx}>
                Area above +{PROLAPSE_MM} mm
              </Tip>
            </td>
            <Val>{stats.prolapseAreaMm2 > 0 ? cm2(stats.prolapseAreaMm2) : 'none'}</Val>
          </tr>
          {isMv ? (
            <tr>
              <td>
                <Tip id="prolapseWidth" ctx={ctx}>
                  Prolapse width
                </Tip>
              </td>
              <Val>{stats.prolapseWidthMm > 0 ? mm(stats.prolapseWidthMm) : 'none'}</Val>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <Table>
        <thead>
          <tr>
            <th>Segment</th>
            <RTh>
              <Tip id="segmentMax" ctx={ctx}>
                Highest
              </Tip>
            </RTh>
            <RTh>
              <Tip id="segmentProlapseArea" ctx={ctx}>
                Area &gt; +{PROLAPSE_MM} mm
              </Tip>
            </RTh>
          </tr>
        </thead>
        <tbody>
          {result.segments.map((s) => {
            const st = stats.segments[s];
            const pro = st.maxHeight != null && st.maxHeight > PROLAPSE_MM;
            return (
              <tr key={s}>
                <td>{pro ? <Bad>{s}</Bad> : s}</td>
                <Val>
                  <Height v={st.maxHeight} />
                </Val>
                <Val>{st.prolapseAreaMm2 > 0 ? cm2(st.prolapseAreaMm2) : DASH}</Val>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

function CutsSection({ result, frame, onOpenCut, ctx }) {
  return (
    <Section>
      <SectionHead>Cuts</SectionHead>
      <Table>
        <thead>
          <tr>
            <th>#</th>
            <th>Cut</th>
            <RTh>
              <Tip id="cutMax" ctx={ctx}>
                Highest
              </Tip>
            </RTh>
            <RTh>
              <Tip id="cutGap" ctx={ctx}>
                Gap
              </Tip>
            </RTh>
            <RTh>
              <Tip id="cutDepth" ctx={ctx}>
                Depth
              </Tip>
            </RTh>
          </tr>
        </thead>
        <tbody>
          {result.cuts.map((cut, i) => {
            const p = frame.profiles[i];
            return (
              <tr key={cut.index} className="clickable" onClick={() => onOpenCut(cut.index)} title="Open this cut">
                <td>{cut.index}</td>
                <td>{cut.label}</td>
                <Val>
                  <Height v={p.maxHeight} />
                </Val>
                <Val>{p.gapMm > 0 ? <Warn>{mm(p.gapMm)}</Warn> : DASH}</Val>
                <Val>{p.tentingHeightMm > 0.5 ? mm(p.tentingHeightMm) : DASH}</Val>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Note>Highest: + above / − below the reference. Depth: coaptation depth below it. Click a row to open the cut.</Note>
    </Section>
  );
}

function ThresholdSection({ analysis }) {
  const { frame, thresholdOverride, setThresholdOverride } = analysis;
  const lv = frame.levels;
  const extra = lv
    ? `This frame: blood ≈ ${Math.round(lv.blood)}, tissue ≈ ${Math.round(lv.tissue)}, so Auto = ${Math.round(
        lv.threshold
      )}.${thresholdOverride != null ? ` You set ${Math.round(thresholdOverride)}.` : ''}`
    : null;
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
          aria-label="Tissue threshold (grey level)"
        />
        <Tip id="threshold" extra={extra}>
          {Math.round(frame.threshold)}
        </Tip>
      </Row>
      <Note>Grey level 0–255. Raise it if speckle in the atrium shows as tissue; lower it if thin leaflets are missed.</Note>
    </Section>
  );
}

const CRITERIA_TIPS = {
  'Coaptation length': 'crCoaptLength',
  'Coaptation depth': 'crCoaptDepth',
  'Tip-to-tip (flail) gap': 'crFlailGap',
  'Prolapse width (this frame)': 'crFlailWidth',
  'Posterior leaflet length': 'crPosteriorLength',
  'MVA (planimetry)': 'crMva',
};

function TeerSection({ result, frame, analysis, teer, clip, timeIndex, frameCount, onOpenCut, ctx }) {
  const cut = result.cuts.find((c) => c.index === teer.cutIndex) || result.cuts[0];
  const nextStep = TEER_STEPS.find((s) => !teer.points[s.key]);
  const orifice = analysis.cycle?.best;
  const criteria = teerCriteria({
    measures: teer.measures,
    flailWidthMm: frame.map.stats.prolapseWidthMm || null,
    mvaMm2: orifice ? orifice.areaMm2 : null,
  });
  const refShort = refOf(result.reference).short;
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
              <td>
                <Tip id="teerLeafletLength" ctx={ctx}>
                  {teer.measures.leaflets.left} leaflet
                </Tip>
              </td>
              <Val>{mm(teer.measures.lengthLMm)}</Val>
            </tr>
            <tr>
              <td>
                <Tip id="teerLeafletLength" ctx={ctx}>
                  {teer.measures.leaflets.right} leaflet
                </Tip>
              </td>
              <Val>{mm(teer.measures.lengthRMm)}</Val>
            </tr>
            <tr>
              <td>
                <Tip id="teerAnnulus" ctx={ctx}>
                  Annulus (this cut)
                </Tip>
              </td>
              <Val>{mm(teer.measures.annulusMm)}</Val>
            </tr>
          </tbody>
        </Table>
      ) : null}

      <Row>
        <SmallButton
          type="button"
          onClick={analysis.runCycle}
          disabled={Boolean(analysis.progress)}
          title="Planimetry of the orifice in every frame (with the rest of the cycle analysis)"
        >
          {analysis.progress
            ? `Analysing ${analysis.progress.done}/${analysis.progress.total}…`
            : analysis.cycle
              ? 'Recompute MVA'
              : 'Find MVA over the cycle'}
        </SmallButton>
      </Row>
      {analysis.cycle ? (
        orifice ? (
          <div>
            <Tip id="mva" ctx={ctx}>
              MVA
            </Tip>{' '}
            <strong>{cm2(orifice.areaMm2)}</strong> at T{analysis.cycle.bestFrame + 1}/{frameCount},{' '}
            <Tip id="mvaDepth" ctx={ctx}>
              {orifice.depthMm >= 0.5 ? `${mm(orifice.depthMm)} below the ${refShort}` : `at the ${refShort}`}
            </Tip>
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
          <Tip id="afterClip" ctx={ctx}>
            After clip
          </Tip>{' '}
          ≈ <strong>{cm2(clip.result.afterMm2)}</strong> ({cm2(clip.result.sideAMm2)} + {cm2(clip.result.sideBMm2)})
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
            <RTh>Value</RTh>
            <RTh>Ref.</RTh>
          </tr>
        </thead>
        <tbody>
          {criteria.map((r) => {
            const text = r.value == null ? DASH : r.unit === 'cm²' ? cm2(r.value * 100) : mm(r.value);
            return (
              <tr key={r.label}>
                <td>
                  <Tip id={CRITERIA_TIPS[r.label]} ctx={ctx}>
                    {r.label}
                  </Tip>
                </td>
                <Val>{r.value == null ? DASH : r.ok ? <Good>{text}</Good> : <Bad>{text}</Bad>}</Val>
                <Val>{r.rule}</Val>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Note>
        Coaptation, flail and MVA limits are the EVEREST anatomical criteria; posterior leaflet length ≥ 10 mm is a
        commonly used additional one. Prolapse width comes from the prolapse map of the current frame (use systole).
        For planning discussion only; confirm every value on the images.
      </Note>
    </Section>
  );
}

export default function SidePanel(props) {
  const { result, analysis, showHeights, setShowHeights, onOpenCut, annulus, timeIndex, frameCount, onSeek, rFrames } =
    props;
  const { frame } = analysis;
  if (!frame) return null;
  const ctx = infoContext(result, refOf(result.reference || 'picked').short);
  const closedNow = analysis.cycle ? Boolean(analysis.cycle.jumps.closed[timeIndex]) : null;
  return (
    <>
      <AnnulusSection result={result} annulus={annulus} ctx={ctx} />
      <ProlapseSection
        result={result}
        frame={frame}
        showHeights={showHeights}
        setShowHeights={setShowHeights}
        ctx={ctx}
        closedNow={closedNow}
        timeIndex={timeIndex}
      />
      <TentingSection
        result={result}
        frame={frame}
        onOpenCut={onOpenCut}
        ctx={ctx}
        closedNow={closedNow}
        timeIndex={timeIndex}
      />
      <CutsSection result={result} frame={frame} onOpenCut={onOpenCut} ctx={ctx} />
      <CycleSection
        analysis={analysis}
        timeIndex={timeIndex}
        frameCount={frameCount}
        onSeek={onSeek}
        rFrames={rFrames}
        ctx={ctx}
      />
      <ThresholdSection analysis={analysis} />
      {result.kind === 'mv' ? <TeerSection {...props} frame={frame} ctx={ctx} /> : null}
    </>
  );
}
