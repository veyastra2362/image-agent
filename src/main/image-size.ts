/**
 * 从文件头读出图片宽高。
 *
 * 只用于"扫描文件夹重建索引"：索引丢了以后，至少把尺寸恢复出来，
 * 而不是在界面上显示 0×0。支持的格式和作品库会写出的格式保持一致。
 */
export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
}

export function readImageSize(bytes: Uint8Array): ImageDimensions | undefined {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

function readPng(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined;
  // 89 50 4E 47 0D 0A 1A 0A
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), mimeType: "image/png" };
}

function readJpeg(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 都带尺寸
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (isSof) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { width, height, mimeType: "image/jpeg" };
    }
    if (length <= 0) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function readWebp(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined;
  // RIFF....WEBP
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") return undefined;
  if (String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return undefined;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === "VP8X") {
    const width = 1 + (view.getUint32(24, true) & 0xffffff);
    const height = 1 + ((view.getUint32(27, true) >> 8) & 0xffffff);
    return { width, height, mimeType: "image/webp" };
  }
  if (chunk === "VP8 ") {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return { width, height, mimeType: "image/webp" };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mimeType: "image/webp" };
  }
  return undefined;
}
