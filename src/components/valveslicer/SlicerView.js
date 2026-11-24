import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { renderSliceToCanvas } from '../../utils/philipsVolume';
import { MIN_ANNULUS_POINTS, aortoMitralAngle, fitAnnulus, withAnnulus } from '../../utils/annulusFit';
import { getVolumeEcg, sampleIndexToFrame } from '../../utils/ecg';
import { cross, dot, normalize, scale, sub } from '../../utils/mprGeometry';
import { frameToPixel, frameToWorld, pixelToFrame, sampleFrame, worldToFrame } from '../../utils/mvSlicer';
import {
  PROLAPSE_MM,
  TEER_STEPS,
  clipSiteForCut,
  teerMeasures,
  virtualClip,
} from '../../utils/valveAnalysis';
import { CUT_COLOR } from './drawSlicerOverlay';
import KeyMap from './KeyMap';
import SidePanel from './SidePanel';
import useValveAnalysis from './useValveAnalysis';

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
  cursor: ${(p) => (p.$measuring ? 'crosshair' : p.$single ? 'zoom-out' : 'zoom-in')};

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
  border: 1px solid ${(p) => (p.$alert ? '#ff5252' : CUT_COLOR)};
  pointer-events: none;
`;

const CellResult = styled.div`
  position: absolute;
  bottom: 14px;
  left: 6px;
  font-size: 0.7rem;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.65);
  pointer-events: none;
  color: ${(p) => (p.$alert ? '#ff6e6e' : '#c8c8c8')};
  font-weight: ${(p) => (p.$alert ? 600 : 400)};

  span.gap {
    color: #ffb74d;
    font-weight: 600;
  }
`;

const Prompt = styled.div`
  position: absolute;
  top: 5px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.75rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  background: rgba(76, 175, 80, 0.85);
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
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  background: #212121;
  border-left: 1px solid #4a4a4a;
  font-size: 0.7rem;
  color: #c8c8c8;
  overflow-y: auto;

  canvas {
    width: 100%;
    height: auto;
    display: block;
    background: #000;
    touch-action: none;
    flex-shrink: 0;
  }
`;

const Note = styled.div`
  line-height: 1.4;
`;

const CELL_PX = 320;
const SINGLE_PX = 900;
const TRACE_OK = '#4fc3f7';
const TRACE_PROLAPSE = '#ff5252';
const HINGE_COLOR = '#ffeb3b';
const AORTIC_COLOR = '#e57373';
const TENT_FILL = 'rgba(66, 135, 245, 0.35)';
/** Hinges this close to a cut's plane are drawn in it (mm). */
const ON_PLANE_MM = 1;
const MIN_ANNULUS_CUTS = 3;

/** Points (world mm) lying in a cut's plane, in the cut's coordinates. */
function inCut(cut, items, getPoint) {
  const n = normalize(cross(cut.right, cut.down));
  return items
    .filter((it) => Math.abs(dot(sub(getPoint(it), cut.ref), n)) < ON_PLANE_MM)
    .map((it) => ({ ...it, ...worldToFrame(cut, getPoint(it)) }));
}

/** Canvas pixel under a mouse event, for a canvas drawn with object-fit: contain. */
function eventToCanvasPx(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const k = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const offX = (rect.width - canvas.width * k) / 2;
  const offY = (rect.height - canvas.height * k) / 2;
  return { px: (e.clientX - rect.left - offX) / k, py: (e.clientY - rect.top - offY) / k };
}

/**
 * One cut for the current frame, with the AoV and coaptation markers, the
 * level of the picked points, the leaflet trace, and TEER points.
 */
function CutCanvas({
  volume,
  timeIndex,
  cut,
  windowCenter,
  windowWidth,
  widthPx,
  profile,
  showReference,
  hinges,
  aortic,
  teerPoints,
  onImageClick,
}) {
  const ref = useRef(null);
  const scaleRef = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const mmPerPx = (cut.xMax - cut.xMin) / widthPx;
    scaleRef.current = mmPerPx;
    const img = sampleFrame(volume, timeIndex, cut, mmPerPx);
    renderSliceToCanvas(canvas, img, windowCenter, windowWidth);
    const ctx = canvas.getContext('2d');
    const r = Math.max(4, img.width * 0.014);
    const P = (x, y) => frameToPixel(cut, x, y, mmPerPx);

    // Level of the picked points (the annular plane when they were picked there)
    const level = P(0, 0).py;
    ctx.strokeStyle = 'rgba(76, 175, 80, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, level);
    ctx.lineTo(img.width, level);
    ctx.stroke();
    ctx.setLineDash([]);

    // Coaptation target: small marker at the top edge
    const t = P(cut.target.x, cut.target.y);
    ctx.fillStyle = CUT_COLOR;
    ctx.beginPath();
    ctx.moveTo(t.px, 2);
    ctx.lineTo(t.px - r, 2 + r * 1.4);
    ctx.lineTo(t.px + r, 2 + r * 1.4);
    ctx.closePath();
    ctx.fill();

    // AoV centre (MV only; dimmed when off this plane in parallel mode)
    if (cut.ao && cut.ao.offPlaneMm < 10) {
      const a = P(cut.ao.x, cut.ao.y);
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

    // Tenting: between the reference and leaflets below it
    const pts = profile?.points || [];
    ctx.fillStyle = TENT_FILL;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.h == null || b.h == null || (a.h >= 0 && b.h >= 0)) continue;
      const corners = [
        P(a.x, -a.r),
        P(b.x, -b.r),
        P(b.x, -(Math.min(0, b.h) + b.r)),
        P(a.x, -(Math.min(0, a.h) + a.r)),
      ];
      ctx.beginPath();
      corners.forEach((c, k) => (k ? ctx.lineTo(c.px, c.py) : ctx.moveTo(c.px, c.py)));
      ctx.closePath();
      ctx.fill();
    }

    // The annulus reference heights are measured from (plane or saddle)
    if (showReference && pts.length > 1) {
      ctx.strokeStyle = HINGE_COLOR;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1, r * 0.25);
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = P(p.x, -p.r);
        if (i) ctx.lineTo(q.px, q.py);
        else ctx.moveTo(q.px, q.py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Leaflet trace (atrial surface), red where it rises above the prolapse limit
    if (pts.length) {
      ctx.lineWidth = Math.max(1.5, r * 0.4);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a.h == null || b.h == null) continue;
        ctx.strokeStyle = Math.max(a.h, b.h) > PROLAPSE_MM ? TRACE_PROLAPSE : TRACE_OK;
        const pa = P(a.x, -(a.h + a.r));
        const pb = P(b.x, -(b.h + b.r));
        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.stroke();
      }
    }

    // Annulus hinges (diamonds) and the annulus line in this cut
    const mark = (list, color, shape) => {
      list.forEach((h) => {
        const p = P(h.x, h.y);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (shape === 'diamond') {
          ctx.moveTo(p.px, p.py - r);
          ctx.lineTo(p.px + r, p.py);
          ctx.lineTo(p.px, p.py + r);
          ctx.lineTo(p.px - r, p.py);
          ctx.closePath();
        } else {
          ctx.arc(p.px, p.py, r * 0.75, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      });
      if (list.length === 2) {
        const a = P(list[0].x, list[0].y);
        const b = P(list[1].x, list[1].y);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, r * 0.25);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    if (hinges?.length) mark(hinges, HINGE_COLOR, 'diamond');
    if (aortic?.length) mark(aortic, AORTIC_COLOR, 'dot');

    // TEER points and lines
    if (teerPoints) {
      const q = (k) => teerPoints[k] && P(teerPoints[k].x, teerPoints[k].y);
      const line = (a, b, color, dash) => {
        if (!a || !b) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, r * 0.35);
        ctx.setLineDash(dash ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(a.px, a.py);
        ctx.lineTo(b.px, b.py);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      line(q('hingeL'), q('hingeR'), '#ffeb3b', true);
      line(q('hingeL'), q('tipL'), '#ffb74d', false);
      line(q('hingeR'), q('tipR'), '#ffb74d', false);
      ctx.font = `600 ${Math.round(r * 2.2)}px Arial, Helvetica, sans-serif`;
      TEER_STEPS.forEach((s, i) => {
        const p = q(s.key);
        if (!p) return;
        ctx.fillStyle = s.key === 'coapt' ? '#4fc3f7' : '#ffeb3b';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.px, p.py, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(String(i + 1), p.px + r, p.py - r);
      });
    }
  }, [volume, timeIndex, cut, windowCenter, windowWidth, widthPx, profile, showReference, hinges, aortic, teerPoints]);

  const onClick = (e) => {
    if (!onImageClick || !ref.current || !scaleRef.current) return;
    e.stopPropagation();
    const { px, py } = eventToCanvasPx(e, ref.current);
    const f = pixelToFrame(cut, px, py, scaleRef.current);
    onImageClick(f);
  };

  return <canvas ref={ref} onClick={onClick} />;
}

function cellSummary(profile, cut) {
  if (!profile || profile.maxHeight == null) return { text: 'no leaflet found', alert: false };
  const leaflet = profile.maxLeaflet ? ` ${profile.maxLeaflet}` : '';
  const pro = profile.maxHeight > PROLAPSE_MM;
  const main = pro
    ? `↑ ${profile.maxHeight.toFixed(1)} mm${leaflet} · ${profile.prolapseWidthMm.toFixed(1)} mm long`
    : `max ${profile.maxHeight.toFixed(1)} mm`;
  return { text: main, alert: pro, gap: profile.gapMm > 0 ? profile.gapMm : 0 };
}

export default function SlicerView({
  volume,
  timeIndex,
  frameCount,
  slicer,
  windowCenter,
  windowWidth,
  onSeek,
}) {
  const { result, hinges, setHinges, aortic, setAortic } = slicer;
  const [single, setSingle] = useState(null);
  const [showHeights, setShowHeights] = useState(true);
  const defaultCut = result.kind === 'mv' ? Math.ceil(result.cuts.length / 2) : 2;
  const [teerCut, setTeerCut] = useState(defaultCut);
  const [teerPoints, setTeerPoints] = useState({});
  // What a click in the enlarged cut does: null, 'teer', 'annulus' or 'aortic'
  const [pickMode, setPickMode] = useState(null);
  const [traceCut, setTraceCut] = useState(null);
  const [traceSide, setTraceSide] = useState('L');
  const [device, setDevice] = useState(4);
  const [clipCut, setClipCut] = useState(defaultCut);

  // ---- 3D annulus from the hinges, and the result the analysis sees
  const down = result.kind === 'tv' ? result.raToRv : result.laToLv;
  const tracedCuts = useMemo(() => {
    const per = {};
    hinges.forEach((h) => {
      per[h.cut] = (per[h.cut] || 0) + 1;
    });
    return Object.keys(per).filter((k) => per[k] === 2).length;
  }, [hinges]);
  const fit = useMemo(() => {
    if (hinges.length < MIN_ANNULUS_POINTS || tracedCuts < MIN_ANNULUS_CUTS) return null;
    const directions = result.kind === 'mv' ? { cc: result.chord, ap: result.anterior } : {};
    return fitAnnulus(
      hinges.map((h) => h.p),
      { up: scale(down, -1), directions }
    );
  }, [hinges, tracedCuts, result, down]);
  const reference = fit ? slicer.reference : 'picked';
  const analysisResult = useMemo(() => withAnnulus(result, fit, reference), [result, fit, reference]);
  const analysis = useValveAnalysis({ volume, timeIndex, result: analysisResult });

  // ---- Aorto-mitral angle: aortic hinges and the mitral hinges of the same cut
  const aorticCutObj = aortic ? result.cuts.find((c) => c.index === aortic.cut) : null;
  let angle = null;
  let aorticNote = '';
  if (aortic?.pts.length === 2 && aorticCutObj) {
    const antSide = aorticCutObj.leaflets.left === 'anterior' ? 'L' : 'R';
    const ant = hinges.find((h) => h.cut === aortic.cut && h.side === antSide);
    const post = hinges.find((h) => h.cut === aortic.cut && h.side !== antSide);
    if (ant && post) angle = aortoMitralAngle({ ant: ant.p, post: post.p }, aortic.pts);
    else aorticNote = `Trace the annulus in cut ${aortic.cut} too: the angle uses its mitral hinges.`;
  }

  // Measurements are in a cut's own coordinates; they no longer apply once the
  // cuts change (points moved, flipped, mode changed). Hinges are kept (world mm).
  useEffect(() => {
    setTeerPoints({});
    setPickMode((m) => (m === 'teer' ? null : m));
  }, [result]);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      setPickMode(null);
      setSingle(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const teerCutObj = result.cuts.find((c) => c.index === teerCut) || result.cuts[0];
  const measures = useMemo(
    () => (Object.keys(teerPoints).length ? teerMeasures(teerPoints, teerCutObj, 1) : null),
    [teerPoints, teerCutObj]
  );

  const orifice = analysis.cycle?.best || null;
  const clipResult = useMemo(() => {
    if (!orifice) return null;
    const cut = result.cuts.find((c) => c.index === clipCut) || result.cuts[0];
    const { site, coaptDir } = clipSiteForCut(result, cut);
    return { ...virtualClip(orifice, analysisResult, site, coaptDir, device), site, coaptDir };
  }, [orifice, result, analysisResult, clipCut, device]);
  const showOrifice = orifice && analysis.cycle.bestFrame === timeIndex;

  const teer = {
    cutIndex: teerCut,
    setCutIndex: (i) => {
      setTeerCut(i);
      setTeerPoints({});
    },
    points: teerPoints,
    measures,
    active: pickMode === 'teer',
    start: () => {
      setPickMode('teer');
      setSingle(teerCut);
    },
    undo: () => {
      const last = [...TEER_STEPS].reverse().find((s) => teerPoints[s.key]);
      if (!last) return;
      setTeerPoints((p) => {
        const out = { ...p };
        delete out[last.key];
        return out;
      });
      setPickMode('teer');
    },
    clear: () => {
      setTeerPoints({});
      setPickMode(null);
    },
  };

  const addTeerPoint = (f) => {
    const step = TEER_STEPS.find((s) => !teerPoints[s.key]);
    if (!step) return;
    const next = { ...teerPoints, [step.key]: { x: f.x, y: f.y } };
    setTeerPoints(next);
    if (TEER_STEPS.every((s) => next[s.key])) setPickMode(null);
  };

  // ---- Annulus tracing: two hinges per cut, then on to the next cut
  const openTrace = (index, side = 'L') => {
    setPickMode('annulus');
    setTraceCut(index);
    setTraceSide(side);
    setSingle(index);
  };
  const advanceTrace = (fromIndex) => {
    const i = result.cuts.findIndex((c) => c.index === fromIndex);
    const next = result.cuts[i + 1];
    if (next) openTrace(next.index);
    else {
      setPickMode(null);
      setSingle(null);
    }
  };
  const addHinge = (cut, f) => {
    const hinge = { p: frameToWorld(cut, f.x, f.y), cut: cut.index, side: traceSide, t: timeIndex };
    setHinges((hs) => [...hs.filter((h) => !(h.cut === cut.index && h.side === traceSide)), hinge]);
    if (traceSide === 'L') setTraceSide('R');
    else advanceTrace(cut.index);
  };
  const annulus = {
    fit,
    hingeCount: hinges.length,
    cutsDone: tracedCuts,
    frames: [...new Set(hinges.map((h) => h.t))],
    tracing: pickMode === 'annulus',
    traceCut,
    reference,
    setReference: slicer.setReference,
    start: () => {
      const counts = {};
      hinges.forEach((h) => {
        counts[h.cut] = (counts[h.cut] || 0) + 1;
      });
      const todo = result.cuts.find((c) => (counts[c.index] || 0) < 2) || result.cuts[0];
      openTrace(single && pickMode !== 'annulus' ? single : todo.index);
    },
    stop: () => {
      setPickMode(null);
    },
    skip: () => advanceTrace(traceCut),
    undo: () => {
      const last = hinges[hinges.length - 1];
      if (!last) return;
      setHinges((hs) => hs.slice(0, -1));
      if (pickMode === 'annulus') openTrace(last.cut, last.side);
    },
    clear: () => {
      setHinges([]);
      setAortic(null);
      if (pickMode === 'annulus' || pickMode === 'aortic') setPickMode(null);
    },
    angle,
    aorticNote,
    aorticActive: pickMode === 'aortic',
    aorticStart: () => {
      const index = single || defaultCut;
      setAortic({ cut: index, t: timeIndex, pts: [] });
      setPickMode('aortic');
      setSingle(index);
    },
  };
  const addAortic = (cut, f) => {
    const p = frameToWorld(cut, f.x, f.y);
    const prev = aortic?.cut === cut.index ? aortic.pts : [];
    const pts = [...prev, p].slice(-2);
    setAortic({ cut: cut.index, t: timeIndex, pts });
    if (pts.length === 2) setPickMode(null);
  };

  // Hinges and aortic points lying in each cut (stable arrays, so the cut
  // canvases only redraw when they change)
  const cutMarks = useMemo(() => {
    const out = {};
    result.cuts.forEach((c) => {
      out[c.index] = {
        hinges: inCut(c, hinges, (h) => h.p),
        // Near the AoV the fan cuts converge, so show these only in their own cut
        aortic: aortic?.cut === c.index ? inCut(c, aortic.pts, (pt) => pt) : null,
      };
    });
    return out;
  }, [result, hinges, aortic]);

  const ecgFrames = useMemo(() => {
    const ecg = getVolumeEcg(volume);
    if (!ecg?.beats?.length) return [];
    return [...new Set(ecg.beats.map((b) => sampleIndexToFrame(ecg, b, frameCount)))].sort((a, b) => a - b);
  }, [volume, frameCount]);

  const o = result.orientation;
  const cuts = single ? result.cuts.filter((c) => c.index === single) : result.cuts;
  const frame = analysis.frame;
  const nextTeerStep = TEER_STEPS.find((s) => !teerPoints[s.key]);
  const flipLabel = `Flip ${o.top}/${o.bottom}`;
  const refLabel = reference === 'saddle' ? ' · heights from the 3D annulus' : reference === 'plane' ? ' · heights from the annulus plane' : '';

  const clickModeFor = (cut) => {
    if (single !== cut.index) return null;
    if (pickMode === 'teer' && cut.index === teerCut) return 'teer';
    if (pickMode === 'annulus' && cut.index === traceCut) return 'annulus';
    if (pickMode === 'aortic' && aortic?.cut === cut.index) return 'aortic';
    return null;
  };
  const promptFor = (cut, mode) => {
    if (mode === 'teer' && nextTeerStep) {
      return `${TEER_STEPS.indexOf(nextTeerStep) + 1}/${TEER_STEPS.length}: ${nextTeerStep.label(cut)}`;
    }
    if (mode === 'annulus') {
      const leaflet = traceSide === 'L' ? cut.leaflets.left : cut.leaflets.right;
      const k = result.cuts.indexOf(cut) + 1;
      return `Annulus, cut ${k}/${result.cuts.length}: click the ${leaflet} hinge`;
    }
    if (mode === 'aortic') return `Aortic annulus: hinge ${(aortic?.pts.length || 0) + 1} of 2`;
    return null;
  };

  return (
    <Overlay>
      <Header>
        <Title>
          <strong>{result.title}</strong>
          <span>
            {result.modeText} · {result.cuts.length} cuts
            {result.kind === 'mv' ? ` · ${result.spacingMm.toFixed(1)} mm apart on the coaptation line` : ''}
            {refLabel} · T {timeIndex + 1}/{frameCount}
          </span>
        </Title>
        <HeaderButton
          type="button"
          $active={slicer.flipVertical}
          onClick={() => slicer.setFlipVertical((v) => !v)}
          title="Swap the atrium and the ventricle (top/bottom)"
        >
          {flipLabel}
        </HeaderButton>
        <HeaderButton
          type="button"
          $active={slicer.mirror}
          onClick={() => slicer.setMirror((v) => !v)}
          title="Mirror the cuts left to right"
        >
          {result.kind === 'mv' ? 'Ao left' : 'Mirror'}
        </HeaderButton>
        <HeaderButton type="button" onClick={() => slicer.setOpen(false)} title="Back to the MPR views">
          Back to MPR
        </HeaderButton>
      </Header>
      <Body>
        <Cells $single={Boolean(single)}>
          {cuts.map((cut) => {
            const i = result.cuts.indexOf(cut);
            const profile = frame?.profiles[i];
            const summary = cellSummary(profile, cut);
            const mode = clickModeFor(cut);
            const prompt = promptFor(cut, mode);
            const showTeer = result.kind === 'mv' && cut.index === teerCut && Object.keys(teerPoints).length;
            const onImageClick =
              mode === 'teer'
                ? addTeerPoint
                : mode === 'annulus'
                  ? (f) => addHinge(cut, f)
                  : mode === 'aortic'
                    ? (f) => addAortic(cut, f)
                    : null;
            return (
              <Cell
                key={cut.index}
                $single={Boolean(single)}
                $measuring={Boolean(mode)}
                onClick={() => {
                  if (mode) return;
                  setSingle(single ? null : cut.index);
                }}
                title={mode ? 'Click the point named at the top' : single ? 'Back to all cuts' : 'Enlarge this cut'}
              >
                <CutCanvas
                  volume={volume}
                  timeIndex={timeIndex}
                  cut={cut}
                  windowCenter={windowCenter}
                  windowWidth={windowWidth}
                  widthPx={single ? SINGLE_PX : CELL_PX}
                  profile={profile}
                  showReference={Boolean(analysisResult.refHeight)}
                  hinges={cutMarks[cut.index].hinges}
                  aortic={cutMarks[cut.index].aortic}
                  teerPoints={showTeer ? teerPoints : null}
                  onImageClick={onImageClick}
                />
                <CellLabel $alert={summary.alert}>
                  {cut.index} · {cut.label}
                </CellLabel>
                {prompt ? <Prompt>{prompt}</Prompt> : null}
                <CellResult $alert={summary.alert}>
                  {summary.text}
                  {summary.gap ? <span className="gap"> · gap {summary.gap.toFixed(1)} mm</span> : null}
                  {profile?.tentingHeightMm > 0.5 ? ` · tent ${profile.tentingHeightMm.toFixed(1)} mm` : ''}
                </CellResult>
                <Orient $pos="top: 6px; right: 8px;">{o.top}</Orient>
                <Orient $pos="bottom: 3px; left: 50%; transform: translateX(-50%);">{o.bottom}</Orient>
                <Orient $pos="top: 50%; left: 6px;">{cut.sideLabels.left}</Orient>
                <Orient $pos="top: 50%; right: 6px;">{cut.sideLabels.right}</Orient>
              </Cell>
            );
          })}
        </Cells>
        <Side>
          <div>{result.kind === 'tv' ? 'En-face from the RA' : 'Surgical view'} (valve level, 10 mm slab)</div>
          <KeyMap
            volume={volume}
            timeIndex={timeIndex}
            result={analysisResult}
            windowCenter={windowCenter}
            windowWidth={windowWidth}
            active={single}
            onPick={(index) => setSingle(index)}
            onMovePoint={slicer.movePoint}
            heights={showHeights ? frame?.map : null}
            orifice={showOrifice ? orifice : null}
            clip={showOrifice ? clipResult : null}
            hinges={hinges}
          />
          <Note>
            Drag the points in this map to adjust them; the cuts follow. Click a cut or its line to enlarge it. Space
            plays the cine; ← → step frames.
          </Note>
          {result.normalSource === 'points' && (
            <Note style={{ color: '#ffb74d' }}>
              The points were not picked in an en-face view, so the valve plane was taken from the points. Re-pick
              in an en-face view for best results.
            </Note>
          )}
          <SidePanel
            result={analysisResult}
            analysis={analysis}
            showHeights={showHeights}
            setShowHeights={setShowHeights}
            onOpenCut={(index) => setSingle(index)}
            teer={teer}
            clip={{ device, setDevice, cutIndex: clipCut, setCutIndex: setClipCut, result: clipResult }}
            annulus={annulus}
            timeIndex={timeIndex}
            frameCount={frameCount}
            onSeek={onSeek}
            rFrames={ecgFrames}
          />
        </Side>
      </Body>
    </Overlay>
  );
}
