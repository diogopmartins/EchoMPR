# EchoMPR

Browser-based **multi-planar reconstruction (MPR)** and 3D volume viewing for **Philips QLAB Cartesian** echocardiography DICOM. Runs entirely client-side and deploys to **GitHub Pages**.

## Features

- Upload a Philips QLAB Cartesian `.dcm` (drag-and-drop)
- Orthogonal MPR: axial / sagittal / coronal with linked crosshairs
- Window/level, slice scroll (mouse wheel), temporal cine
- GPU volume rendering (MIP or alpha composite) with optional cut planes
- Export current timepoint as NRRD
- Mitral annulus tracing on rotated planes with area, perimeter, diameters, saddle height, and AHCWR
- Seeded 3D segmentation (region growing + brush) with volume over the cardiac cycle and EF
- AI segmentation: run your own ONNX model (e.g. mitral leaflets trained on MVSeg2023) in the browser
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

## Mitral annulus

1. Tilt and move the planes so the **blue (axial)** plane lies across the annulus, with the crosshair at the valve centre.
2. Open **Mitral annulus**, choose the number of planes (4–12), and press **Start**.
3. In the **red (sagittal)** view, click the two hinge points. The red and green planes then rotate by 180°/N about the valve axis; repeat until done. Use **Undo** to step back.

The points are fitted with a best-fit plane and a closed Fourier curve (radius and height against angle). The app reports:
- projected (2D) and 3D area
- perimeter
- maximum and minimum diameter through the centroid (≈ commissural / anteroposterior)
- saddle height
- annular height to commissural width ratio (AHCWR)

## Segmentation

- **Seed**: click inside a chamber and the blood pool is grown in 3D. The automatic threshold sits halfway between the seed and the surrounding wall.
  - **Leak cut** stops growth through thin gaps into neighbouring chambers.
  - **Smooth** reduces speckle.
- **Paint / Erase**: brush edits on the current plane; **New empty** starts a hand-drawn segmentation.
- **Grow all frames**: repeats the grow on every timepoint and plots volume over the cycle, with max/min volume and EF.

Masks are drawn on every plane and as a surface in the 3D view.

## AI segmentation

The app runs an ONNX model you load from disk, using ONNX Runtime Web (WebAssembly, fetched only when first used). Nothing is uploaded.

Model contract (see `src/utils/aiSegmentation.ts`):

| | |
|---|---|
| Input | `float32 [1, 1, D, H, W]`: a cube centred on the crosshair (or the traced annulus), axes `(z, y, x)` of the volume, intensities 0–255 scaled to 0–1 |
| Output | `float32 [1, C, D, H, W]`: class scores; argmax gives the label, 0 = background |
| Settings | Input size (read from the model when it is fixed), spacing in mm, label names |

To train a mitral leaflet model on the public [MVSeg2023](https://huggingface.co/datasets/pcarnahan/MVSeg2023) 3D TEE dataset (labels: 1 posterior, 2 anterior leaflet):

```bash
pip install -r scripts/requirements-train.txt
python scripts/train_mvseg.py --data /path/to/MVSeg2023 --epochs 300   # GPU recommended
# -> runs/mvseg/mvseg_segresnet_128.onnx (input 128³ at 0.6 mm)
```

Then load the `.onnx` file in **AI segmentation**, set spacing to 0.6 mm, put the crosshair at the valve, and press **Run on this frame**.
- **Speed:** a 128³ model takes tens of seconds, because it runs on one CPU thread in the browser.
- **Licence:** check the dataset licence before any use beyond research.
- **Orientation:** the model is trained with random flips and rotations so it tolerates how the volume is oriented. Always check the result by eye.

## Local development

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), upload your QLAB Cartesian DICOM, and the app opens the MPR workspace.

### Checks

```bash
npm test -- --watchAll=false   # unit tests
npm run typecheck              # TypeScript (src/utils is TS, components are JS for now)
DICOM_FILE=path/to/file.dcm npm run smoke   # parse a real export with the app's loader
```

The smoke test defaults to `./1.dcm` and is skipped when that file does not exist.
It prints the dimensions, spacing, frame time, and ECG summary, and checks that
`PixelData` holds exactly `T × Z` slices.

### Layout

- `src/utils/` — TypeScript: DICOM tags, Philips volume loader, MPR geometry, ECG, measurements, exports
- `src/components/MPRViewer.js` — workspace shell
- `src/components/mpr/` — slice/3D panes, sidebar panels, and hooks (`useViewerSettings`, `useMeasurements`, `useCine`, `useExports`)

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
- TypeScript for the data/geometry layer (`src/utils`)
- `dicom-parser` + custom Philips3D volume loader
- Canvas MPR panes
- Three.js / React Three Fiber volume raymarching and marching-cubes surfaces
- ONNX Runtime Web for optional in-browser AI segmentation

## Privacy

All parsing and rendering happen in the browser. Nothing is uploaded to a remote API.
