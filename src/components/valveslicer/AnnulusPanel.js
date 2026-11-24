import React, { useState } from 'react';
import styled from 'styled-components';
import { REFERENCES } from '../../utils/annulusFit';
import { PROLAPSE_MM } from '../../utils/valveAnalysis';
import { Bad, Good, Note, Row, Section, SectionHead, SmallButton, Table, Warn } from './panelStyles';

const mm = (v, d = 1) => (v == null ? '–' : `${v.toFixed(d)} mm`);
const cm2 = (v) => (v == null ? '–' : `${(v / 100).toFixed(2)} cm²`);
const ml = (v) => (v == null ? '–' : `${(v / 1000).toFixed(2)} mL`);

const Segmented = styled.div`
  display: flex;
  border: 1px solid #4a4a4a;
  border-radius: 5px;
  overflow: hidden;

  button {
    flex: 1;
    background: #383838;
    border: none;
    border-left: 1px solid #4a4a4a;
    color: #fff;
    font-size: 0.66rem;
    padding: 0.2rem 0.25rem;
    cursor: pointer;
  }
  button:first-child {
    border-left: none;
  }
  button.on {
    background: #4caf50;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/* ------------------------------------------------------------- Annulus -- */

export function AnnulusSection({ result, annulus }) {
  const { fit, tracing, cutsDone, frames } = annulus;
  const m = fit?.metrics;
  const isMv = result.kind === 'mv';
  const ahcwr = m?.ahcwrPercent;
  return (
    <Section>
      <SectionHead>
        3D annulus
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          {cutsDone}/{result.cuts.length} cuts
        </span>
      </SectionHead>
      <Note>
        Click the two annulus hinge points in each cut; the next cut opens by itself. Three cuts are enough for a
        fit, all {result.cuts.length} give the best saddle. Trace in one frame (mid-systole for the saddle shape).
      </Note>
      <Row>
        <SmallButton type="button" $active={tracing} onClick={tracing ? annulus.stop : () => annulus.start()}>
          {tracing ? `Tracing cut ${annulus.traceCut}… (stop)` : cutsDone ? 'Continue tracing' : 'Trace annulus'}
        </SmallButton>
        {tracing ? (
          <SmallButton type="button" onClick={annulus.skip} title="Leave this cut as it is and open the next one">
            Skip cut
          </SmallButton>
        ) : null}
        <SmallButton type="button" onClick={annulus.undo} disabled={!annulus.hingeCount}>
          Undo
        </SmallButton>
        <SmallButton type="button" onClick={annulus.clear} disabled={!annulus.hingeCount}>
          Clear
        </SmallButton>
      </Row>
      <div>Measure leaflet heights from</div>
      <Segmented role="group" aria-label="Height reference">
        {REFERENCES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={annulus.reference === r.id ? 'on' : ''}
            disabled={r.id !== 'picked' && !fit}
            onClick={() => annulus.setReference(r.id)}
            title={
              r.id === 'picked'
                ? 'The plane your four points were picked in'
                : r.id === 'plane'
                  ? 'Best-fit plane of the traced annulus'
                  : 'The traced 3D annulus, extended smoothly across the orifice'
            }
          >
            {r.label}
          </button>
        ))}
      </Segmented>
      {m ? (
        <>
          {frames.length > 1 ? (
            <Warn>
              Hinges come from frames T{Math.min(...frames) + 1}–T{Math.max(...frames) + 1}; the fit mixes phases.
            </Warn>
          ) : null}
          <Table>
            <tbody>
              <tr>
                <td>Area (3D)</td>
                <td>{cm2(m.area3dMm2)}</td>
              </tr>
              <tr>
                <td>Area (projected)</td>
                <td>{cm2(m.area2dMm2)}</td>
              </tr>
              <tr>
                <td>Perimeter</td>
                <td>{mm(m.perimeterMm)}</td>
              </tr>
              {isMv ? (
                <>
                  <tr>
                    <td>AP diameter</td>
                    <td>{mm(m.diameters.ap)}</td>
                  </tr>
                  <tr>
                    <td>Commissural diameter</td>
                    <td>{mm(m.diameters.cc)}</td>
                  </tr>
                </>
              ) : (
                <>
                  <tr>
                    <td>Max diameter</td>
                    <td>{mm(m.maxDiameterMm)}</td>
                  </tr>
                  <tr>
                    <td>Min diameter</td>
                    <td>{mm(m.minDiameterMm)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td>{isMv ? 'Saddle height' : 'Annulus height'}</td>
                <td>{mm(m.heightMm)}</td>
              </tr>
              {isMv ? (
                <tr>
                  <td title="Annulus height to commissural width ratio">AHCWR</td>
                  <td>
                    {ahcwr < 15 ? <Warn>{ahcwr.toFixed(0)}% (flat)</Warn> : <Good>{ahcwr.toFixed(0)}%</Good>}
                  </td>
                </tr>
              ) : null}
              {isMv ? (
                <tr>
                  <td>Aorto-mitral angle</td>
                  <td>{annulus.angle == null ? '–' : `${annulus.angle.toFixed(0)}°`}</td>
                </tr>
              ) : null}
            </tbody>
          </Table>
          {isMv ? (
            <Note>
              AHCWR below 15% means a flattened (“unsaddled”) annulus; normal annuli are roughly 15–25%.
            </Note>
          ) : null}
        </>
      ) : (
        <Note>{annulus.hingeCount ? 'Trace at least three cuts to fit the annulus.' : ''}</Note>
      )}
      {isMv ? (
        <>
          <Row>
            <SmallButton
              type="button"
              $active={annulus.aorticActive}
              onClick={annulus.aorticStart}
              title="Click the two aortic annulus hinges in the A2/P2 cut (or the enlarged cut)"
            >
              {annulus.aorticActive ? 'Clicking the aortic annulus…' : 'Aortic annulus (2 clicks)'}
            </SmallButton>
          </Row>
          {annulus.aorticNote ? <Note>{annulus.aorticNote}</Note> : null}
        </>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------- Tenting -- */

export function TentingSection({ result, frame, onOpenCut }) {
  const { stats } = frame.map;
  const ref = REFERENCES.find((r) => r.id === stats.reference) || REFERENCES[0];
  const isMv = result.kind === 'mv';
  let widest = null;
  frame.profiles.forEach((p, i) => {
    if (p.tentingAreaMm2 > 0 && (widest == null || p.tentingAreaMm2 > frame.profiles[widest].tentingAreaMm2)) {
      widest = i;
    }
  });
  const wp = widest != null ? frame.profiles[widest] : null;
  const wc = widest != null ? result.cuts[widest] : null;
  const segAt = stats.maxTentingAt ? result.segmentAt(stats.maxTentingAt) : null;
  const deepLimit = isMv ? 10 : 7.6;
  const areaLimit = isMv ? 250 : 163;
  return (
    <Section>
      <SectionHead>Tenting</SectionHead>
      <Note>
        Leaflet below the {ref.short}, towards the {isMv ? 'LV' : 'RV'}. Read it in mid-systole with the valve
        closed.
        {stats.reference === 'picked' ? ' Trace the 3D annulus for a true annular reference.' : ''}
      </Note>
      <Table>
        <tbody>
          <tr>
            <td>Max tenting height</td>
            <td>
              {stats.maxTentingMm > deepLimit ? <Bad>{mm(stats.maxTentingMm)}</Bad> : mm(stats.maxTentingMm)}
              {segAt ? ` in ${segAt}` : ''}
            </td>
          </tr>
          <tr>
            <td>Tenting volume</td>
            <td>{ml(stats.tentingVolumeMm3)}</td>
          </tr>
          {wp ? (
            <tr className="clickable" onClick={() => onOpenCut(wc.index)} title="Open this cut">
              <td>
                Tenting area (cut {wc.index} · {wc.label})
              </td>
              <td>
                {wp.tentingAreaMm2 > areaLimit ? <Bad>{cm2(wp.tentingAreaMm2)}</Bad> : cm2(wp.tentingAreaMm2)}
              </td>
            </tr>
          ) : null}
          {wp ? (
            <tr>
              <td>Coaptation depth (that cut)</td>
              <td>{mm(wp.tentingHeightMm)}</td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <Table>
        <thead>
          <tr>
            <th>Segment</th>
            <th>Max depth</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {result.segments.map((s) => {
            const st = stats.segments[s];
            return (
              <tr key={s}>
                <td>{s}</td>
                <td>{st.maxTentingMm > 0 ? mm(st.maxTentingMm) : '–'}</td>
                <td>{st.tentingVolumeMm3 > 0 ? ml(st.tentingVolumeMm3) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Note>
        {isMv
          ? 'Reported markers of recurrent functional MR after ring annuloplasty: coaptation depth ≥ 1 cm and tenting area ≥ 2.5 cm² (cut-offs vary between studies).'
          : 'Reported markers of residual functional TR after annuloplasty (Fukuda et al.): tethering distance > 0.76 cm and tethering area > 1.63 cm².'}
      </Note>
    </Section>
  );
}

/* --------------------------------------------------------------- Cycle -- */

const CHART_W = 256;
const CHART_H = 42;
const PAD = { l: 3, r: 3, t: 7, b: 4 };
const LINE = '#4fc3f7';
const MUTED = '#757575';

const ChartHead = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 0.3rem;
  font-size: 0.66rem;
  color: #c8c8c8;
  margin-top: 0.15rem;

  span.value {
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
`;

const ChartSvg = styled.svg`
  width: 100%;
  height: auto;
  display: block;
  background: #181818;
  border-radius: 3px;
  cursor: pointer;
  touch-action: none;
`;

const METRICS = [
  {
    key: 'maxHeightMm',
    label: 'Highest leaflet point',
    format: (v) => mm(v),
    refLine: PROLAPSE_MM,
    refLabel: `${PROLAPSE_MM} mm`,
  },
  { key: 'gapMm', label: 'Widest coaptation gap', format: (v) => (v > 0 ? mm(v) : 'none') },
  { key: 'tentingVolumeMm3', label: 'Tenting volume', format: (v) => ml(v), scale: 1 / 1000 },
  { key: 'orificeMm2', label: 'Orifice area', format: (v) => (v == null ? 'closed' : cm2(v)), scale: 1 / 100 },
];

function Sparkline({ metric, frames, closed, timeIndex, hover, setHover, onSeek, rFrames }) {
  const n = frames.length;
  const k = metric.scale || 1;
  const values = frames.map((f) => (f[metric.key] == null ? null : f[metric.key] * k));
  const finite = values.filter((v) => v != null);
  const refV = metric.refLine != null ? metric.refLine : null;
  let lo = Math.min(0, ...finite, refV ?? 0);
  let hi = Math.max(...finite, refV ?? 0);
  if (!(hi > lo)) hi = lo + 1;
  const span = hi - lo;
  lo -= span * 0.05;
  hi += span * 0.08;
  const x = (t) => PAD.l + (n > 1 ? (t / (n - 1)) * (CHART_W - PAD.l - PAD.r) : (CHART_W - PAD.l - PAD.r) / 2);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (CHART_H - PAD.t - PAD.b);

  // Line broken where the metric does not apply (e.g. a closed valve has no orifice)
  const runs = [];
  let cur = [];
  values.forEach((v, t) => {
    if (v == null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(`${x(t).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur);

  const tAt = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * CHART_W;
    return Math.max(0, Math.min(n - 1, Math.round(((sx - PAD.l) / (CHART_W - PAD.l - PAD.r)) * (n - 1))));
  };
  const shown = hover ?? timeIndex;
  const shownV = values[shown];

  return (
    <div>
      <ChartHead>
        <span>{metric.label}</span>
        <span>
          T{shown + 1} <span className="value">{metric.format(frames[shown]?.[metric.key])}</span>
        </span>
      </ChartHead>
      <ChartSvg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`${metric.label} per frame`}
        onPointerMove={(e) => setHover(tAt(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSeek(tAt(e))}
      >
        {closed.map((c, t) =>
          c ? (
            <rect
              key={`c${t}`}
              x={Math.max(0, x(t - 0.5))}
              width={Math.min(CHART_W, x(t + 0.5)) - Math.max(0, x(t - 0.5))}
              y={0}
              height={CHART_H}
              fill="#26332a"
            />
          ) : null
        )}
        {rFrames.map((t) => (
          <g key={`r${t}`}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={CHART_H} stroke="#e07a5f" strokeOpacity="0.45" strokeWidth="1" />
            <text x={x(t) + 2} y={6} fontSize="6" fill="#e07a5f">
              R
            </text>
          </g>
        ))}
        {refV != null ? (
          <>
            <line
              x1={PAD.l}
              x2={CHART_W - PAD.r}
              y1={y(refV)}
              y2={y(refV)}
              stroke={MUTED}
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text x={CHART_W - PAD.r - 1} y={y(refV) - 1.5} fontSize="6" fill={MUTED} textAnchor="end">
              {metric.refLabel}
            </text>
          </>
        ) : null}
        <line x1={x(timeIndex)} x2={x(timeIndex)} y1={0} y2={CHART_H} stroke="#ffb74d" strokeWidth="1" />
        {runs.map((r, i) =>
          r.length > 1 ? (
            <polyline
              key={i}
              points={r.join(' ')}
              fill="none"
              stroke={LINE}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <circle key={i} cx={r[0].split(',')[0]} cy={r[0].split(',')[1]} r="1.6" fill={LINE} />
          )
        )}
        {hover != null ? (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={CHART_H} stroke="#e0e0e0" strokeDasharray="2 2" />
        ) : null}
        {shownV != null ? (
          <circle cx={x(shown)} cy={y(shownV)} r="3.5" fill={LINE} stroke="#181818" strokeWidth="1.5" />
        ) : null}
      </ChartSvg>
    </div>
  );
}

export function CycleSection({ analysis, timeIndex, frameCount, onSeek, rFrames }) {
  const [hover, setHover] = useState(null);
  const { cycle, progress } = analysis;
  const jumps = cycle?.jumps;
  const jump = (label, t, title) => (
    <SmallButton type="button" disabled={t == null} onClick={() => onSeek(t)} title={title}>
      {label}
      {t != null ? ` · T${t + 1}` : ''}
    </SmallButton>
  );
  return (
    <Section>
      <SectionHead>
        Over the cycle
        <SmallButton type="button" onClick={analysis.runCycle} disabled={Boolean(progress)}>
          {progress ? `Analysing ${progress.done}/${progress.total}…` : cycle ? 'Re-analyse' : 'Analyse the cycle'}
        </SmallButton>
      </SectionHead>
      {!cycle && !progress ? (
        <Note>
          Measures every frame with the current points, threshold and height reference, then charts them so you can
          jump to the worst frame.
        </Note>
      ) : null}
      {cycle ? (
        <>
          {METRICS.map((m) => (
            <Sparkline
              key={m.key}
              metric={m}
              frames={cycle.frames}
              closed={jumps.closed}
              timeIndex={Math.min(timeIndex, frameCount - 1)}
              hover={hover}
              setHover={setHover}
              onSeek={onSeek}
              rFrames={rFrames}
            />
          ))}
          <Row>
            {jump('Worst prolapse', jumps.maxProlapse, 'Frame with the highest leaflet point')}
            {jump('Widest gap', jumps.widestGap, 'Frame with the widest coaptation gap')}
            {jump('Most tenting', jumps.maxTenting, 'Frame with the largest tenting volume')}
            {jump('Largest orifice', jumps.largestOrifice, 'Frame with the largest orifice (diastole)')}
            {rFrames.length ? jump('R wave', rFrames[0], 'End-diastole on the ECG') : null}
          </Row>
          <Note>
            Click a chart to go to that frame. Orange line: the current frame. Shaded: frames where the leaflets cover
            the valve (closed, systole); the prolapse, gap and tenting jumps only look there, the orifice only in the
            open frames.{rFrames.length ? ' R: R waves of the ECG (end-diastole).' : ''} The points and the annulus are
            fixed; they do not follow the valve through the cycle.
          </Note>
          {jumps.maxProlapse != null && cycle.frames[jumps.maxProlapse].maxHeightMm > PROLAPSE_MM ? (
            <div>
              Worst prolapse <Bad>{mm(cycle.frames[jumps.maxProlapse].maxHeightMm)}</Bad>
              {cycle.frames[jumps.maxProlapse].maxSegment ? ` in ${cycle.frames[jumps.maxProlapse].maxSegment}` : ''}{' '}
              at T{jumps.maxProlapse + 1}
            </div>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
