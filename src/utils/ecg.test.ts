import * as dicomParser from 'dicom-parser';
import { detectRPeaks, heartRateFromBeats, parseDicomWaveform } from './ecg';

const HZ = 500;

/** Seeded PRNG so noisy cases are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

interface SynthOptions {
  bpm?: number;
  seconds?: number;
  rAmp?: number;
  tAmp?: number;
  noise?: number;
  wander?: number;
  firstR?: number;
}

/** Gaussian P-QRS-T beats; returns the samples and the true R sample indices. */
function synthEcg({
  bpm = 75,
  seconds = 10,
  rAmp = 900,
  tAmp = 180,
  noise = 0,
  wander = 0,
  firstR = 0.3,
}: SynthOptions = {}) {
  const n = Math.round(seconds * HZ);
  const period = 60 / bpm;
  const rand = rng(42);
  const samples = new Float32Array(n);
  const rTimes: number[] = [];
  for (let t = firstR; t < seconds; t += period) rTimes.push(t);
  const g = (t: number, mu: number, sd: number) => Math.exp(-(((t - mu) / sd) ** 2));
  for (let i = 0; i < n; i++) {
    const t = i / HZ;
    let v = wander * Math.sin(2 * Math.PI * 0.3 * t) + noise * rand();
    for (const r of rTimes) {
      if (Math.abs(t - r) > 0.6) continue;
      v += 80 * g(t, r - 0.16, 0.025); // P
      v -= 90 * g(t, r - 0.025, 0.008); // Q
      v += rAmp * g(t, r, 0.012); // R
      v -= 160 * g(t, r + 0.025, 0.01); // S
      v += tAmp * g(t, r + 0.25, 0.05); // T
    }
    samples[i] = v;
  }
  return { samples, truth: rTimes.map((r) => Math.round(r * HZ)) };
}

function expectBeatsNear(beats: number[], truth: number[], tolMs = 10) {
  expect(beats).toHaveLength(truth.length);
  const tol = (tolMs / 1000) * HZ;
  beats.forEach((b, i) => expect(Math.abs(b - truth[i])).toBeLessThanOrEqual(tol));
}

describe('detectRPeaks', () => {
  test('finds every R peak on a clean trace', () => {
    const { samples, truth } = synthEcg();
    expectBeatsNear(detectRPeaks(samples, HZ), truth);
  });

  test('handles an inverted lead', () => {
    const { samples, truth } = synthEcg();
    const inverted = samples.map((v) => -v);
    expectBeatsNear(detectRPeaks(inverted, HZ), truth);
  });

  test('ignores baseline wander, noise, and tall T waves', () => {
    const { samples, truth } = synthEcg({ noise: 60, wander: 300, tAmp: 450 });
    expectBeatsNear(detectRPeaks(samples, HZ), truth);
  });

  test('works across heart rates', () => {
    for (const bpm of [45, 120, 170]) {
      const { samples, truth } = synthEcg({ bpm });
      expectBeatsNear(detectRPeaks(samples, HZ), truth);
    }
  });

  test('returns nothing for a flat or too-short signal', () => {
    expect(detectRPeaks(new Float32Array(5000), HZ)).toEqual([]);
    expect(detectRPeaks(new Float32Array(100).fill(3), HZ)).toEqual([]);
    expect(detectRPeaks(new Float32Array(5000), 0)).toEqual([]);
  });
});

describe('heartRateFromBeats', () => {
  test('uses the median R–R interval', () => {
    // 400-sample intervals at 500 Hz = 0.8 s = 75 bpm, with one outlier
    expect(heartRateFromBeats([0, 400, 800, 1200, 1350, 1750], HZ)).toBeCloseTo(75);
  });

  test('needs at least two beats', () => {
    expect(heartRateFromBeats([100], HZ)).toBeNull();
    expect(heartRateFromBeats([], HZ)).toBeNull();
  });
});

// --- Minimal explicit-VR little-endian dataset builder for waveform tests ---

const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const le32 = (v: number) => [...le16(v & 0xffff), ...le16((v >>> 16) & 0xffff)];
const ascii = (s: string) => {
  const bytes = Array.from(s, (c) => c.charCodeAt(0));
  return bytes.length % 2 ? [...bytes, 0x20] : bytes;
};

function el(group: number, elem: number, vr: string, value: number[]): number[] {
  const head = [...le16(group), ...le16(elem), ...ascii(vr)];
  if (['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr)) {
    return [...head, 0, 0, ...le32(value.length), ...value];
  }
  return [...head, ...le16(value.length), ...value];
}

const item = (content: number[]) => [...le16(0xfffe), ...le16(0xe000), ...le32(content.length), ...content];

function waveformDataSet(channels: { label: string; samples: Float32Array }[], heartRate?: number) {
  const nSamp = channels[0].samples.length;
  const interleaved: number[] = [];
  for (let i = 0; i < nSamp; i++) {
    for (const ch of channels) interleaved.push(...le16(Math.round(ch.samples[i]) & 0xffff));
  }
  const chanDefs = channels.flatMap((ch) =>
    item(el(0x003a, 0x0203, 'SQ', item(el(0x0008, 0x0104, 'LO', ascii(ch.label)))))
  );
  const waveform = item([
    ...el(0x003a, 0x0005, 'US', le16(channels.length)),
    ...el(0x003a, 0x0010, 'UL', le32(nSamp)),
    ...el(0x003a, 0x001a, 'DS', ascii(String(HZ))),
    ...el(0x003a, 0x0200, 'SQ', chanDefs),
    ...el(0x5400, 0x1004, 'US', le16(16)),
    ...el(0x5400, 0x1010, 'OW', interleaved),
  ]);
  const bytes = new Uint8Array([
    ...(heartRate ? el(0x0018, 0x1088, 'IS', ascii(String(heartRate))) : []),
    ...el(0x5400, 0x0100, 'SQ', waveform),
  ]);
  const dataSet = dicomParser.parseDicom(bytes, { TransferSyntaxUID: '1.2.840.10008.1.2.1' });
  return { dataSet, buffer: bytes.buffer };
}

describe('parseDicomWaveform', () => {
  test('reads the channel labelled as ECG, not just the first one', () => {
    const { samples: ecg, truth } = synthEcg({ seconds: 4 });
    const resp = new Float32Array(ecg.length).map((_, i) => 200 * Math.sin(i / 300));
    const { dataSet, buffer } = waveformDataSet([
      { label: 'Respiration', samples: resp },
      { label: 'ECG Lead II', samples: ecg },
    ]);
    const trace = parseDicomWaveform(dataSet, buffer);
    expect(trace?.label).toBe('ECG Lead II');
    expect(Array.from(trace?.samples.slice(0, 50) ?? [])).toEqual(
      Array.from(ecg.slice(0, 50)).map(Math.round)
    );
    expectBeatsNear(trace?.beats ?? [], truth);
  });

  test('prefers the HeartRate tag and falls back to detected beats', () => {
    const { samples } = synthEcg({ seconds: 6, bpm: 60 });
    const withTag = waveformDataSet([{ label: 'ECG', samples }], 72);
    expect(parseDicomWaveform(withTag.dataSet, withTag.buffer)?.heartRateBpm).toBe(72);
    const noTag = waveformDataSet([{ label: 'ECG', samples }]);
    expect(parseDicomWaveform(noTag.dataSet, noTag.buffer)?.heartRateBpm).toBeCloseTo(60, 0);
  });
});
