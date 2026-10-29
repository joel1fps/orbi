// Renders Orbi's original SVG (from the Orbit project) into the PNG icons Electron needs
// and the multi-size icon.ico used by the installer and the .exe.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('resources/orbi-original.svg', 'utf8');
const rasterize = (source, width) => new Resvg(source, { fitTo: { mode: 'width', value: width } }).render();
const render = (source, width, out) => {
  writeFileSync(out, rasterize(source, width).asPng());
  console.log('wrote', out, width);
};

render(svg, 256, 'resources/icon.png');
// Tray: tighter crop so Orbi's face reads at 16 px.
const tray = svg.replace('viewBox="0 0 120 120"', 'viewBox="14 6 96 100"');
render(tray, 16, 'resources/tray.png');
render(tray, 32, 'resources/tray@2x.png');
render(tray, 24, 'resources/tray@1.5x.png');

// icon.ico: small sizes use a square version of the tray crop; 256 is stored as PNG,
// the rest as 32-bit BMP, which every Windows tool (NSIS included) reads.
const square = svg.replace('viewBox="0 0 120 120"', 'viewBox="10 6 100 100"');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** BITMAPINFOHEADER + bottom-up BGRA rows + 1-bit AND mask (all zero: alpha decides). */
function bmpEntry(img) {
  const { width: w, height: h } = img;
  const px = img.pixels; // RGBA, premultiplied
  const maskRow = Math.ceil(w / 32) * 4;
  const out = Buffer.alloc(40 + w * h * 4 + maskRow * h);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(w, 4);
  out.writeInt32LE(h * 2, 8); // colour + mask
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(w * h * 4, 20);
  let o = 40;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      const straight = (c) => (a ? Math.min(255, Math.round((c * 255) / a)) : 0);
      out[o++] = straight(px[i + 2]);
      out[o++] = straight(px[i + 1]);
      out[o++] = straight(px[i]);
      out[o++] = a;
    }
  }
  return out;
}

function writeIco(out) {
  const images = ICO_SIZES.map((size) => {
    const img = rasterize(size <= 32 ? square : svg, size);
    if (img.width !== size || img.height !== size) throw new Error(`icon ${size} rendered as ${img.width}x${img.height}`);
    return { size, data: size === 256 ? img.asPng() : bmpEntry(img) };
  });
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, n) => {
    const e = 6 + 16 * n;
    header[e] = size % 256; // 0 means 256
    header[e + 1] = size % 256;
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  writeFileSync(out, Buffer.concat([header, ...images.map((i) => i.data)]));
  console.log('wrote', out, ICO_SIZES.join(', '));
}

writeIco('resources/icon.ico');
