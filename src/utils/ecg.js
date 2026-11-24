import { readElementNumber } from './philipsVolume';

function readString(dataSet, tag) {
  const el = dataSet.elements[tag];
  if (!el || el.length === 0) return '';
  try {
    return dataSet.string(tag) || '';
  } catch {
    return '';
  }
}

function channelLooksLikeEcg(label) {
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

/**
 * Standard DICOM Waveform Sequence (5400,0100), used by many ultrasound carts.
 */
export function parseDicomWaveform(dataSet, arrayBuffer) {
  const seq = dataSet.elements.x54000100;
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
    const chSeq = ds.elements.x003a0200;
    if (chSeq?.items?.length) {
      const labels = chSeq.items.map((ch) => {
        const cds = ch.dataSet;
        if (!cds) return '';
        const src = cds.elements.x003a0203;
        let meaning = readString(cds, 'x003a0202') || readString(cds, 'x003a0208');
        if (src?.items?.[0]?.dataSet) {
          meaning =
            readString(src.items[0].dataSet, 'x00080104') ||
            readString(src.items[0].dataSet, 'x00080100') ||
            meaning;
        }
        return meaning;
      });
      const ecgIdx = labels.findIndex(channelLooksLikeEcg);
      label = labels[ecgIdx >= 0 ? ecgIdx : 0] || 'ECG';
    }

    const bytesPer = bits > 8 ? 2 : 1;
    const totalSamples = Math.floor(waveEl.length / bytesPer);
    const usable = Math.min(nSamp * nChan, totalSamples);
    if (usable < 8) continue;

    const view = new DataView(
      arrayBuffer,
      waveEl.dataOffset,
      usable * bytesPer
    );
    const chan = 0;
    const samples = new Float32Array(nSamp);
    for (let i = 0; i < nSamp; i++) {
      const idx = i * nChan + chan;
      if (idx >= usable) break;
      samples[i] =
        bytesPer === 2 ? view.getInt16(idx * 2, true) : view.getInt8(idx);
    }

    const beats = detectRPeaks(samples, freq);
    return {
      source: 'dicom-waveform',
      label,
      samples,
      sampleHz: freq,
      durationMs: (nSamp / freq) * 1000,
      beats,
      heartRateBpm: readElementNumber(dataSet, 'x00181088') || heartRateFromBeats(beats, freq),
    };
  }
  return null;
}

/** Centred moving average over `win` samples (prefix sums). */
function movingAverage(x, win) {
  const n = x.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  const half = Math.floor(win / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  return out;
}

/**
 * R-peak detection in the spirit of Pan & Tompkins (1985): baseline removed,
 * squared slope integrated over ~120 ms, a threshold at 30% of the high
 * (98th percentile) energy, and a 250 ms refractory period. In each QRS the
 * peak is the largest deflection, so inverted leads work too.
 * Returns sample indices.
 */
export function detectRPeaks(samples, sampleHz) {
  const n = samples?.length || 0;
  if (!sampleHz || n < sampleHz * 0.6) return [];
  const win = (sec) => Math.max(1, Math.round(sec * sampleHz));
  const base = movingAverage(samples, win(0.25));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - base[i];
  const slope = new Float32Array(n);
  for (let i = 1; i < n; i++) slope[i] = (x[i] - x[i - 1]) ** 2;
  const energy = movingAverage(slope, win(0.12));
  const sorted = Float32Array.from(energy).sort();
  const high = sorted[Math.floor(0.98 * (n - 1))];
  if (!(high > 0)) return [];
  const threshold = 0.3 * high;
  const refractory = win(0.25);
  const peaks = [];
  let i = 0;
  while (i < n) {
    if (energy[i] < threshold) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && energy[j] >= threshold) j++;
    const a = Math.max(0, i - win(0.08));
    const b = Math.min(n - 1, j + win(0.02));
    let best = a;
    for (let k = a; k <= b; k++) if (Math.abs(x[k]) > Math.abs(x[best])) best = k;
    const last = peaks.length - 1;
    if (last < 0 || best - peaks[last] >= refractory) peaks.push(best);
    else if (Math.abs(x[best]) > Math.abs(x[peaks[last]])) peaks[last] = best;
    i = j;
  }
  return peaks;
}

/** Heart rate (bpm) from the median R–R interval, or null with fewer than 2 beats. */
export function heartRateFromBeats(beats, sampleHz) {
  if (!beats || beats.length < 2 || !sampleHz) return null;
  const rr = [];
  for (let i = 1; i < beats.length; i++) rr.push(beats[i] - beats[i - 1]);
  rr.sort((a, b) => a - b);
  return Math.round((60 * sampleHz) / rr[Math.floor(rr.length / 2)]);
}

export function extractEcg(dataSet, arrayBuffer) {
  return dataSet ? parseDicomWaveform(dataSet, arrayBuffer) : null;
}

export function getVolumeEcg(volume) {
  if (volume?.ecg?.source === 'dicom-waveform') return volume.ecg;
  return null;
}

/** Map cine frame → sample index for the playhead. */
export function frameToSampleIndex(ecg, frameIndex, frameCount) {
  if (!ecg?.samples?.length) return 0;
  if (ecg.samples.length === frameCount) {
    return Math.max(0, Math.min(ecg.samples.length - 1, frameIndex | 0));
  }
  const tCount = Math.max(1, frameCount - 1);
  return Math.round((frameIndex / tCount) * (ecg.samples.length - 1));
}

export function sampleIndexToFrame(ecg, sampleIndex, frameCount) {
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
