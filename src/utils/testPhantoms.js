/**
 * Synthetic valve volumes for unit tests (not used by the app).
 * Volume-local mm, 0.5 mm voxels, valve plane z = 20 mm, ventricle towards +z.
 */

const SP = 0.5;
const DIMS = { x: 96, y: 96, z: 80 };

function makeVolume(frames, valueAt) {
  const n = DIMS.x * DIMS.y * DIMS.z;
  const voxels = new Uint8Array(n * frames);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let o = 0;
  for (let t = 0; t < frames; t++) {
    for (let k = 0; k < DIMS.z; k++) {
      for (let j = 0; j < DIMS.y; j++) {
        for (let i = 0; i < DIMS.x; i++) {
          const v = valueAt(t, i * SP, j * SP, k * SP);
          voxels[o++] = v == null ? 10 + 25 * rand() : v;
        }
      }
    }
  }
  return {
    dims: { t: frames, ...DIMS },
    spacingCm: { x: SP / 10, y: SP / 10, z: SP / 10 },
    voxels,
    volumeSize: n,
    frameTimeMs: 40,
  };
}

// ---------------------------------------------------------------- Mitral --
// Annulus: ellipse centred (24, 28), radius 12 (AL–PM, x) by 10 (AP, y),
// anterior is −y. AoV: ring of radius 7 mm around (24, 8, 23).
export const MV_POINTS = {
  al: [12, 30, 20],
  mid: [24, 31, 20],
  pm: [36, 30, 20],
  ao: [24, 8, 23],
};

/** Diastolic orifice: ellipse 9 mm (x) by 5 mm (y) around (24, 30.5). */
export const MV_ORIFICE = { cx: 24, cy: 30.5, a: 9, b: 5 };
export const MV_PROLAPSE_MM = 6;

const coaptY = (x) => 30 + 1 * (1 - ((x - 24) / 12) ** 2);

function mvLeafletZ(x, y, amp) {
  if (y > coaptY(x) && x > 20 && x < 28) {
    const fy = Math.sin((Math.PI * (y - coaptY(x))) / (37.5 - coaptY(x)));
    const fx = Math.sin((Math.PI * (x - 20)) / 8);
    return 20 - amp * Math.max(0, fx) * Math.max(0, fy);
  }
  return 20;
}

/** Frame 0: diastole (open orifice, no prolapse). Frame 1: systole (P2 prolapse). */
export function mitralPhantom() {
  return makeVolume(2, (t, x, y, z) => {
    const inAnn = ((x - 24) / 12) ** 2 + ((y - 28) / 10) ** 2 <= 1;
    if (Math.abs(Math.hypot(x - 24, y - 8, z - 23) - 7) < 0.8) return 190;
    if (!inAnn) return null;
    if (t === 0) {
      const o = MV_ORIFICE;
      const inHole = ((x - o.cx) / o.a) ** 2 + ((y - o.cy) / o.b) ** 2 <= 1;
      return !inHole && Math.abs(z - 20) < 0.8 ? 215 : null;
    }
    return Math.abs(z - mvLeafletZ(x, y, MV_PROLAPSE_MM)) < 0.8 ? 215 : null;
  });
}

// ------------------------------------------------------------- Tricuspid --
// Seen from the RA (x right, y down, +z into the RV): septal leaflet at the
// bottom, A–S lower left, A–P top, P–S lower right. A 4 mm coaptation gap
// runs along the A–S line from the centre to the commissure.
export const TV_C = [24, 24, 20];
const tvAt = (deg, r) => [
  TV_C[0] + r * Math.cos((deg * Math.PI) / 180),
  TV_C[1] + r * Math.sin((deg * Math.PI) / 180),
  20,
];
export const TV_POINTS = { as: tvAt(150, 16), ap: tvAt(-90, 18), ps: tvAt(30, 16), c: TV_C };
export const TV_GAP_MM = 4;

export function tricuspidPhantom() {
  const dir = [Math.cos((150 * Math.PI) / 180), Math.sin((150 * Math.PI) / 180)];
  return makeVolume(1, (t, x, y, z) => {
    const dx = x - TV_C[0];
    const dy = y - TV_C[1];
    if (Math.hypot(dx, dy) > 17 || Math.abs(z - 20) >= 0.8) return null;
    const along = dx * dir[0] + dy * dir[1];
    const perp = Math.abs(-dx * dir[1] + dy * dir[0]);
    if (along > 0 && along < 16.5 && perp < TV_GAP_MM / 2) return null;
    return 215;
  });
}
