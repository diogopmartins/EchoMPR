import type { DataSet } from 'dicom-parser';
import { TAG, readElementNumber, readElementString } from './dicomTags';
import type { EcgTrace, Volume } from './types';

function channelLooksLikeEcg(label: string): boolean {
  const s = (label || '').toUpperCase();
  return (
    s.includes('ECG') ||
    s.includes('EKG') ||
    s.includes('LEAD') ||
    /\bI{1,3}\b/.test(s) ||
    s.includes('V1') ||
    s.includes('V2') ||
    s.includes('V5') ||
    s.includes('V6')
  );
}

function movingAverage(x: ArrayLike<number>, win: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const half = Math.max(0, Math.floor(win / 2));
  let acc = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    while (hi < b) acc += x[++hi];
    while (lo < a) acc -= x[lo++];
    out[i] = acc / (hi - lo + 1);
  }
  return out;
}

function quantile(x: Float32Array, q: number): number {
  const sorted = Float32Array.from(x).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * Find R peaks with a light Pan–Tompkins style detector: remove baseline
 * wander, square the slope, integrate over ~120 ms, threshold, then take the
 * largest deflection (in the dominant QRS polarity) inside each detection.
 * Returns sample indices in ascending order.
 */
export function detectRPeaks(samples: ArrayLike<number>, sampleHz: number): number[] {
  const n = samples.length;
  if (!sampleHz || n < sampleHz * 0.5) return [];

  const baseline = movingAverage(samples, Math.round(sampleHz * 0.2));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - baseline[i];

  const slope = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) {
    const d = x[i + 1] - x[i - 1];
    slope[i] = d * d;
  }
  const energy = movingAverage(slope, Math.round(sampleHz * 0.12));

  const peak = quantile(energy, 0.99);
  if (!(peak > 0)) return [];
  const threshold = 0.3 * peak;

  // Dominant QRS polarity: some leads show R as a downward deflection.
  let maxPos = 0;
  let maxNeg = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] > maxPos) maxPos = x[i];
    if (-x[i] > maxNeg) maxNeg = -x[i];
  }
  const sign = maxNeg > maxPos * 1.2 ? -1 : 1;

  const refractory = Math.round(sampleHz * 0.25);
  const search = Math.round(sampleHz * 0.06);
  const beats: number[] = [];
  let i = 0;
  while (i < n) {
    if (energy[i] < threshold) {
      i++;
      continue;
    }
    let end = i;
    while (end < n && energy[end] >= threshold) end++;
    let best = -1;
    let bestVal = -Infinity;
    for (let k = Math.max(0, i - search); k < Math.min(n, end + search); k++) {
      const v = sign * x[k];
      if (v > bestVal) {
        bestVal = v;
        best = k;
      }
    }
    const last = beats[beats.length - 1];
    if (last === undefined || best - last >= refractory) {
      beats.push(best);
    } else if (sign * x[best] > sign * x[last]) {
      beats[beats.length - 1] = best;
    }
    i = end + 1;
  }
  return beats;
}

/** Heart rate from the median R–R interval, or null with fewer than two beats. */
export function heartRateFromBeats(beats: number[], sampleHz: number): number | null {
  if (beats.length < 2 || !sampleHz) return null;
  const rr = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const median = rr[Math.floor(rr.length / 2)];
  return median > 0 ? (60 * sampleHz) / median : null;
}

/**
 * Standard DICOM Waveform Sequence (5400,0100), used by many ultrasound carts.
 */
export function parseDicomWaveform(dataSet: DataSet, arrayBuffer: ArrayBuffer): EcgTrace | null {
  const seq = dataSet.elements[TAG.waveformSequence];
  if (!seq?.items?.length) return null;

  for (const item of seq.items) {
    const ds = item.dataSet;
    if (!ds) continue;
    const nChan = readElementNumber(ds, 'x003a0005') || 1;
    const nSamp = readElementNumber(ds, 'x003a0010');
    const freq = readElementNumber(ds, 'x003a001a');
    const bits = readElementNumber(ds, 'x54001004') || 16;
    const waveEl = ds.elements.x54001010;
    if (!nSamp || !freq || !waveEl || nSamp < 8) continue;

    let label = 'ECG';
    let chan = 0;
    const chSeq = ds.elements.x003a0200;
    if (chSeq?.items?.length) {
      const labels = chSeq.items.map((ch) => {
        const cds = ch.dataSet;
        if (!cds) return '';
        const src = cds.elements.x003a0203;
        let meaning =
          readElementString(cds, 'x003a0202') || readElementString(cds, 'x003a0208');
        const srcDs = src?.items?.[0]?.dataSet;
        if (srcDs) {
          meaning =
            readElementString(srcDs, 'x00080104') ||
            readElementString(srcDs, 'x00080100') ||
            meaning;
        }
        return meaning;
      });
      const ecgIdx = labels.findIndex(channelLooksLikeEcg);
      if (ecgIdx >= 0 && ecgIdx < nChan) chan = ecgIdx;
      label = labels[ecgIdx >= 0 ? ecgIdx : 0] || 'ECG';
    }

    const bytesPer = bits > 8 ? 2 : 1;
    const totalSamples = Math.floor(waveEl.length / bytesPer);
    const usable = Math.min(nSamp * nChan, totalSamples);
    if (usable < 8) continue;

    const view = new DataView(arrayBuffer, waveEl.dataOffset, usable * bytesPer);
    const samples = new Float32Array(nSamp);
    for (let i = 0; i < nSamp; i++) {
      const idx = i * nChan + chan;
      if (idx >= usable) break;
      samples[i] = bytesPer === 2 ? view.getInt16(idx * 2, true) : view.getInt8(idx);
    }

    const beats = detectRPeaks(samples, freq);
    return {
      source: 'dicom-waveform',
      label,
      samples,
      sampleHz: freq,
      durationMs: (nSamp / freq) * 1000,
      beats,
      heartRateBpm:
        readElementNumber(dataSet, TAG.heartRate) ?? heartRateFromBeats(beats, freq),
    };
  }
  return null;
}

export function extractEcg(
  dataSet: DataSet | null | undefined,
  arrayBuffer: ArrayBuffer
): EcgTrace | null {
  return dataSet ? parseDicomWaveform(dataSet, arrayBuffer) : null;
}

export function getVolumeEcg(volume: Pick<Volume, 'ecg'> | null | undefined): EcgTrace | null {
  if (volume?.ecg?.source === 'dicom-waveform') return volume.ecg;
  return null;
}

/** Map cine frame → sample index for the playhead. */
export function frameToSampleIndex(
  ecg: Pick<EcgTrace, 'samples'> | null | undefined,
  frameIndex: number,
  frameCount: number
): number {
  if (!ecg?.samples?.length) return 0;
  if (ecg.samples.length === frameCount) {
    return Math.max(0, Math.min(ecg.samples.length - 1, frameIndex | 0));
  }
  const tCount = Math.max(1, frameCount - 1);
  return Math.round((frameIndex / tCount) * (ecg.samples.length - 1));
}

export function sampleIndexToFrame(
  ecg: Pick<EcgTrace, 'samples'> | null | undefined,
  sampleIndex: number,
  frameCount: number
): number {
  if (!ecg?.samples?.length || frameCount <= 1) return 0;
  if (ecg.samples.length === frameCount) {
    return Math.max(0, Math.min(frameCount - 1, sampleIndex | 0));
  }
  const tCount = Math.max(1, frameCount - 1);
  return Math.max(
    0,
    Math.min(
      frameCount - 1,
      Math.round((sampleIndex / (ecg.samples.length - 1)) * tCount)
    )
  );
}
