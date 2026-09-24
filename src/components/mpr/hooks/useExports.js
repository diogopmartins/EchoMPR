import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { exportToNRRD } from '../../../utils/dicomParser';
import { encodeMjpegAvi } from '../../../utils/aviEncoder';
import {
  captureElementToCanvas,
  canvasToBlob,
  canvasToJpegBytes,
  downloadBlob,
  waitPaint,
  waitMs,
} from '../../../utils/captureLayout';

/**
 * PNG / AVI / NRRD export of the workspace. `exporting` is null, 'png', or
 * `{ kind: 'avi', i, n }` while a clip is being captured.
 */
export default function useExports({
  volume,
  timeIndex,
  setTimeIndex,
  viewportRef,
  setPlaying,
  maximizedPane,
  setMaximizedPane,
}) {
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    setExporting(null);
  }, [volume]);

  const exportNrrd = () => {
    if (!volume) return;
    try {
      const nrrd = exportToNRRD(volume, timeIndex);
      downloadBlob(
        new Blob([nrrd], { type: 'application/octet-stream' }),
        `echo_t${timeIndex}.nrrd`
      );
    } catch (err) {
      console.error(err);
    }
  };

  const exportPng = async () => {
    const el = viewportRef.current;
    if (!el || exporting) return;
    setExporting('png');
    try {
      await waitPaint();
      const canvas = captureElementToCanvas(el, { dpr: 2, even: false });
      const blob = await canvasToBlob(canvas, 'image/png');
      downloadBlob(blob, 'echo_mpr.png');
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(null);
    }
  };

  const exportAvi = async () => {
    const el = viewportRef.current;
    if (!el || !volume || exporting) return;
    const n = volume.dims.t;
    if (n <= 1) return;
    setPlaying(false);
    const prevMax = maximizedPane;
    setMaximizedPane(null);
    const startT = timeIndex;
    setExporting({ kind: 'avi', i: 0, n });
    try {
      await waitMs(90);
      await waitPaint();
      const frames = [];
      let width = 0;
      let height = 0;
      for (let t = 0; t < n; t++) {
        setExporting({ kind: 'avi', i: t + 1, n });
        flushSync(() => setTimeIndex(t));
        await waitPaint();
        await waitMs(45);
        const canvas = captureElementToCanvas(el, { dpr: 1.25, even: true });
        width = canvas.width;
        height = canvas.height;
        frames.push(await canvasToJpegBytes(canvas, 0.82));
      }
      const fps = Math.max(
        8,
        Math.min(30, Math.round(1000 / (volume.frameTimeMs || 50)))
      );
      const avi = encodeMjpegAvi(frames, { width, height, fps });
      downloadBlob(
        new Blob([avi], { type: 'video/x-msvideo' }),
        `echo_clip_${n}f.avi`
      );
    } catch (err) {
      console.error(err);
    } finally {
      flushSync(() => setTimeIndex(startT));
      setMaximizedPane(prevMax);
      setExporting(null);
    }
  };

  return { exporting, exportPng, exportAvi, exportNrrd };
}
