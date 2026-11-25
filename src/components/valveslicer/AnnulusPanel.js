import React, { useState } from 'react';
import styled from 'styled-components';
import { REFERENCES } from '../../utils/annulusFit';
import { PROLAPSE_MM } from '../../utils/valveAnalysis';
import { DASH, cm2, deg, ml, mm, mmSigned, pct } from '../../utils/format';
import Tip from '../Tip';
import { Bad, Good, Note, Row, Section, SectionHead, SmallButton, Table, Warn } from './panelStyles';

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

/** Value cell: right-aligned, never wrapping inside a number. */
const Val = styled.td`
  text-align: right;
  white-space: nowrap;
`;

/** A table row: explained label on the left, value on the right. */
function MetricRow({ id, ctx, label, children, extra, ...rest }) {
  return (
    <tr {...rest}>
      <td>
        <Tip id={id} ctx={ctx} extra={extra}>
          {label}
        </Tip>
      </td>
      <Val>{children}</Val>
    </tr>
  );
}

/**
 * Bounds outside which an annulus fit is almost certainly a tracing error
 * (not clinical cut-offs): hinges clicked off the annulus, or in mixed views.
 */
const PLAUSIBLE = {
  areaMm2: [300, 2500],
  heightMm: 20,
  ahcwrPercent: 50,
};

function implausible(m) {
  const out = [];
  if (m.area3dMm2 < PLAUSIBLE.areaMm2[0] || m.area3dMm2 > PLAUSIBLE.areaMm2[1]) out.push(`area ${cm2(m.area3dMm2)}`);
  if (m.heightMm > PLAUSIBLE.heightMm) out.push(`height ${mm(m.heightMm)}`);
  if (m.ahcwrPercent > PLAUSIBLE.ahcwrPercent) out.push(`AHCWR ${pct(m.ahcwrPercent)}`);
  return out;
}

/* ------------------------------------------------------------- Annulus -- */

export function AnnulusSection({ result, annulus, ctx }) {
  const { fit, tracing, cutsDone, frames } = annulus;
  const m = fit?.metrics;
  const isMv = result.kind === 'mv';
  const ahcwr = m?.ahcwrPercent;
  const odd = m ? implausible(m) : [];
  return (
    <Section>
      <SectionHead>
        3D annulus
        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
          <Tip id="cutsTraced" ctx={ctx}>
            {cutsDone}/{result.cuts.length} cuts
          </Tip>
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
          {odd.length ? (
            <Warn>
              Unusual for an adult annulus ({odd.join(', ')}). Check that the hinge points sit on the annulus in every
              cut.
            </Warn>
          ) : null}
          <Table>
            <tbody>
              <MetricRow id="annulusArea3d" ctx={ctx} label="Area (3D)">
                {cm2(m.area3dMm2)}
              </MetricRow>
              <MetricRow id="annulusArea2d" ctx={ctx} label="Area (projected)">
                {cm2(m.area2dMm2)}
              </MetricRow>
              <MetricRow id="annulusPerimeter" ctx={ctx} label="Perimeter">
                {mm(m.perimeterMm)}
              </MetricRow>
              {isMv ? (
                <>
                  <MetricRow id="apDiameter" ctx={ctx} label="AP diameter">
                    {mm(m.diameters.ap)}
                  </MetricRow>
                  <MetricRow id="ccDiameter" ctx={ctx} label="Commissural diameter">
                    {mm(m.diameters.cc)}
                  </MetricRow>
                </>
              ) : (
                <>
                  <MetricRow id="maxDiameter" ctx={ctx} label="Max diameter">
                    {mm(m.maxDiameterMm)}
                  </MetricRow>
                  <MetricRow id="minDiameter" ctx={ctx} label="Min diameter">
                    {mm(m.minDiameterMm)}
                  </MetricRow>
                </>
              )}
              <MetricRow id="saddleHeight" ctx={ctx} label={isMv ? 'Saddle height' : 'Annulus height'}>
                {mm(m.heightMm)}
              </MetricRow>
              {isMv ? (
                <MetricRow id="ahcwr" ctx={ctx} label="AHCWR">
                  {ahcwr < 15 ? <Warn>{pct(ahcwr)} (flat)</Warn> : <Good>{pct(ahcwr)}</Good>}
                </MetricRow>
              ) : null}
              {isMv ? (
                <MetricRow
                  id="aortoMitralAngle"
                  ctx={ctx}
                  label="Aorto-mitral angle"
                  extra={annulus.angle == null ? 'Click “Aortic annulus (2 clicks)” below to measure it.' : null}
                >
                  {deg(annulus.angle)}
                </MetricRow>
              ) : null}
            </tbody>
          </Table>
          <Note>Hover over a name for what it measures and its normal range.</Note>
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

/* ---------------------------------------------------- Open-frame notice -- */

/** Warning shown on systolic measures when the cycle analysis classed this frame as open. */
export function OpenFrameNote({ closedNow, timeIndex }) {
  if (closedNow !== false) return null;
  return (
    <Warn>
      T{timeIndex + 1} is an open frame (diastole): these are not systolic values. Use the jump buttons under “Over the
      cycle”.
    </Warn>
  );
}

/* ------------------------------------------------------------- Tenting -- */

/** MV: the A2/P2 cut in the middle; TV: none (every cut is looked at). */
export function centralCutIndex(result) {
  if (result.kind !== 'mv' || !result.cuts.length) return null;
  return Math.floor((result.cuts.length - 1) / 2);
}

const LIMITS = {
  mv: { depthMm: 11, areaMm2: 250 },
  tv: { depthMm: 7.6, areaMm2: 163 },
};

export function TentingSection({ result, frame, onOpenCut, ctx, closedNow, timeIndex }) {
  const { stats } = frame.map;
  const ref = REFERENCES.find((r) => r.id === stats.reference) || REFERENCES[0];
  const isMv = result.kind === 'mv';
  const lim = LIMITS[isMv ? 'mv' : 'tv'];
  const { profiles } = frame;

  // The cut the clinical tenting numbers are read in: MV the A2/P2 cut; TV the
  // cut where the leaflets meet deepest.
  let main = centralCutIndex(result);
  if (main == null) {
    profiles.forEach((p, i) => {
      if (p.tentingHeightMm != null && (main == null || p.tentingHeightMm > profiles[main].tentingHeightMm)) main = i;
    });
  }
  let widest = null;
  profiles.forEach((p, i) => {
    if (p.tentingAreaMm2 > 0 && (widest == null || p.tentingAreaMm2 > profiles[widest].tentingAreaMm2)) widest = i;
  });
  const mp = main != null ? profiles[main] : null;
  const mc = main != null ? result.cuts[main] : null;
  const cutName = mc ? (isMv ? mc.label : `cut ${mc.index}`) : '';
  const c = {
    ...ctx,
    centralCut: mc ? `cut ${mc.index} (${mc.label})${isMv ? '' : ', the cut where the leaflets meet deepest'}` : null,
  };
  const segAt = stats.maxTentingAt ? result.segmentAt(stats.maxTentingAt) : null;

  const depth = mp?.tentingHeightMm;
  const depthText =
    mp == null
      ? DASH
      : mp.gapMm > 0
        ? `${DASH} (gap)`
        : depth == null
          ? `${DASH} (not found)`
          : mm(depth);
  return (
    <Section>
      <SectionHead>Tenting</SectionHead>
      <Note>
        Leaflet below the {ref.short}, towards the {isMv ? 'LV' : 'RV'}. Read it in mid-systole with the valve
        closed.
        {stats.reference === 'picked' ? ' Trace the 3D annulus for a true annular reference.' : ''}
      </Note>
      <OpenFrameNote closedNow={closedNow} timeIndex={timeIndex} />
      <Table>
        <tbody>
          <MetricRow
            id="coaptationDepth"
            ctx={c}
            label={`Coaptation depth${cutName ? ` · ${cutName}` : ''}`}
            className={mc ? 'clickable' : undefined}
            onClick={mc ? () => onOpenCut(mc.index) : undefined}
          >
            {depth != null && depth > lim.depthMm ? <Bad>{depthText}</Bad> : depthText}
          </MetricRow>
          <MetricRow
            id="tentingArea"
            ctx={c}
            label={`Tenting area${cutName ? ` · ${cutName}` : ''}`}
            className={mc ? 'clickable' : undefined}
            onClick={mc ? () => onOpenCut(mc.index) : undefined}
          >
            {mp == null
              ? DASH
              : mp.tentingAreaMm2 > lim.areaMm2
                ? <Bad>{cm2(mp.tentingAreaMm2)}</Bad>
                : cm2(mp.tentingAreaMm2)}
          </MetricRow>
          {widest != null && widest !== main ? (
            <MetricRow
              id="tentingAreaMax"
              ctx={c}
              label={`Largest tenting area · cut ${result.cuts[widest].index}`}
              className="clickable"
              onClick={() => onOpenCut(result.cuts[widest].index)}
            >
              {cm2(profiles[widest].tentingAreaMm2)}
            </MetricRow>
          ) : null}
          <MetricRow id="tentingVolume" ctx={c} label="Tenting volume">
            {ml(stats.tentingVolumeMm3)}
          </MetricRow>
          <MetricRow id="deepestPoint" ctx={c} label="Deepest leaflet point">
            {stats.maxTentingMm > 0 ? `${mm(stats.maxTentingMm)}${segAt ? ` · ${segAt}` : ''}` : 'none below'}
          </MetricRow>
        </tbody>
      </Table>
      <Table>
        <thead>
          <tr>
            <th>Segment</th>
            <th style={{ textAlign: 'right' }}>
              <Tip id="segmentDepth" ctx={c}>
                Deepest
              </Tip>
            </th>
            <th style={{ textAlign: 'right' }}>
              <Tip id="segmentVolume" ctx={c}>
                Volume
              </Tip>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.segments.map((s) => {
            const st = stats.segments[s];
            return (
              <tr key={s}>
                <td>{s}</td>
                <Val>{st.maxTentingMm > 0 ? mm(st.maxTentingMm) : DASH}</Val>
                <Val>{st.tentingVolumeMm3 > 0 ? ml(st.tentingVolumeMm3) : DASH}</Val>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Note>
        Depths are distances below the {ref.short}, so they are positive. Red: above the reference cut-off (
        {isMv ? 'coaptation depth > 11 mm, tenting area > 2.5 cm²' : 'tethering distance > 7.6 mm, area > 1.63 cm²'});
        hover over a name for the source.
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
    tip: 'chartHighest',
    label: 'Highest leaflet point',
    format: (v) => mmSigned(v),
    refLine: PROLAPSE_MM,
    refLabel: `+${PROLAPSE_MM} mm`,
  },
  { key: 'gapMm', tip: 'chartGap', label: 'Widest coaptation gap', format: (v) => (v > 0 ? mm(v) : 'none') },
  { key: 'tentingVolumeMm3', tip: 'chartTenting', label: 'Tenting volume', format: (v) => ml(v), scale: 1 / 1000 },
  {
    key: 'orificeMm2',
    tip: 'chartOrifice',
    label: 'Orifice area',
    format: (v) => (v == null ? 'closed' : cm2(v)),
    scale: 1 / 100,
  },
];

function Sparkline({ metric, frames, closed, timeIndex, hover, setHover, onSeek, rFrames, ctx }) {
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
        <Tip id={metric.tip} ctx={ctx}>
          {metric.label}
        </Tip>
        <span>
          T{shown + 1} <span className="value">{metric.format(frames[shown]?.[metric.key])}</span>
          {closed[shown] ? '' : ' · open'}
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

export function CycleSection({ analysis, timeIndex, frameCount, onSeek, rFrames, ctx }) {
  const [hover, setHover] = useState(null);
  const { cycle, progress } = analysis;
  const jumps = cycle?.jumps;
  const jump = (label, t, title) => (
    <SmallButton type="button" disabled={t == null} onClick={() => onSeek(t)} title={title}>
      {label}
      {t != null ? ` · T${t + 1}` : ''}
    </SmallButton>
  );
  const worst = jumps?.maxProlapse != null ? cycle.frames[jumps.maxProlapse] : null;
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
              ctx={ctx}
            />
          ))}
          <Row>
            {jump('Worst prolapse', jumps.maxProlapse, 'Closed frame with the highest leaflet point')}
            {jump('Widest gap', jumps.widestGap, 'Closed frame with the widest coaptation gap')}
            {jump('Most tenting', jumps.maxTenting, 'Closed frame with the largest tenting volume')}
            {jump('Largest orifice', jumps.largestOrifice, 'Open frame with the largest orifice (diastole)')}
            {rFrames.length ? jump('R wave', rFrames[0], 'End-diastole on the ECG') : null}
          </Row>
          <Note>
            Click a chart to go to that frame. Orange line: the current frame.{' '}
            <Tip id="cycleShading" ctx={ctx}>
              Shaded: closed frames
            </Tip>{' '}
            (systole); the prolapse, gap and tenting jumps only look there, the orifice only in the open frames.
            {rFrames.length ? (
              <>
                {' '}
                <Tip id="rWave" ctx={ctx}>
                  R: R waves of the ECG
                </Tip>
                .
              </>
            ) : null}{' '}
            The points and the annulus are fixed; they do not follow the valve through the cycle.
          </Note>
          {worst && worst.maxHeightMm > PROLAPSE_MM ? (
            <div>
              Worst prolapse <Bad>{mmSigned(worst.maxHeightMm)}</Bad>
              {worst.maxSegment ? ` in ${worst.maxSegment}` : ''} at T{jumps.maxProlapse + 1}
            </div>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}
