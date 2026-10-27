import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const MAX_BRAND_ICON_BYTES = 512 * 1024;

export type Branding = {
  iconUrl: string | null;
  contentType: string | null;
  updatedAt: number | null;
};

export type BrandIconFile = {
  buffer: Buffer;
  contentType: string;
  updatedAt: number;
};

const ICON_NAME = "icon";
const META_NAME = "meta.json";

export function emptyBranding(): Branding {
  return { iconUrl: null, contentType: null, updatedAt: null };
}

const FORWARDED_PREFIX = /^\/[A-Za-z0-9_-]+$/;

export function forwardedPrefix(header: unknown) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  return FORWARDED_PREFIX.test(trimmed) ? trimmed : "";
}

export function brandingForRequest(branding: Branding, header?: unknown): Branding {
  const prefix = forwardedPrefix(header);
  if (!prefix || branding.updatedAt == null || !branding.iconUrl) return branding;
  return {
    ...branding,
    iconUrl: `${prefix}/api/branding/icon?v=${branding.updatedAt}`
  };
}

export function detectBrandIcon(buffer: Buffer): { contentType: string } {
  if (buffer.byteLength === 0) throw new Error("图标文件是空的");
  if (buffer.byteLength > MAX_BRAND_ICON_BYTES) throw new Error("图标不能超过 512 KB");
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png" };
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg" };
  if (
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return { contentType: "image/gif" };
  }
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { contentType: "image/webp" };
  }
  if (
    buffer.byteLength >= 6 &&
    buffer[0] === 0 &&
    buffer[1] === 0 &&
    buffer[2] === 1 &&
    buffer[3] === 0 &&
    buffer.readUInt16LE(4) > 0
  ) {
    return { contentType: "image/x-icon" };
  }
  if (looksLikeSvg(buffer)) {
    if (!isSafeSvg(buffer)) throw new Error("SVG 图标包含不受支持的内容");
    return { contentType: "image/svg+xml" };
  }
  throw new Error("只支持 PNG、JPG、WEBP、GIF、ICO 或 SVG");
}

export async function readBranding(directory: string): Promise<Branding> {
  const file = await readBrandIconFile(directory);
  return file ? brandingPayload(file) : emptyBranding();
}

export async function readBrandIconFile(directory: string): Promise<BrandIconFile | null> {
  const buffer = await readOptional(path.join(directory, ICON_NAME));
  if (!buffer || buffer.byteLength === 0) return null;
  let contentType: string;
  try {
    contentType = detectBrandIcon(buffer).contentType;
  } catch {
    return null;
  }
  return { buffer, contentType, updatedAt: await readUpdatedAt(directory) };
}

export async function saveBrandIcon(directory: string, buffer: Buffer): Promise<Branding> {
  const detected = detectBrandIcon(buffer);
  const updatedAt = Date.now();
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${ICON_NAME}-${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temporary, buffer);
  try {
    await rename(temporary, path.join(directory, ICON_NAME));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await writeFile(
    path.join(directory, META_NAME),
    JSON.stringify({ contentType: detected.contentType, updatedAt })
  );
  return brandingPayload({ contentType: detected.contentType, updatedAt });
}

export async function clearBrandIcon(directory: string): Promise<Branding> {
  await rm(path.join(directory, ICON_NAME), { force: true });
  await rm(path.join(directory, META_NAME), { force: true });
  return emptyBranding();
}

function brandingPayload(file: Pick<BrandIconFile, "contentType" | "updatedAt">): Branding {
  return {
    iconUrl: `/api/branding/icon?v=${file.updatedAt}`,
    contentType: file.contentType,
    updatedAt: file.updatedAt
  };
}

async function readUpdatedAt(directory: string) {
  try {
    const parsed = JSON.parse(await readFile(path.join(directory, META_NAME), "utf8")) as {
      updatedAt?: unknown;
    };
    return typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : 0;
  } catch {
    return 0;
  }
}

async function readOptional(file: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function startsWith(buffer: Buffer, bytes: number[]) {
  if (buffer.byteLength < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function looksLikeSvg(buffer: Buffer) {
  if (buffer.includes(0)) return false;
  const text = buffer
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  return /^<\?xml/i.test(text) || /^<svg[\s>/]/i.test(text);
}

function isSafeSvg(buffer: Buffer) {
  const text = buffer.toString("utf8");
  if (!/<svg[\s>/]/i.test(text)) return false;
  return !/<!doctype|<!entity|<script|<\/script|<foreignobject|<iframe|<embed|<object|javascript:|data:text\/html|\son[a-z]+\s*=/i.test(
    text
  );
}
