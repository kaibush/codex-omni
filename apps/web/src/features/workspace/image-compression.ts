import type { FileLike } from "./composer-attachments";

const MAX_IMAGE_DIMENSION = 2560;
const IMAGE_QUALITIES = [0.9, 0.82, 0.74, 0.66];
const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif"
};

export function imageMimeType(name: string, type?: string) {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return type && type !== "application/octet-stream"
    ? type.toLowerCase()
    : IMAGE_MIME_TYPES[extension];
}

function encodeImage(canvas: HTMLCanvasElement, mime: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.size) resolve(blob);
        else reject(new Error("图片压缩失败，请重新选择照片"));
      },
      mime,
      quality
    );
  });
}

function compressedName(name: string, mime: string) {
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  if (imageMimeType(name) === mime) return name;
  return `${name.replace(/\.[^.]+$/, "") || "image"}.${extension}`;
}

export async function compressImageAttachment(file: FileLike, maxBytes: number): Promise<FileLike> {
  const mime = imageMimeType(file.name, file.type);
  // Keep small originals, GIFs and vector files intact.
  if (file.size <= maxBytes || !mime || !Object.values(IMAGE_MIME_TYPES).includes(mime)) {
    return file;
  }
  const blob = file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: mime });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    // Browser image decoding applies the camera's EXIF orientation before drawing.
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error(`${file.name} 无法读取，请改用 JPG、PNG 或 WebP 图片`));
      image.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error(`${file.name} 图片尺寸无效`);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法压缩图片，请更新浏览器后重试");
    const outputMime = ["image/jpeg", "image/heic", "image/heif"].includes(mime)
      ? "image/jpeg"
      : "image/webp";
    let dimension = Math.min(MAX_IMAGE_DIMENSION, Math.max(width, height));
    while (dimension >= Math.min(320, Math.max(width, height))) {
      const scale = dimension / Math.max(width, height);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of IMAGE_QUALITIES) {
        const compressed = await encodeImage(canvas, outputMime, quality);
        if (compressed.size <= maxBytes) {
          return new File([compressed], compressedName(file.name, compressed.type), {
            type: compressed.type
          });
        }
        // Safari versions without WebP encoding return PNG; quality does not affect PNG.
        if (compressed.type === "image/png") break;
      }
      dimension = Math.floor(dimension * 0.8);
    }
    throw new Error(`${file.name} 压缩后仍过大，请裁剪图片后重试`);
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}
