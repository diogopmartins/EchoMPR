/** Minimal Motion-JPEG AVI muxer (no extra dependencies). */

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n >>> 0, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function fourcc(s) {
  return new Uint8Array([
    s.charCodeAt(0),
    s.charCodeAt(1),
    s.charCodeAt(2),
    s.charCodeAt(3),
  ]);
}

function concat(chunks) {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function padEven(bytes) {
  if (bytes.length % 2 === 0) return bytes;
  const p = new Uint8Array(bytes.length + 1);
  p.set(bytes);
  return p;
}

function list(type, data) {
  return concat([fourcc('LIST'), u32(data.length + 4), fourcc(type), data]);
}

/**
 * @param {Uint8Array[]} jpegFrames
 * @param {{ width: number, height: number, fps?: number }} opts
 */
export function encodeMjpegAvi(jpegFrames, { width, height, fps = 20 }) {
  if (!jpegFrames?.length) {
    throw new Error('No frames to encode');
  }
  const w = width & ~1;
  const h = height & ~1;
  const rate = Math.max(1, Math.round(fps));
  const usec = Math.max(1, Math.round(1e6 / rate));
  const frames = jpegFrames.map(padEven);
  const maxBytes = frames.reduce((m, f) => Math.max(m, f.length), 0);
  const n = frames.length;

  const moviParts = [];
  const indexParts = [];
  let offset = 4;
  for (const jpeg of frames) {
    moviParts.push(fourcc('00dc'), u32(jpeg.length), jpeg);
    indexParts.push(fourcc('00dc'), u32(0x10), u32(offset), u32(jpeg.length));
    offset += 8 + jpeg.length;
  }
  const moviData = concat(moviParts);
  const idx1Data = concat(indexParts);

  const avih = concat([
    fourcc('avih'),
    u32(56),
    u32(usec),
    u32(maxBytes * rate),
    u32(0),
    u32(0x10),
    u32(n),
    u32(0),
    u32(1),
    u32(maxBytes),
    u32(w),
    u32(h),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
  ]);

  const strh = concat([
    fourcc('strh'),
    u32(56),
    fourcc('vids'),
    fourcc('MJPG'),
    u32(0),
    u16(0),
    u16(0),
    u32(0),
    u32(1),
    u32(rate),
    u32(0),
    u32(n),
    u32(maxBytes),
    u32(0xffffffff),
    u32(0),
    u16(0),
    u16(0),
    u16(w),
    u16(h),
  ]);

  const strf = concat([
    fourcc('strf'),
    u32(40),
    u32(40),
    u32(w),
    u32(h),
    u16(1),
    u16(24),
    fourcc('MJPG'),
    u32(w * h * 3),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
  ]);

  const hdrl = list('hdrl', concat([avih, list('strl', concat([strh, strf]))]));
  const movi = list('movi', moviData);
  const idx1 = concat([fourcc('idx1'), u32(idx1Data.length), idx1Data]);
  const body = concat([hdrl, movi, idx1]);
  return concat([fourcc('RIFF'), u32(body.length + 4), fourcc('AVI '), body]);
}
