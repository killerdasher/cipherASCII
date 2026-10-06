/**
 * Generates every app icon from one canvas drawing of the cipherASCII mark.
 *
 *   node scripts/make-icons.mjs
 *
 * Emits into `public/`:
 *   - icon-16/32/48/64/128/256/512/1024.png  (favicon, Linux, electron-builder)
 *   - icon.png                               (512, electron-builder win/linux default)
 *   - favicon.ico                            (browsers' default /favicon.ico probe)
 *   - icon.ico                               (Windows installer + taskbar)
 *   - icon.icns                              (macOS app bundle)
 *   - apple-touch-icon.png                   (180, opaque - iOS masks it itself)
 *
 * The artwork is the same "data brackets + eye + rune pupil" mark the app
 * renders in `src/components/CipherAsciiLogo.tsx`, drawn here with fixed brand
 * colours instead of CSS variables so it survives outside the DOM.
 *
 * ICO and ICNS are both packed by hand from PNG payloads: ICO entries may
 * carry PNG data (Vista+), and ICNS has done so for `icp*`/`ic0*` types since
 * macOS 10.13, which keeps this script free of ImageMagick/Pillow.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BRAND = {
  bg: '#16120c',
  bgEdge: '#0d0b07',
  accent: '#d4a53c',
  fg: '#f4f1e8',
  fgMuted: '#9a948a',
};

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

/** One icon, drawn at `size` pixels square. `opaque` fills the whole square
 * edge to edge (iOS applies its own mask, and the touch icon must not have
 * transparent corners). */
function drawIcon(size, { opaque = false } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const u = size / 1024; // design units (1024 master)

  // Rounded-square plate (macOS/Windows squircle feel) + hairline frame.
  const pad = opaque ? 0 : 40 * u;
  const r = opaque ? 0 : 210 * u;
  const plate = (inset, radius) => {
    const x = pad + inset;
    const y = pad + inset;
    const w = size - 2 * x;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + w, radius);
    ctx.arcTo(x + w, y + w, x, y + w, radius);
    ctx.arcTo(x, y + w, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, BRAND.bg);
  g.addColorStop(1, BRAND.bgEdge);
  plate(0, r);
  ctx.fillStyle = g;
  ctx.fill();

  // Top sheen: a faint highlight arc that gives the plate depth at 64px+ and
  // is skipped at favicon sizes where it would only muddy the mark.
  if (size >= 64 && !opaque) {
    plate(0, r);
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, 0, 0, size * 0.55);
    sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size * 0.55);
    ctx.restore();
  }

  if (!opaque) {
    plate(26 * u, r - 26 * u);
    ctx.lineWidth = 6 * u;
    ctx.strokeStyle = BRAND.accent;
    ctx.stroke();
  }

  // The mark, laid out on the SVG's 64-unit grid, scaled into the plate.
  const s = size / 64;
  const ox = 0;
  const oy = 0;
  const X = (v) => ox + v * s;
  const Y = (v) => oy + v * s;

  // Soft drop shadow under the mark at 64px+ so it lifts off the plate.
  if (size >= 64) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10 * u;
    ctx.shadowOffsetY = 5 * u;
  }

  // data brackets
  ctx.strokeStyle = BRAND.accent;
  ctx.lineWidth = 3 * s;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  for (const [x0, x1] of [
    [20, 8],
    [44, 56],
  ]) {
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(8));
    ctx.lineTo(X(x1), Y(8));
    ctx.lineTo(X(x1), Y(56));
    ctx.lineTo(X(x0), Y(56));
    ctx.stroke();
  }

  // packet dots
  ctx.fillStyle = BRAND.fg;
  for (const dx of [10.5, 50.5]) {
    for (const dy of [18, 30.5, 43]) {
      ctx.fillRect(X(dx), Y(dy), 3 * s, 3 * s);
    }
  }

  // eye
  ctx.strokeStyle = BRAND.fg;
  ctx.lineWidth = 2.5 * s;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(X(16), Y(32));
  ctx.bezierCurveTo(X(23), Y(21), X(41), Y(21), X(48), Y(32));
  ctx.bezierCurveTo(X(41), Y(43), X(23), Y(43), X(16), Y(32));
  ctx.closePath();
  ctx.stroke();

  // iris rings
  ctx.strokeStyle = BRAND.accent;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(X(32), Y(32), 9.5 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = BRAND.fgMuted;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(X(32), Y(32), 13 * s, 0, Math.PI * 2);
  ctx.stroke();

  // rune pupil (diamond with a cut-out)
  ctx.fillStyle = BRAND.accent;
  ctx.beginPath();
  ctx.moveTo(X(32), Y(25));
  ctx.lineTo(X(39), Y(32));
  ctx.lineTo(X(32), Y(39));
  ctx.lineTo(X(25), Y(32));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BRAND.bg;
  ctx.beginPath();
  ctx.moveTo(X(32), Y(28.5));
  ctx.lineTo(X(35.5), Y(32));
  ctx.lineTo(X(32), Y(35.5));
  ctx.lineTo(X(28.5), Y(32));
  ctx.closePath();
  ctx.fill();

  // highlight
  ctx.fillStyle = BRAND.fg;
  ctx.beginPath();
  ctx.arc(X(29), Y(29), 1.6 * s, 0, Math.PI * 2);
  ctx.fill();

  if (size >= 64) ctx.restore();

  return canvas;
}

function png(canvas) {
  // Every size is drawn at its own resolution (not downsampled from 1024), so
  // the 16px favicon stays crisp.
  return canvas.toBuffer('image/png');
}

/** Pack PNG payloads into an ICNS container. */
function packIcns(entries) {
  const body = [];
  for (const [type, data] of entries) {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    body.push(head, data);
  }
  const total = 8 + body.reduce((n, b) => n + b.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...body]);
}

/** Pack PNG payloads into a Windows .ico (PNG-compressed entries). */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dirents = [];
  const blobs = [];
  let offset = 6 + entries.length * 16;
  for (const [size, data] of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    d.writeUInt8(size >= 256 ? 0 : size, 1); // height
    d.writeUInt8(0, 2); // colour count (0 = truecolour)
    d.writeUInt8(0, 3); // reserved
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(data.length, 8); // bytes in resource
    d.writeUInt32LE(offset, 12); // image offset
    offset += data.length;
    dirents.push(d);
    blobs.push(data);
  }
  return Buffer.concat([header, ...dirents, ...blobs]);
}

// --- render + write --------------------------------------------------------
const bySize = new Map();
for (const size of SIZES) {
  bySize.set(size, png(drawIcon(size)));
  writeFileSync(join(OUT, `icon-${size}.png`), bySize.get(size));
}
writeFileSync(join(OUT, 'icon.png'), bySize.get(512));

const icns = packIcns([
  ['icp4', bySize.get(16)],
  ['icp5', bySize.get(32)],
  ['icp6', bySize.get(64)],
  ['ic11', bySize.get(32)],
  ['ic12', bySize.get(64)],
  ['ic07', bySize.get(128)],
  ['ic08', bySize.get(256)],
  ['ic13', bySize.get(256)],
  ['ic09', bySize.get(512)],
  ['ic14', bySize.get(512)],
  ['ic10', bySize.get(1024)],
]);
writeFileSync(join(OUT, 'icon.icns'), icns);

const ico = packIco([16, 32, 48, 64, 128, 256].map((size) => [size, bySize.get(size)]));
writeFileSync(join(OUT, 'icon.ico'), ico);
// Browsers probe /favicon.ico regardless of the <link rel="icon"> hints.
writeFileSync(join(OUT, 'favicon.ico'), ico);

const touch = png(drawIcon(180, { opaque: true }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), touch);

console.log(
  `icons: ${SIZES.join('/')} px, icon.icns (${icns.length} B), icon.ico (${ico.length} B), favicon.ico, apple-touch-icon (180)`,
);
