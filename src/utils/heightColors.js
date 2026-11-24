/** Leaflet height colour scale (mm, positive towards the atrium), shared by the key map and the 3D model. */
const STOPS = [
  [-4, [66, 135, 245]],
  [0, [225, 225, 225]],
  [2, [255, 235, 59]],
  [6, [244, 67, 54]],
  [10, [156, 39, 176]],
];
export const HEIGHT_RANGE = [STOPS[0][0], STOPS[STOPS.length - 1][0]];

export function heightColor(h) {
  if (h <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [h1, c1] = STOPS[i];
    if (h <= h1) {
      const [h0, c0] = STOPS[i - 1];
      const f = (h - h0) / (h1 - h0);
      return c0.map((v, k) => Math.round(v + f * (c1[k] - v)));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** CSS gradient matching heightColor over HEIGHT_RANGE. */
export function heightGradientCss() {
  const [lo, hi] = HEIGHT_RANGE;
  const stops = STOPS.map(([h, c]) => `rgb(${c.join(',')}) ${(((h - lo) / (hi - lo)) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
