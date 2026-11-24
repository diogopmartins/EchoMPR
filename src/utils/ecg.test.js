import { detectRPeaks, heartRateFromBeats } from './ecg';

function syntheticEcg({ hz = 500, seconds = 5, rr = 0.8, sign = 1, noise = 0.03 } = {}) {
  const n = Math.round(hz * seconds);
  const x = new Float32Array(n);
  const truth = [];
  let seed = 3;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (let t0 = 0.3; t0 < seconds - 0.1; t0 += rr) truth.push(Math.round(t0 * hz));
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    let v = 0.5 * Math.sin(2 * Math.PI * 0.3 * t) + noise * rand();
    truth.forEach((r) => {
      const tr = r / hz;
      v += sign * Math.exp(-(((t - tr) / 0.012) ** 2)); // QRS
      v += 0.3 * Math.exp(-(((t - tr - 0.28) / 0.045) ** 2)); // T wave
    });
    x[i] = 1000 * v;
  }
  return { x, hz, truth };
}

test('finds every R peak and the heart rate', () => {
  const { x, hz, truth } = syntheticEcg();
  const beats = detectRPeaks(x, hz);
  expect(beats.length).toBe(truth.length);
  beats.forEach((b, i) => expect(Math.abs(b - truth[i])).toBeLessThanOrEqual(5));
  expect(heartRateFromBeats(beats, hz)).toBe(75);
});

test('works on an inverted lead', () => {
  const { x, hz, truth } = syntheticEcg({ sign: -1, rr: 1 });
  const beats = detectRPeaks(x, hz);
  expect(beats.length).toBe(truth.length);
  beats.forEach((b, i) => expect(Math.abs(b - truth[i])).toBeLessThanOrEqual(5));
});

test('no beats in a flat or too short trace', () => {
  expect(detectRPeaks(new Float32Array(1000), 500)).toEqual([]);
  expect(detectRPeaks(new Float32Array(10), 500)).toEqual([]);
  expect(heartRateFromBeats([10], 500)).toBeNull();
});
