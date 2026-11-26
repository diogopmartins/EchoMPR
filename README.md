# EchoMPR

Browser-based **multi-planar reconstruction (MPR)** and 3D volume viewing for **Philips QLAB Cartesian** echocardiography DICOM. Runs entirely client-side and deploys to **GitHub Pages**.

## Features

- Upload a Philips QLAB Cartesian `.dcm` (drag-and-drop)
- Orthogonal MPR: axial / sagittal / coronal with linked crosshairs
- Slice scroll (mouse wheel), temporal cine
- GPU volume rendering (MIP or alpha composite) with optional cut planes
- Export current timepoint as NRRD
- MV slicer: nine long-axis cuts across the mitral valve to find prolapsing scallops, with a prolapse height map, per-cut measurements and TEER planning
- TV slicer: cuts across each tricuspid coaptation line, with prolapse and coaptation-gap measurements
- 3D annulus traced in the slicer cuts (saddle shape, area, perimeter, diameters, AHCWR, aorto-mitral angle), used as the reference for leaflet heights
- Tenting (height, area, volume) for functional MR/TR, and a cycle analysis that charts every frame and jumps to the worst one
- 3D leaflet model in the 3D view: leaflets coloured by height, annulus, coaptation line and segment labels, with surgical and ventricular views
- Every number explains itself on hover: what it is, how it is measured, and normal or cut-off values with their source; the map and the 3D model read out the height under the cursor
- No server: files never leave the browser

## Supported data

Tested against Philips **PMS QLAB Cart Export** 4D Cartesian ultrasound:

| Property | Source |
|----------|--------|
| Temporal frames `T` | `(0028,0008) NumberOfFrames` |
| Z slices | Private `(3001,1001)` Philips3D |
| In-plane spacing | `(0018,602C/602E)` PhysicalDeltaX/Y (cm) |
| Z spacing | Private `(3001,1003)` (cm) |
| Layout | `(T, Z, Y, X)` packed in PixelData |

Axes are **volume-local**. This export typically has no `ImagePositionPatient` / `ImageOrientationPatient`, so planes are not labeled in patient anatomical space.

Large 4D files (~100MB+) are expected; do not commit `.dcm` files to the repo.

## MV slicer

Shows nine long-axis cuts across the mitral valve, from the anterolateral (AL) to the posteromedial (PM) commissure, to identify which scallop prolapses.

1. Tilt the planes so one 2D view is en-face to the mitral valve (surgical view) at the annulus level, with the aortic valve visible.
2. In **MV slicer**, press **Pick points** and click, in that view:
   1. the AL commissure
   2. the middle of the coaptation line (A2–P2)
   3. the PM commissure
   4. the aortic valve centre
3. The nine cuts open as a 3×3 grid that follows the cine. Click a cut to enlarge it; **Back to MPR** returns to the 2D views.

How the cuts are placed:
- **Targets:** nine points evenly spaced along the coaptation curve AL → Mid → PM.
- **Fan through the AoV (default):** every cut passes through the aortic valve centre, so the AoV is in every image, like sweeping a TEE long-axis view across the valve.
- **Parallel:** cuts are perpendicular to the commissural line instead.
- **Orientation:** TEE mid-oesophageal long-axis convention, with LA at the top and the aortic side on the right. LA→LV is worked out from the picked anatomy; **Flip LA/LV** and **Ao left** override it.
- **Labels:** cuts 1 and 9 are the commissures; 2–3 cross A1/P1, 4–6 A2/P2, 7–8 A3/P3 (approximate Carpentier segments).
- **Valve-level line:** a dashed line marks the level the points were picked at. Leaflet tissue above it towards the LA in systole suggests prolapse.
- **Key map:** a surgical-view map (valve-level 10 mm slab) shows where each numbered cut runs. Click a line to open that cut.
- **Editing points:** drag **AL**, **Mid**, **PM** or **Ao** in the key map to adjust them; the cuts update as you drag. Each point keeps its height above or below the valve, and moves that would make the cuts impossible (such as AL onto PM) are ignored.

### Prolapse map and per-cut measurements

The app follows the valve axis from the atrial side and takes the first voxel bright enough to be tissue as the leaflet's atrial surface. Two consecutive samples must be above the tissue threshold, so single speckles are ignored. The threshold is set per frame, halfway between blood and leaflet tissue, and can be overridden in the side panel. Heights are measured from the plane of the picked points, so pick them at the annulus level, or from the traced 3D annulus (see below).

- **Prolapse map:** leaflet height over the valve outline as a colour scale (red = towards the atrium), on the surgical-view map. Prolapse is a height over 2 mm. It reports the maximum, the area above 2 mm, the width along the coaptation line, and a table per segment (A1–P3 for the MV, A/S/P for the TV).
- **Per-cut measurements:** each cut shows the traced leaflet (red where above 2 mm), its maximum height and which leaflet, the length of the prolapsing part, and the **coaptation gap**. The gap is the stretch without tissue at the coaptation point, bounded by leaflets on both sides.
- **Calipers on the images** (**Calipers** button, on by default): in each cut a red vertical caliper from the reference to the highest point (prolapse height), a red horizontal caliper over the part above +2 mm (prolapse length), and an orange caliper across the coaptation gap at the reference level, each with its value. On the surgical-view map: the MV prolapse width along the commissural direction (red) and each cut's gap at valve level (orange, the widest labelled).

### TEER planning (MV)

- **Measure:** opens a cut (default A2/P2). Click, in order:
  1. the posterior hinge (annulus)
  2. the anterior hinge (annulus)
  3. the coaptation point (first contact)
  4. the posterior leaflet tip
  5. the anterior leaflet tip

  This gives the leaflet lengths, the annulus in that cut, coaptation depth (from the hinge line) and length, and the tip-to-tip gap.
- **Find MVA over the cycle:** in every frame, sections between the valve level and 15 mm towards the LV are flood-filled from the coaptation centre. The sections are planes, or surfaces parallel to the saddle once the annulus is traced. Regions that reach the valve outline are not enclosed by leaflets and are skipped. An enclosed region only counts if it carries on into the ventricle; the funnel of a closed, tented valve does not. The smallest enclosed area per frame is the orifice, and the largest over the open frames of the cycle is reported as the MVA.
- **Virtual clip:** closes a band across the orifice at the chosen cut. The band is the device width (4, 6 or 10 mm) plus 2 mm of approximated tissue on each side. This is a rough geometric estimate, not a validated predictor.
- **Criteria:** a table checks the values against the EVEREST anatomical criteria: coaptation length ≥ 2 mm, coaptation depth ≤ 11 mm, flail gap < 10 mm, flail width < 15 mm, posterior leaflet ≥ 10 mm, MVA ≥ 4.0 cm².

### Suitable clip areas (MV and TV)

The **Show suitable clip areas** tick box treats each cut as a candidate clip position on the coaptation line, since each cut is the long-axis grasping view through that point. Ticking it runs the cycle analysis if needed, so open frames, the MVA and the orifice left after a clip are known.

- **Clip target** (green, ◎): there is a lesion to treat at this position (prolapse or a coaptation gap), and the anatomy is within the criteria.
- **Suitable** (light green): within the criteria, but no lesion was found here.
- **Caution** (amber): possible, with a concern. Examples are a commissural position, a posterior leaflet under 10 mm, a flail wider than 15 mm, about 1.5 cm² or less left after a clip here, or (TV) a gap above about 7 mm.
- **Unfavourable** (red): outside the MV EVEREST limits (flail gap ≥ 10 mm, coaptation depth > 11 mm, MVA < 4.0 cm²), or a leaflet too short to grasp.
- **Not assessed** (grey): no leaflets found, or an open frame. On an open frame a button jumps to a systolic one.

Leaflet lengths run along the atrial surface from the hinge to the coaptation point, so they are a lower bound of the hinge-to-tip length. They are only measured and checked once the 3D annulus is traced, because without it the hinges are not known. The key map shows a device-wide bar at each position, coloured by status. Each cut shows its status, and hovering over a status lists the reasons. Calcification, clefts, perforation and chordae are not assessed; check them on the images. This is a geometric screen of the images, not a treatment decision.

### 3D annulus

**Trace annulus** opens the cuts one by one: click the two annulus hinge points in each, and the next cut opens. **Skip cut** leaves one out. Three cuts are enough for a fit; all nine give the best saddle. Trace in one frame; mid-systole shows the saddle best.

The hinges get a best-fit plane and a closed curve: radius and height as Fourier series of the angle around the centre. The second harmonic of the height is the saddle. Hinges from fan cuts bunch on the anterior side, which would tilt a plain fit, so the plane is refined from the fitted curve itself and the curve refitted.

- **Measurements:** 3D and projected area, perimeter, AP and commissural diameters (max and min for the TV), saddle height and AHCWR (annulus height to commissural width ratio; below 15% is a flattened annulus).
- **Aorto-mitral angle:** **Aortic annulus (2 clicks)** in the A2/P2 cut (or the enlarged one). The angle is between the mitral annulus line in that cut and the aortic annulus line; 180° means the two are in line.
- **Height reference:** **Picked plane**, **Annulus plane** (best-fit plane of the hinges) or **Saddle**. The saddle reference is the annulus extended smoothly across the orifice, so it matches the annulus at the rim. A flat reference shows the high anterior and posterior horns of a normal saddle as a false prolapse. The traced annulus also becomes the valve outline for the analysis. The cuts show the reference as a dashed yellow line.

### Tenting (functional MR/TR)

Leaflet below the reference counts as tenting, shaded blue in the cuts and the map. Read it in mid-systole with the valve closed.

- **Coaptation depth (tenting height)** and **tenting area**, read where they are measured clinically: in the A2/P2 cut for the MV, and in the cut where the leaflets meet deepest for the TV. Coaptation depth is the deepest leaflet within 3 mm of the coaptation point; it is not given when the leaflets do not meet in that cut. The cut with the largest tenting area is listed too when it is another one.
- **Tenting volume** (mL) between the reference and the leaflets, and the **deepest leaflet point** anywhere in the valve, also per segment.
- **Reference values:** a coaptation depth over 11 mm was an EVEREST exclusion for TEER, and a tenting area above about 2.4–2.5 cm² is linked to recurrent MR after annuloplasty. For the TV, Fukuda et al. reported tethering distance > 0.76 cm and tethering area > 1.63 cm² as predictors of residual TR after annuloplasty. Values above these are shown in red.

### Over the cycle

**Analyse the cycle** measures every frame with the current points, threshold and reference. It charts the highest leaflet point, the widest coaptation gap, the tenting volume and the orifice area per frame. Click a chart to go to a frame.

- **Jumps:** **Worst prolapse**, **Widest gap**, **Most tenting**, **Largest orifice**, and **R wave** when the DICOM has an ECG.
- **Closed vs open frames:** a frame counts as closed (shaded) when the leaflets cover nearly as much of the valve as in the best frame and it has no orifice comparable with the largest. The prolapse, gap and tenting jumps only look at closed frames; the orifice only at open ones.
- **ECG:** R waves are detected in the DICOM waveform (Pan–Tompkins style: slope energy, adaptive threshold, 250 ms refractory period). They are marked on the ECG strip and the charts, and give the heart rate when the file does not.

The points and the annulus are fixed; they do not follow the valve through the cycle.

### 3D leaflet model

Once the points are picked, the 3D view (bottom right of the MPR layout) shows a model of the leaflets for the current frame. It follows the cine and the chosen height reference.

- **Leaflets:** the atrial surface found by the height map (0.5 mm grid, lightly smoothed), coloured with the same scale as the prolapse map. Blue is below the reference (tenting), red above (prolapse). Steep jumps are left open, so gaps and the open orifice show as holes.
- **Annulus:** the traced 3D annulus in yellow, or the estimated outline (dashed grey) before tracing.
- **Labels:** the coaptation line (white), AL, PM, the coaptation centre, the AoV, and the segments A1–P3 (A, S and P for the TV).
- **Views:** **Surgical view** looks from the LA with the AoV at 12 o’clock, as in the key map; **From LV** looks from the ventricle. For the TV the buttons read **From RA** and **From RV**. **Model only** hides the volume rendering. The model is built once per frame and then cached.
- **Hover:** pointing at the leaflets shows the segment and the height at that point, for example “P2 · +3.1 mm above the 3D annulus (saddle)”.
- **Hide 3D leaflet model** in the MV or TV slicer section turns it off.

### Numbers and hover explanations

Every number uses the same units and rounding everywhere:

- **Units:** lengths and heights in mm with one decimal, areas in cm² with two, volumes in mL with two, angles in whole degrees. Distances measured in the MPR views stay in mm too.
- **Signs:** leaflet heights carry a sign, + towards the atrium (above the reference) and − towards the ventricle (below it). Depths below the reference (coaptation depth, tenting) are given as positive distances.
- **Missing values:** a dash means the value does not apply, for example no coaptation depth where the leaflets do not meet.
- **Consistency:** the cuts sample their lines more finely than the map, so the summary (highest point, deepest point, per segment) takes the more extreme of the two. No cut reads beyond the summary. The cycle charts use the same sampling as the panel, so a chart reads the same value as the panel for the frame on screen.
- **Open frames:** after **Analyse the cycle**, the prolapse and tenting sections warn when the frame on screen is open (diastole), because those are systolic measures.
- **Sanity check:** an annulus fit outside broad adult bounds (area 3–25 cm², height over 20 mm, AHCWR over 50%) is flagged as a likely tracing error.
- **Wall at the top of the search:** the leaflet surface is the first blood-to-tissue transition, so tissue where the search starts (atrial wall, aortic root) is not read as a leaflet at +15 mm.

Names and values with a dotted underline explain themselves on hover, keyboard focus or tap. Each explanation says what the number is, how it is measured and, where published, the normal or cut-off values with a link to the source:

- Mitral annulus normal values: [WASE study](https://pmc.ncbi.nlm.nih.gov/articles/PMC10257802/).
- Tricuspid annulus normal values: [Muraru et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9513148/).
- AHCWR: [Salgo et al. 2002](https://pure.psu.edu/en/publications/effect-of-annular-shape-on-leaflet-curvature-in-reducing-mitral-l/).
- Prolapse definition (> 2 mm): [review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5805573/).
- EVEREST criteria: [table](https://pmc.ncbi.nlm.nih.gov/articles/PMC6288214/).
- Tenting area and outcome: [Open Heart 2021](https://openheart.bmj.com/node/141927).
- Tenting volume: [functional MR vs controls](https://pmc.ncbi.nlm.nih.gov/articles/PMC7368231/).
- TV tethering: [Fukuda et al. 2005](https://pubmed.ncbi.nlm.nih.gov/?term=Fukuda+tricuspid+valve+tethering+predicts+residual+tricuspid+regurgitation+after+tricuspid+annuloplasty).

With the prolapse colours on, the surgical-view map reads out the segment and leaflet height under the cursor.

## TV slicer

1. Make one 2D view en-face to the tricuspid valve at the annulus level.
2. In **TV slicer**, press **Pick points** and click:
   1. the anteroseptal (A–S) commissure
   2. the posteroseptal (P–S) commissure
   3. the anteroposterior (A–P) commissure
   4. the centre of coaptation
3. Nine cuts open: three across each coaptation line (A–S, P–S, A–P) at ¼, ½ and ¾ of its length. Each cut is perpendicular to the line, so it shows the two leaflets that meet there.

Orientation:
- **RA→RV:** worked out from the commissure order. Seen from the RA, A–S → A–P → P–S runs clockwise. **Flip RA/RV** overrides it.
- **Key map:** an en-face view from the RA with the septal leaflet at 6 o'clock.

The prolapse map, per-cut gaps, point dragging, the 3D annulus, tenting and the cycle analysis work as in the MV slicer.

## Local development

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), upload your QLAB Cartesian DICOM, and the app opens the MPR workspace.

## Deploy to GitHub Pages

1. Enable **GitHub Pages** → Source: **GitHub Actions**
2. Push to `main` (or run the workflow manually)

Or deploy from your machine:

```bash
npm run deploy
```

Site URL (after first deploy):  
`https://diogopmartins.github.io/EchoMPR`

`homepage` in `package.json` must match your GitHub username/repo if forked.

## Stack

- React 18 (Create React App)
- `dicom-parser` + custom Philips3D volume loader
- Canvas MPR panes
- Three.js / React Three Fiber volume raymarching

## Privacy

All parsing and rendering happen in the browser. Nothing is uploaded to a remote API.
