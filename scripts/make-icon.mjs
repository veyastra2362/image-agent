/**
 * 从一张生成的方形图做出应用图标：
 *  - resources/icon.png（1024×1024，四周白底抠成透明，保留圆角）
 *  - resources/icon.ico（Windows 多尺寸，PNG 压缩条目）
 *
 * 用法：node scripts/make-icon.mjs <源图路径>
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) {
  console.error("用法：node scripts/make-icon.mjs <源图路径>");
  process.exit(1);
}

const outDir = path.resolve("resources");
await mkdir(outDir, { recursive: true });

const SIZE = 1024;

/**
 * 裁掉四周白边，再把"从边缘连通过来的白色"抠成透明。
 * 只吃边缘连通的白色，图标内部的白色字母不会被打洞。
 */
async function buildIconBuffer() {
  const { data, info } = await sharp(source)
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 8 })
    .resize(SIZE, SIZE, { fit: "contain", background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const isWhite = (index) => data[index] > 234 && data[index + 1] > 234 && data[index + 2] > 234;

  const visited = new Uint8Array(width * height);
  const queue = [];
  const push = (x, y) => {
    const pixel = y * width + x;
    if (visited[pixel] === 1) return;
    visited[pixel] = 1;
    if (!isWhite(pixel * 4)) return;
    queue.push(pixel);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (queue.length > 0) {
    const pixel = queue.pop();
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (visited[pixel] === 1 && isWhite(pixel * 4)) data[pixel * 4 + 3] = 0;
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const iconPng = await buildIconBuffer();
await writeFile(path.join(outDir, "icon.png"), iconPng);

/** Windows .ico：多尺寸 PNG 条目打包，够任务栏/资源管理器/快捷方式用。 */
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) => sharp(iconPng).resize(size, size, { fit: "contain", background: "#00000000" }).png().toBuffer()),
);

const headerSize = 6 + 16 * images.length;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(images.length, 4);

let offset = headerSize;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  const size = sizes[index];
  header.writeUInt8(size >= 256 ? 0 : size, entry);
  header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});

await writeFile(path.join(outDir, "icon.ico"), Buffer.concat([header, ...images]));
console.log(`已生成 resources/icon.png（${SIZE}×${SIZE}，圆角外透明）和 icon.ico（${sizes.join("/")}）`);
