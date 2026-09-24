import { useEffect, useRef, useState } from 'react';
import { voxelToMm } from '../../../utils/mprGeometry';
import {
  AI_LABEL_COLORS,
  DEFAULT_AI_LABELS,
  DEFAULT_AI_SPEC,
  argmaxLabels,
  resampleRoi,
  roiFromInputShape,
  roiLabelsToMasks,
} from '../../../utils/aiSegmentation';

const nextPaint = () => new Promise((resolve) => setTimeout(resolve, 30));

/**
 * Load an ONNX segmentation model chosen by the user and run it on a cube
 * around the crosshair (or the traced annulus centre). Results become
 * ordinary segments, so Paint/Erase and the 3D surface work on them.
 */
export default function useAiSegmentation({ volume, timeIndex, mprCenter, annulusFit, addMasks }) {
  const [model, setModel] = useState(null); // { name, runner, fixedRoi }
  const [spec, setSpec] = useState({ ...DEFAULT_AI_SPEC, labels: DEFAULT_AI_LABELS.join(', ') });
  const [centerOn, setCenterOn] = useState('crosshair');
  const [status, setStatus] = useState(null); // { kind: 'busy' | 'error' | 'done', text }
  const runningRef = useRef(false);

  useEffect(() => {
    setStatus(null);
  }, [volume]);

  const loadModel = async (file) => {
    if (!file) return;
    setStatus({ kind: 'busy', text: `Loading ${file.name}…` });
    try {
      const { createSession } = await import('../aiRunner');
      const runner = await createSession(await file.arrayBuffer());
      const fixedRoi = roiFromInputShape(runner.inputShape);
      if (fixedRoi) setSpec((s) => ({ ...s, roi: fixedRoi }));
      setModel({ name: file.name, runner, fixedRoi });
      setStatus({ kind: 'done', text: `Loaded ${file.name}${fixedRoi ? ` · input ${fixedRoi}³` : ''}` });
    } catch (err) {
      console.error(err);
      setModel(null);
      setStatus({ kind: 'error', text: `Could not load model: ${err.message || err}` });
    }
  };

  const centerMm = () =>
    centerOn === 'annulus' && annulusFit ? annulusFit.centroid : voxelToMm(volume, mprCenter);

  const run = async () => {
    if (!model || !volume || runningRef.current) return;
    runningRef.current = true;
    const t = timeIndex;
    const roiSpec = { roi: spec.roi, spacingMm: spec.spacingMm, centerMm: centerMm() };
    try {
      setStatus({ kind: 'busy', text: 'Resampling…' });
      await nextPaint();
      const cube = resampleRoi(volume, t, roiSpec);
      setStatus({ kind: 'busy', text: `Running model on ${spec.roi}³ (can take a minute)…` });
      await nextPaint();
      const started = performance.now();
      const { scores, classes } = await runCube(model.runner, cube, spec.roi);
      const labels = argmaxLabels(scores, classes);
      const masks = roiLabelsToMasks(labels, classes, volume, roiSpec);
      const names = spec.labels.split(',').map((s) => s.trim()).filter(Boolean);
      addMasks(
        masks.map((mask, i) => ({
          name: names[i] || `Class ${i + 1}`,
          mask,
          color: AI_LABEL_COLORS[i % AI_LABEL_COLORS.length],
        })),
        t
      );
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      setStatus({ kind: 'done', text: `Done in ${secs} s · ${classes - 1} classes on T${t + 1}` });
    } catch (err) {
      console.error(err);
      setStatus({ kind: 'error', text: `Inference failed: ${err.message || err}` });
    } finally {
      runningRef.current = false;
    }
  };

  return {
    model,
    spec,
    setSpec: (patch) => setSpec((s) => ({ ...s, ...patch })),
    centerOn,
    setCenterOn,
    status,
    loadModel,
    run,
    busy: status?.kind === 'busy',
  };
}

async function runCube(runner, cube, n) {
  const mod = await import('../aiRunner');
  return mod.runCube(runner, cube, n);
}
