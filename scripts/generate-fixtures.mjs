// 生成 fake provider 使用的固定测试图片。只在需要新增 fixture 时运行：
//   node scripts/generate-fixtures.mjs
// 产物提交进仓库；默认测试和开发运行只读取它们，不生成文件、不访问网络。
import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixelAt) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SQUARE = { width: 768, height: 768 };
const LANDSCAPE = { width: 1024, height: 576 };
const PORTRAIT = { width: 576, height: 1024 };

const FIXTURES = [
  {
    name: "fake-square-a.png",
    size: SQUARE,
    base: [58, 58, 54],
    accent: [214, 176, 108],
    kind: "grid",
  },
  {
    name: "fake-square-b.png",
    size: SQUARE,
    base: [46, 52, 56],
    accent: [130, 178, 196],
    kind: "rings",
  },
  {
    name: "fake-square-c.png",
    size: SQUARE,
    base: [56, 48, 50],
    accent: [198, 138, 130],
    kind: "diagonal",
  },
  {
    name: "fake-landscape.png",
    size: LANDSCAPE,
    base: [50, 50, 48],
    accent: [176, 186, 120],
    kind: "diagonal",
  },
  {
    name: "fake-portrait.png",
    size: PORTRAIT,
    base: [48, 50, 54],
    accent: [150, 160, 210],
    kind: "rings",
  },
];

function pixelFor(kind, size, base, accent) {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const maxRadius = Math.min(cx, cy);
  return (x, y) => {
    const nx = (x - cx) / maxRadius;
    const ny = (y - cy) / maxRadius;
    let t;
    if (kind === "rings") {
      t = 0.5 + 0.5 * Math.sin(Math.sqrt(nx * nx + ny * ny) * 9);
    } else if (kind === "diagonal") {
      t = 0.5 + 0.5 * Math.sin((nx + ny) * 3.2);
    } else {
      const cell = Math.floor(x / 48) + Math.floor(y / 48);
      t = cell % 2 === 0 ? 0.85 : 0.15;
      const margin = Math.min(x, y, size.width - x, size.height - y);
      if (margin < 24) t = 1;
    }
    t = Math.max(0, Math.min(1, t));
    return [0, 1, 2].map((i) => Math.round(base[i] + (accent[i] - base[i]) * t * 0.75));
  };
}

for (const fixture of FIXTURES) {
  const png = encodePng(
    fixture.size.width,
    fixture.size.height,
    pixelFor(fixture.kind, fixture.size, fixture.base, fixture.accent),
  );
  await writeFile(new URL(`../fixtures/${fixture.name}`, import.meta.url), png);
  console.log(`fixtures/${fixture.name}`, `${fixture.size.width}x${fixture.size.height}`, `${png.length} bytes`);
}
