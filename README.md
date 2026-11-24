# EchoMPR

Browser-based **multi-planar reconstruction (MPR)** and 3D volume viewing for **Philips QLAB Cartesian** echocardiography DICOM. Runs entirely client-side and deploys to **GitHub Pages**.

## Features

- Upload a Philips QLAB Cartesian `.dcm` (drag-and-drop)
- Orthogonal MPR: axial / sagittal / coronal with linked crosshairs
- Slice scroll (mouse wheel), temporal cine
- GPU volume rendering (MIP or alpha composite) with optional cut planes
- Export current timepoint as NRRD
- MV slicer: nine long-axis cuts across the mitral valve to find prolapsing scallops
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
