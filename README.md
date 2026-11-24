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

The app follows the valve axis from the atrial side and takes the first voxel bright enough to be tissue as the leaflet's atrial surface. Two consecutive samples must be above the tissue threshold, so single speckles are ignored. The threshold is set per frame, halfway between blood and leaflet tissue, and can be overridden in the side panel. Heights are measured from the plane of the picked points, so pick them at the annulus level.

- **Prolapse map:** leaflet height over the valve outline as a colour scale (red = towards the atrium), on the surgical-view map. Prolapse is a height over 2 mm. It reports the maximum, the area above 2 mm, the width along the coaptation line, and a table per segment (A1–P3 for the MV, A/S/P for the TV).
- **Per-cut measurements:** each cut shows the traced leaflet (red where above 2 mm), its maximum height and which leaflet, the length of the prolapsing part, and the **coaptation gap**. The gap is the stretch without tissue at the coaptation point, bounded by leaflets on both sides.

### TEER planning (MV)

- **Measure:** opens a cut (default A2/P2). Click, in order:
  1. the posterior hinge (annulus)
  2. the anterior hinge (annulus)
  3. the coaptation point (first contact)
  4. the posterior leaflet tip
  5. the anterior leaflet tip

  This gives the leaflet lengths, the annulus in that cut, coaptation depth (from the hinge line) and length, and the tip-to-tip gap.
- **Find MVA over the cycle:** in every frame, the planes between the valve level and 15 mm towards the LV are flood-filled from the coaptation centre. Regions that reach the valve outline are not enclosed by leaflets and are skipped. The smallest enclosed area per frame is the orifice, and the largest over the cycle is reported as the MVA.
- **Virtual clip:** closes a band across the orifice at the chosen cut. The band is the device width (4, 6 or 10 mm) plus 2 mm of approximated tissue on each side. This is a rough geometric estimate, not a validated predictor.
- **Criteria:** a table checks the values against the EVEREST anatomical criteria: coaptation length ≥ 2 mm, coaptation depth ≤ 11 mm, flail gap < 10 mm, flail width < 15 mm, posterior leaflet ≥ 10 mm, MVA ≥ 4.0 cm².

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

The prolapse map, per-cut gaps and point dragging work as in the MV slicer.

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
