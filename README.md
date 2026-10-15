# EchoMPR

Browser-based **multi-planar reconstruction (MPR)** and 3D volume viewing for **Philips QLAB Cartesian** echocardiography DICOM. Runs entirely client-side and deploys to **GitHub Pages**.

## Features

- Upload a Philips QLAB Cartesian `.dcm` (drag-and-drop)
- Orthogonal MPR: axial / sagittal / coronal with linked crosshairs
- Window/level, slice scroll (mouse wheel), temporal cine
- GPU volume rendering (MIP or alpha composite) with optional cut planes
- Export current timepoint as NRRD
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
