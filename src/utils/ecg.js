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

function smooth3(values) {
  const n = values.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = values[(i - 1 + n) % n];
    const b = values[i];
    const c = values[(i + 1) % n];
    out[i] = (a + b + c) / 3;
  }
  return out;
}

function findPeaks(values, minSep) {
  const n = values.length;
  if (n < 3) return [];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;
  let varr = 0;
  for (let i = 0; i < n; i++) varr += (values[i] - mean) ** 2;
  const std = Math.sqrt(varr / n) || 1;
  const thr = mean + 0.2 * std;
  const sep = Math.max(3, minSep);

  const collect = (minVal) => {
    const cands = [];
    for (let i = 0; i < n; i++) {
      const l = values[(i - 1 + n) % n];
      const r = values[(i + 1) % n];
      if (values[i] >= l && values[i] >= r && values[i] >= minVal) {
        cands.push({ i, v: values[i] });
      }
    }
    cands.sort((a, b) => b.v - a.v);
    const kept = [];
    for (const c of cands) {
      const ok = kept.every((k) => {
        const d = Math.abs(c.i - k);
        return Math.min(d, n - d) >= sep;
      });
      if (ok) kept.push(c.i);
    }
    return kept.sort((a, b) => a - b);
  };

  let kept = collect(thr);
  if (kept.length < 2) kept = collect(-Infinity);
  return kept;
}

function heartRateBpm(beats, frameCount, frameTimeMs) {
  if (!beats.length || !frameTimeMs || frameCount < 2) return null;
  const rr = [];
  if (beats.length === 1) return null;
  for (let i = 1; i < beats.length; i++) rr.push(beats[i] - beats[i - 1]);
  rr.push(beats[0] + frameCount - beats[beats.length - 1]);
  rr.sort((a, b) => a - b);
  const med = rr[Math.floor(rr.length / 2)];
  if (med <= 0) return null;
  return 60000 / (med * frameTimeMs);
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

    return {
      source: 'dicom-waveform',
      label,
      samples,
      sampleHz: freq,
      durationMs: (nSamp / freq) * 1000,
      beats: [],
      heartRateBpm: readElementNumber(dataSet, 'x00181088'),
    };
  }
  return null;
}

/**
 * This QLAB Cartesian export has no waveform module. Infer a cycle trace
 * from 4D motion (systolic peaks) so cine can still sync to the heartbeat.
 */
export function deriveCardiacCycle(volume) {
  if (!volume?.voxels || volume.dims.t < 4) return null;
  const { dims, voxels, volumeSize, frameTimeMs } = volume;
  const t = dims.t;
  const step = volumeSize > 1.5e6 ? 16 : 8;
  const motion = new Float32Array(t);

  for (let ti = 0; ti < t; ti++) {
    const a = ti * volumeSize;
    const b = ((ti + t - 1) % t) * volumeSize;
    let d = 0;
    let n = 0;
    for (let i = 0; i < volumeSize; i += step) {
      d += Math.abs(voxels[a + i] - voxels[b + i]);
      n += 1;
    }
    motion[ti] = n ? d / n : 0;
  }

  const samples = smooth3(smooth3(motion));
  const beats = findPeaks(samples, Math.max(4, Math.round(t / 6)));
  const bpm = heartRateBpm(beats, t, frameTimeMs || 50);

  return {
    source: 'volume-cycle',
    version: 2,
    label: 'Cardiac cycle',
    samples,
    sampleHz: 1000 / (frameTimeMs || 50),
    durationMs: t * (frameTimeMs || 50),
    beats,
    heartRateBpm: bpm,
  };
}

export function extractEcg(dataSet, arrayBuffer, volume) {
  const wave = dataSet ? parseDicomWaveform(dataSet, arrayBuffer) : null;
  if (wave) return wave;
  return deriveCardiacCycle(volume);
}

export function getVolumeEcg(volume) {
  if (!volume) return null;
  if (volume.ecg?.source === 'dicom-waveform') return volume.ecg;
  if (volume.ecg?.source === 'volume-cycle' && volume.ecg.version === 2) {
    return volume.ecg;
  }
  volume.ecg = deriveCardiacCycle(volume);
  return volume.ecg;
}

/** Map cine frame → sample index for the playhead. */
export function frameToSampleIndex(ecg, frameIndex, frameCount) {
  if (!ecg?.samples?.length) return 0;
  if (ecg.source === 'volume-cycle' || ecg.samples.length === frameCount) {
    return Math.max(0, Math.min(ecg.samples.length - 1, frameIndex | 0));
  }
  const tCount = Math.max(1, frameCount - 1);
  return Math.round((frameIndex / tCount) * (ecg.samples.length - 1));
}

export function sampleIndexToFrame(ecg, sampleIndex, frameCount) {
  if (!ecg?.samples?.length || frameCount <= 1) return 0;
  if (ecg.source === 'volume-cycle' || ecg.samples.length === frameCount) {
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
