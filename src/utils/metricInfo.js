/**
 * What each number on screen means: a title, how it is measured, and, where a
 * published reference exists, typical values with the source. Used by the
 * hover explanations (components/Tip.js).
 *
 * Entries are objects or functions of a context built by infoContext():
 *   { kind: 'mv' | 'tv', ref, atrium, ventricle, centralCut }
 */

export const SOURCES = {
  wase: {
    label: 'WASE study: normal mitral annulus by 3D echo',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10257802/',
  },
  muraru: {
    label: 'Muraru et al. 2022: 3D tricuspid annulus reference ranges',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9513148/',
  },
  salgo: {
    label: 'Salgo et al. 2002: annular shape and leaflet stress',
    url: 'https://pure.psu.edu/en/publications/effect-of-annular-shape-on-leaflet-curvature-in-reducing-mitral-l/',
  },
  mvp: {
    label: 'Mitral valve prolapse: echocardiographic definition (review)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5805573/',
  },
  everest: {
    label: 'EVEREST anatomical criteria for TEER (table)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6288214/',
  },
  tentingArea: {
    label: 'Mitral tenting area and outcome after annuloplasty (Open Heart 2021)',
    url: 'https://openheart.bmj.com/node/141927',
  },
  tentingVolume: {
    label: 'Tenting volume in functional MR vs controls',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7368231/',
  },
  stenosis: {
    label: '2020 ACC/AHA guideline: severe mitral stenosis is MVA ≤ 1.5 cm² (summary)',
    url: 'https://consultqd.clevelandclinic.org/perspectives-on-the-2020-acc-aha-guideline-for-valvular-heart-disease-focus-on-the-mitral-valve',
  },
  besler: {
    label: 'Besler et al. 2018: coaptation gap and tricuspid TEER success',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Besler+tricuspid+edge-to-edge+repair+predictors+procedural+success+2018',
  },
  fukuda: {
    label: 'Fukuda et al., Circulation 2005: TV tethering and residual TR',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=Fukuda+tricuspid+valve+tethering+predicts+residual+tricuspid+regurgitation+after+tricuspid+annuloplasty',
  },
};

/** Context for the texts, from a slicer result (as analysed). */
export function infoContext(result, refShort = 'picked plane') {
  const tv = result?.kind === 'tv';
  return {
    kind: tv ? 'tv' : 'mv',
    ref: refShort,
    atrium: tv ? 'RA' : 'LA',
    ventricle: tv ? 'RV' : 'LV',
    valve: tv ? 'tricuspid' : 'mitral',
  };
}

const INFO = {
  /* --------------------------------------------------------- 3D annulus -- */
  cutsTraced: {
    title: 'Cuts traced',
    text: 'Cuts in which both annulus hinge points have been clicked. Three cuts are the minimum for a fit; tracing all of them gives the most reliable saddle shape.',
  },
  annulusArea3d: (c) => ({
    title: 'Annulus area (3D)',
    text: 'Area of the surface spanned by the fitted 3D annulus curve (triangles from its centre to the curve). It is slightly larger than the projected area because the annulus is not flat.',
    normal:
      c.kind === 'mv'
        ? 'Normal early-systolic 3D annulus area: 6.9–16.4 cm² in men, 6.1–14.5 cm² in women.'
        : 'Normal end-diastolic 3D annulus area: 9.6 ± 2.1 cm².',
    source: c.kind === 'mv' ? SOURCES.wase : SOURCES.muraru,
  }),
  annulusArea2d: (c) => ({
    title: 'Annulus area (projected)',
    text: 'Area enclosed by the annulus outline projected on its best-fit plane, the 2D area most software reports.',
    normal: c.kind === 'mv' ? 'Normal early-systolic 2D annulus area: 6.5–15.7 cm² in men, 5.7–14.2 cm² in women.' : null,
    source: c.kind === 'mv' ? SOURCES.wase : null,
  }),
  annulusPerimeter: (c) => ({
    title: 'Annulus perimeter',
    text: 'Length of the fitted 3D annulus curve, all the way round.',
    normal: c.kind === 'tv' ? 'Normal end-diastolic 3D perimeter: 11.2 ± 1.2 cm (112 ± 12 mm).' : null,
    source: c.kind === 'tv' ? SOURCES.muraru : null,
  }),
  apDiameter: {
    title: 'Anteroposterior (AP) diameter',
    text: 'Width of the fitted annulus through its centre, from the anterior (aortic) side to the posterior side, measured in the annulus plane.',
    normal: 'Normal early-systolic AP diameter: 27–42 mm in men, 24–39 mm in women.',
    source: SOURCES.wase,
  },
  ccDiameter: {
    title: 'Commissural (intercommissural) diameter',
    text: 'Width of the fitted annulus through its centre along the AL–PM commissure direction, measured in the annulus plane. Used as the width in the AHCWR.',
  },
  maxDiameter: {
    title: 'Maximum diameter',
    text: 'Largest width of the fitted annulus through its centre, over all directions in the annulus plane (the major axis).',
    normal: 'Normal end-diastolic major diameter: 38 ± 4 mm.',
    source: SOURCES.muraru,
  },
  minDiameter: {
    title: 'Minimum diameter',
    text: 'Smallest width of the fitted annulus through its centre, over all directions in the annulus plane (the minor axis).',
    normal: 'Normal end-diastolic minor diameter: 31 ± 4 mm.',
    source: SOURCES.muraru,
  },
  saddleHeight: (c) => ({
    title: c.kind === 'mv' ? 'Saddle (annular) height' : 'Annulus height',
    text:
      c.kind === 'mv'
        ? 'Vertical distance between the highest and lowest points of the fitted annulus, measured from its best-fit plane. The anterior and posterior annulus are the peaks of the saddle and the commissures the troughs; a low value means a flat annulus.'
        : 'Vertical distance between the highest and lowest points of the fitted annulus, measured from its best-fit plane.',
    normal: c.kind === 'mv' ? 'Normal early-systolic annular height: 4.2–13.7 mm in men, 3.9–14.5 mm in women.' : null,
    source: c.kind === 'mv' ? SOURCES.wase : null,
  }),
  ahcwr: {
    title: 'AHCWR (annular height to commissural width ratio)',
    text: 'Saddle height ÷ commissural diameter × 100. It describes how saddle-shaped the annulus is regardless of its size: lower values mean a flatter annulus.',
    normal: 'In a modelling study, leaflet stress was lowest at about 15–25%; values below 15% are read here as a flattened annulus.',
    source: SOURCES.salgo,
  },
  aortoMitralAngle: {
    title: 'Aorto-mitral angle',
    text: 'Angle at the aorto-mitral continuity between the mitral annulus line (anterior → posterior hinge) and the aortic annulus line (the two aortic hinges you clicked), in the same long-axis cut. 180° would mean the two annuli lie in line; the angle narrows as the aortic root folds over the mitral valve.',
    normal: 'There is no agreed normal range. It narrows in systole and widens in diastole, so compare values from the same phase.',
  },

  /* ---------------------------------------------------- Prolapse (heights) -- */
  leafletHeight: (c) => ({
    title: 'Leaflet height',
    text: `Height of the atrial surface of the leaflets above the ${c.ref}, measured along the valve axis. Positive (+) is towards the ${c.atrium} (above the annulus), negative (−) towards the ${c.ventricle} (below it). Grey means no leaflet was found there.`,
    normal: 'Above +2 mm in systole counts as prolapse; below 0 is tenting.',
    source: c.kind === 'mv' ? SOURCES.mvp : null,
  }),
  maxHeight: (c) => ({
    title: 'Highest leaflet point',
    text: `Highest point of the leaflet surface above the ${c.ref} in this frame, and the segment it lies in. Read it in systole with the valve closed. A negative value means the whole leaflet surface lies below the reference (tented).`,
    normal: 'Prolapse: displacement of more than 2 mm above the annulus in systole.',
    source: c.kind === 'mv' ? SOURCES.mvp : null,
  }),
  prolapseArea: (c) => ({
    title: 'Prolapse area',
    text: `Area of the valve (seen en face) where the leaflets rise more than 2 mm above the ${c.ref}.`,
  }),
  prolapseWidth: {
    title: 'Prolapse width',
    text: 'Extent of the prolapsing area (above +2 mm) along the commissure-to-commissure direction: the “flail width” used for TEER planning.',
    normal: 'EVEREST: flail width below 15 mm.',
    source: SOURCES.everest,
  },
  segmentMax: (c) => ({
    title: 'Highest point in the segment',
    text: `Highest point of the leaflet surface within this segment, above the ${c.ref} (+ above, − below). Red: more than +2 mm (prolapse).`,
  }),
  segmentProlapseArea: (c) => ({
    title: 'Prolapse area in the segment',
    text: `Area of this segment (en face) where the leaflets are more than 2 mm above the ${c.ref}.`,
  }),

  /* ------------------------------------------------------------- Tenting -- */
  coaptationDepth: (c) => ({
    title: 'Coaptation depth (tenting height)',
    text: `Distance from the ${c.ref} down to where the leaflets meet, in ${c.centralCut || 'the central cut'}: the deepest leaflet point within 3 mm of the coaptation line. Not given when the leaflets do not meet in that cut (gap). Read it in mid-systole.`,
    normal:
      c.kind === 'mv'
        ? 'More than 11 mm was an EVEREST exclusion for TEER; about 1 cm or more is also linked to recurrent MR after ring annuloplasty.'
        : 'A tethering distance above 7.6 mm predicted residual TR after annuloplasty.',
    source: c.kind === 'mv' ? SOURCES.everest : SOURCES.fukuda,
  }),
  tentingArea: (c) => ({
    title: 'Tenting area',
    text: `Area between the ${c.ref} and the leaflets lying below it, in ${c.centralCut || 'the central cut'}: the 2D tenting area of a long-axis view. Read it in mid-systole.`,
    normal:
      c.kind === 'mv'
        ? 'A tenting area above about 2.4–2.5 cm² is linked to recurrent MR and worse outcome after annuloplasty.'
        : 'A tethering area above 1.63 cm² predicted residual TR after annuloplasty.',
    source: c.kind === 'mv' ? SOURCES.tentingArea : SOURCES.fukuda,
  }),
  tentingAreaMax: (c) => ({
    title: 'Largest tenting area of all cuts',
    text: `The cut with the largest area between the ${c.ref} and the leaflets below it. Click the row to open that cut.`,
  }),
  deepestPoint: (c) => ({
    title: 'Deepest leaflet point',
    text: `Deepest point of the leaflet surface below the ${c.ref} anywhere in the valve (not only at the coaptation), and its segment. Large values in an open frame are the open leaflets, not tenting.`,
  }),
  tentingVolume: (c) => ({
    title: 'Tenting volume',
    text: `Volume between the ${c.ref} and the leaflets wherever they lie below it, over the whole valve (the 3D tenting volume). Read it in mid-systole with the valve closed.`,
    normal:
      c.kind === 'mv'
        ? 'One study: 1.9 ± 0.8 mL in controls vs 5.2 ± 1.8 mL in functional MR (values vary between studies and methods).'
        : null,
    source: c.kind === 'mv' ? SOURCES.tentingVolume : null,
  }),
  segmentDepth: (c) => ({
    title: 'Deepest point in the segment',
    text: `Deepest point of the leaflet surface below the ${c.ref} within this segment.`,
  }),
  segmentVolume: (c) => ({
    title: 'Tenting volume in the segment',
    text: `Volume between the ${c.ref} and the leaflets below it, within this segment.`,
  }),

  /* ---------------------------------------------------------------- Cuts -- */
  cutMax: (c) => ({
    title: 'Highest point in the cut',
    text: `Highest point of the leaflet trace in this cut, above the ${c.ref} (+ above, − below). Red: more than +2 mm (prolapse).`,
  }),
  cutGap: {
    title: 'Coaptation gap',
    text: 'Width of the opening between the two leaflets at the coaptation line in this cut, where no tissue is found within 10 mm below the reference. Only reported when there is leaflet on both sides of it. In systole this is a coaptation (flail) gap.',
    normal: 'EVEREST: flail gap below 10 mm.',
    source: SOURCES.everest,
  },
  cutDepth: (c) => ({
    title: 'Coaptation depth in the cut',
    text: `Depth of the leaflets below the ${c.ref} where they meet in this cut (within 3 mm of the coaptation line). Hidden below 0.5 mm and when there is a gap.`,
  }),
  cutLength: {
    title: 'Prolapse length in the cut',
    text: 'Length along this cut of the leaflet run that is more than 2 mm above the reference.',
  },

  /* --------------------------------------------------------------- Cycle -- */
  chartHighest: (c) => ({
    title: 'Highest leaflet point per frame',
    text: `The highest leaflet point above the ${c.ref} in each frame. Dashed line: +2 mm (prolapse). Only the closed (shaded) frames are systolic; in open frames the value is the open leaflets.`,
  }),
  chartGap: {
    title: 'Widest coaptation gap per frame',
    text: 'The widest coaptation gap over all cuts in each frame. Gaps in open (unshaded) frames are the open valve, not a coaptation defect.',
  },
  chartTenting: (c) => ({
    title: 'Tenting volume per frame',
    text: `Volume between the ${c.ref} and the leaflets below it, per frame. Meaningful in the closed (shaded) frames.`,
  }),
  chartOrifice: {
    title: 'Orifice area per frame',
    text: 'Area of the smallest enclosed orifice section in each frame (planimetry). “closed” means no orifice opening into the ventricle was found. The largest value in an open frame is the valve area.',
  },
  cycleShading: {
    title: 'Closed and open frames',
    text: 'Shaded frames are classed as closed: the leaflets cover nearly as much of the valve as in the best frame and there is no large orifice. Prolapse, gap and tenting are read there; the orifice in the other frames.',
  },
  rWave: {
    title: 'R wave',
    text: 'R waves detected on the ECG stored in the DICOM file: end-diastole, just before the valve closes.',
  },

  /* ----------------------------------------------------------- Threshold -- */
  threshold: {
    title: 'Tissue threshold',
    text: 'Grey level (0–255) above which a voxel counts as leaflet tissue. Auto takes the value halfway between the blood level (median grey around the valve) and the tissue level (98th percentile), per frame.',
  },

  /* ---------------------------------------------------------------- TEER -- */
  teerLeafletLength: {
    title: 'Leaflet length',
    text: 'Straight distance from the hinge point to the tip of the leaflet, as clicked in the TEER cut.',
    normal: 'A posterior leaflet of at least 10 mm is commonly required for a secure grasp.',
  },
  teerAnnulus: {
    title: 'Annulus in this cut',
    text: 'Distance between the two hinge points clicked in the TEER cut: a 2D annulus diameter in that plane.',
  },
  mva: (c) => ({
    title: 'Mitral valve area (3D planimetry)',
    text: `The orifice is sectioned from the ${c.ref} towards the LV every 0.5 mm; in each frame the smallest enclosed section (at the leaflet tips) is the orifice. The MVA is the largest of these over the open frames (diastole).`,
    normal: 'EVEREST: at least 4.0 cm², to avoid mitral stenosis after the clip.',
    source: SOURCES.everest,
  }),
  mvaDepth: (c) => ({
    title: 'Orifice depth',
    text: `How far below the ${c.ref} the narrowest section of the orifice was found: where the leaflet tips are.`,
  }),
  afterClip: {
    title: 'Orifice after a clip (estimate)',
    text: 'The MVA orifice with a band across it closed: the device width plus 2 mm of approximated tissue on each side, centred on the chosen cut. The two numbers in brackets are the orifices left on each side. A rough geometric estimate, not a validated predictor of the gradient.',
  },
  crCoaptLength: {
    title: 'Coaptation length',
    text: 'Distance from the coaptation point (first contact) to the midpoint of the two leaflet tips: how much of the leaflets is in contact.',
    normal: 'EVEREST: at least 2 mm.',
    source: SOURCES.everest,
  },
  crCoaptDepth: {
    title: 'Coaptation depth (TEER cut)',
    text: 'Distance from the line joining the two annulus hinge points down to the coaptation point, from the points clicked in the TEER cut.',
    normal: 'EVEREST: 11 mm or less.',
    source: SOURCES.everest,
  },
  crFlailGap: {
    title: 'Tip-to-tip (flail) gap',
    text: 'Distance between the two leaflet tips clicked in the TEER cut.',
    normal: 'EVEREST: below 10 mm.',
    source: SOURCES.everest,
  },
  crFlailWidth: {
    title: 'Prolapse (flail) width',
    text: 'Extent of the prolapsing area along the commissure-to-commissure direction, from the prolapse map of the current frame (use systole).',
    normal: 'EVEREST: below 15 mm.',
    source: SOURCES.everest,
  },
  crPosteriorLength: {
    title: 'Posterior leaflet length',
    text: 'Hinge-to-tip length of the posterior leaflet in the TEER cut.',
    normal: 'At least 10 mm is commonly required for grasping.',
  },
  crMva: {
    title: 'MVA (planimetry)',
    text: 'Largest orifice area over the open frames, from “Find MVA over the cycle”.',
    normal: 'EVEREST: at least 4.0 cm².',
    source: SOURCES.everest,
  },

  /* ---------------------------------------------------- Clip suitability -- */
  clipZones: (c) => ({
    title: 'Suitable clip areas',
    text:
      c.kind === 'mv'
        ? 'Each cut is a candidate clip position on the coaptation line (the long-axis grasping view through it). From the leaflet trace in this frame it checks that both leaflets are long enough to grasp, that the coaptation is within the EVEREST limits (flail gap < 10 mm, coaptation depth ≤ 11 mm), and whether there is a lesion to treat there (prolapse or a gap). Flail width < 15 mm, MVA ≥ 4.0 cm² and the orifice left after a clip apply to every position once known. Read it in systole.'
        : 'Each cut is a candidate clip position on a coaptation line. From the leaflet trace in this frame it checks that both leaflets reach the coaptation, whether there is a gap to treat there, and how wide it is: smaller gaps (about 7 mm or less) predict tricuspid TEER success. Read it in systole.',
    normal: 'Calcification, clefts, perforation and chordae in the grasping zone are not assessed: check them on the images.',
    source: c.kind === 'mv' ? SOURCES.everest : SOURCES.besler,
  }),
  clipLeafletLengths: {
    title: 'Leaflet lengths at this position',
    text: 'Length of each leaflet along its atrial surface, from the end of the trace (the hinge once the annulus is traced) to the coaptation point, or to the edge of a gap. The free edge below the coaptation point is not included, so the hinge-to-tip length is a few mm longer.',
    normal: 'MV: a posterior leaflet of at least 10 mm is commonly required for a secure grasp.',
  },
  clipStatus: (c) => ({
    title: 'Clip suitability',
    text: 'Clip target: a lesion here and the anatomy within the criteria. Suitable: within the criteria, no lesion found here. Caution: possible, with a concern. Unfavourable: outside the anatomical criteria. Hover over a status for the reasons.',
    normal:
      c.kind === 'mv'
        ? 'An orifice left after a clip of 1.5 cm² or less would be in the severe-stenosis range.'
        : 'Tricuspid: a coaptation gap above about 7 mm makes a caution.',
    source: c.kind === 'mv' ? SOURCES.stenosis : SOURCES.besler,
  }),

  /* -------------------------------------------------------- Slicer header -- */
  cutSpacing: {
    title: 'Cut spacing',
    text: 'Distance between neighbouring cuts where they cross the coaptation line.',
  },
  coaptationLine: {
    title: 'Coaptation line length',
    text: 'Length of the coaptation line from the AL to the PM commissure through the middle point, along which the cuts are spread.',
  },
  frame: {
    title: 'Frame',
    text: 'Current frame of the loop / number of frames. The analysis numbers are for this frame unless they say otherwise.',
  },

  /* ---------------------------------------------------------- MPR viewer -- */
  distance: {
    title: 'Distance',
    text: 'Straight-line distance between the two points, in mm, in the plane where they were placed.',
  },
  area: {
    title: 'Area',
    text: 'Area enclosed by the outline you drew, in its view plane, in cm² (1 cm² = 100 mm²).',
  },
  heartRate: {
    title: 'Heart rate',
    text: 'From the R–R interval of the ECG stored in the DICOM file (detected R waves), or from the heart rate in the file header.',
  },
  volumeSize: {
    title: 'Volume size',
    text: 'Voxels in x × y × z × frames, and the physical size of the volume in mm.',
  },
  slab: {
    title: 'Slab thickness',
    text: 'Thickness of the slab each 2D view averages or projects (MIP) across. Thin: a single plane.',
  },
};

/** The entry for an id, resolved for the context; null when there is none. */
export function metricInfo(id, ctx = {}) {
  const e = INFO[id];
  if (!e) return null;
  const c = { kind: 'mv', ref: 'reference', atrium: 'atrium', ventricle: 'ventricle', ...ctx };
  return typeof e === 'function' ? e(c) : e;
}

export const METRIC_IDS = Object.keys(INFO);
