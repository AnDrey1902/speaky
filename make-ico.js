const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Speaky voice-waveform polyline (from SpeakyLogo.tsx, 32-unit viewBox).
// Arcs in the original path are flattened — visually identical at icon sizes.
const WAVE_POINTS = [
  [5, 16], [8, 16], [10.2, 9.6], [12.1, 9.65], [14, 22],
  [16.3, 12.8], [18.24, 12.7], [19.6, 18], [21.4, 14.6],
  [23.2, 14.65], [24, 19], [27, 16]
];

// Tailwind indigo-500 → violet-600 (bg-gradient-to-br in SpeakyLogo.tsx)
const GRAD_FROM = [99, 102, 241];
const GRAD_TO = [124, 58, 237];

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function minDistToWave(x, y) {
  let min = Infinity;
  for (let i = 0; i < WAVE_POINTS.length - 1; i++) {
    const d = distToSegment(x, y,
      WAVE_POINTS[i][0], WAVE_POINTS[i][1],
      WAVE_POINTS[i + 1][0], WAVE_POINTS[i + 1][1]);
    if (d < min) min = d;
  }
  return min;
}

function renderPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 32;
  const cornerRadius = size * 0.25; // rounded-[8px] on a 32 tile
  const padding = size * 0.04;
  const minX = padding;
  const maxX = size - padding;
  const minY = padding;
  const maxY = size - padding;

  const halfStroke = (2.1 * scale) / 2;
  const glowR = 11 * scale; // soft inner glow circle (r=11)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded-rect (squircle) with 1px anti-aliased edge
      const cx = x < minX + cornerRadius ? minX + cornerRadius : x > maxX - cornerRadius ? maxX - cornerRadius : x;
      const cy = y < minY + cornerRadius ? minY + cornerRadius : y > maxY - cornerRadius ? maxY - cornerRadius : y;
      const edgeDist = Math.hypot(x - cx, y - cy) - cornerRadius;
      const alphaCov = Math.max(0, Math.min(1, 0.5 - edgeDist));
      if (alphaCov <= 0) {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Diagonal gradient background (to-br)
      const t = Math.max(0, Math.min(1, (x / Math.max(1, size - 1) + y / Math.max(1, size - 1)) / 2));
      let r = GRAD_FROM[0] + (GRAD_TO[0] - GRAD_FROM[0]) * t;
      let g = GRAD_FROM[1] + (GRAD_TO[1] - GRAD_FROM[1]) * t;
      let b = GRAD_FROM[2] + (GRAD_TO[2] - GRAD_FROM[2]) * t;

      // Soft inner glow: white at 10% opacity inside r=11
      const glowCov = Math.max(0, Math.min(1, glowR + 0.5 - Math.hypot(x - size / 2, y - size / 2))) * 0.1;
      r += (255 - r) * glowCov;
      g += (255 - g) * glowCov;
      b += (255 - b) * glowCov;

      // White waveform stroke, anti-aliased
      const strokeCov = Math.max(0, Math.min(1, halfStroke + 0.5 - minDistToWave(x, y)));
      r += (255 - r) * strokeCov;
      g += (255 - g) * strokeCov;
      b += (255 - b) * strokeCov;

      pixels[idx] = Math.round(r);
      pixels[idx + 1] = Math.round(g);
      pixels[idx + 2] = Math.round(b);
      pixels[idx + 3] = Math.round(alphaCov * 255);
    }
  }

  return pixels;
}

function makePngFromPixels(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA color
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);

  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(crc32(Buffer.concat([ihdrType, ihdrData])), 0);
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdr = Buffer.concat([ihdrLen, ihdrType, ihdrData, ihdrCrc]);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rawOffset = y * (size * 4 + 1);
    raw[rawOffset] = 0; // Filter: None
    const srcOffset = y * size * 4;
    rgba.copy(raw, rawOffset + 1, srcOffset, srcOffset + size * 4);
  }

  const deflated = zlib.deflateSync(raw);
  const idatType = Buffer.from('IDAT');
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, deflated])), 0);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(deflated.length, 0);
  const idat = Buffer.concat([idatLen, idatType, deflated, idatCrc]);

  const iendType = Buffer.from('IEND');
  const iendCrc = Buffer.alloc(4);
  iendCrc.writeUInt32BE(crc32(iendType), 0);
  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0, 0);
  const iend = Buffer.concat([iendLen, iendType, iendCrc]);

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeDibFromPixels(size, rgba) {
  // BITMAPINFOHEADER (40 bytes)
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (XOR + AND mask)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount (32-bit BGRA)
  header.writeUInt32LE(0, 16); // biCompression (BI_RGB)

  const xorSize = size * size * 4;
  const andRowBytes = Math.ceil(size / 32) * 4;
  const andSize = andRowBytes * size;
  header.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

  // XOR mask (BGRA, bottom-to-top)
  const xorMask = Buffer.alloc(xorSize);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcY * size + x) * 4;
      const dstIdx = (y * size + x) * 4;
      xorMask[dstIdx] = rgba[srcIdx + 2];     // B
      xorMask[dstIdx + 1] = rgba[srcIdx + 1]; // G
      xorMask[dstIdx + 2] = rgba[srcIdx];     // R
      xorMask[dstIdx + 3] = rgba[srcIdx + 3]; // A
    }
  }

  // AND mask (1 bit per pixel, bottom-to-top, 1 = transparent, 0 = opaque)
  const andMask = Buffer.alloc(andSize, 0);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    const rowOffset = y * andRowBytes;
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcY * size + x) * 4;
      const a = rgba[srcIdx + 3];
      if (a === 0) {
        const byteIdx = rowOffset + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        andMask[byteIdx] |= (1 << bitIdx);
      }
    }
  }

  return Buffer.concat([header, xorMask, andMask]);
}

function createIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(count, 4); // count

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (let i = 0; i < count; i++) {
    const { size, data } = entries[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bit depth
    entry.writeUInt32LE(data.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset

    dirEntries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map(e => e.data)]);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngSizes = [16, 32, 48, 256, 512, 1024];
const assetsDir = path.join(__dirname, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

const icoEntries = [];
const pngBuffers = {};

for (const s of icoSizes) {
  const pixels = renderPixels(s);
  pngBuffers[s] = makePngFromPixels(s, pixels);

  // For Windows ICO:
  // <= 128 MUST be DIB format for Windows Explorer / Desktop rendering
  // 256 can be PNG (Vista+ standard)
  if (s <= 128) {
    icoEntries.push({ size: s, data: makeDibFromPixels(s, pixels) });
  } else {
    icoEntries.push({ size: s, data: pngBuffers[s] });
  }
}

for (const s of pngSizes) {
  if (!pngBuffers[s]) pngBuffers[s] = makePngFromPixels(s, renderPixels(s));
  fs.writeFileSync(path.join(assetsDir, `icon-${s}.png`), pngBuffers[s]);
}

// electron-builder default icon (mac/linux) — 512x512
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffers[512]);

const icoBuffer = createIco(icoEntries);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);

console.log('Speaky ICO/PNG generated. ICO size:', icoBuffer.length, 'bytes');
