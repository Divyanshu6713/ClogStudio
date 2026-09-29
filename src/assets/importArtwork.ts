// Artwork import: validate → hash the ORIGINAL bytes → (sanitise SVG) →
// make a working preview only when needed. The original file is stored
// byte-for-byte and never modified.

import DOMPurify from 'dompurify';
import type { AssetMeta } from '@/domain/types';
import { newId } from '@/domain/factory';
import type { StoredAssetBlobs } from '@/persistence/repositories';

export const ARTWORK_ACCEPT = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_BYTES = 40 * 1024 * 1024;
const WARN_BYTES = 12 * 1024 * 1024;
/** longest side of the texture used while editing */
export const WORKING_MAX_PX = 2048;
const MAX_PIXELS = 100_000_000;

export class ImportError extends Error {}

export interface ImportedArtwork {
  meta: AssetMeta;
  blobs: StoredAssetBlobs;
}

export async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sniff(file: File): Promise<'png' | 'jpeg' | 'webp' | 'svg' | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'webp';
  const text = (await file.slice(0, 2048).text()).trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg')) || text.includes('<svg')) return 'svg';
  return null;
}

export async function importArtwork(file: File): Promise<ImportedArtwork> {
  if (file.size === 0) throw new ImportError(`"${file.name}" is empty.`);
  if (file.size > MAX_BYTES) throw new ImportError(`"${file.name}" is ${mb(file.size)}; the limit is ${mb(MAX_BYTES)}.`);
  const kind = await sniff(file);
  if (!kind) throw new ImportError(`"${file.name}" is not a PNG, JPEG, WebP or SVG file (checked the file contents, not just the extension).`);

  const warnings: string[] = [];
  if (file.size > WARN_BYTES) warnings.push(`Large file (${mb(file.size)}). It is kept in full; editing uses a smaller working preview.`);
  const hash = await sha256(file);
  const base = { id: newId('ast'), name: file.name, bytes: file.size, sha256: hash, createdAt: Date.now() };

  if (kind === 'svg') return importSvg(file, base, warnings);

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new ImportError(`"${file.name}" could not be decoded. The file may be corrupted or truncated.`);
  }
  const { width, height } = bmp;
  if (width * height > MAX_PIXELS) {
    bmp.close();
    throw new ImportError(`"${file.name}" is ${width}×${height} px (${Math.round((width * height) / 1e6)} MP). The limit is ${MAX_PIXELS / 1e6} MP.`);
  }
  if (Math.max(width, height) < 256) warnings.push(`Low resolution (${width}×${height} px). It may look soft when printed large.`);

  let preview: Blob | null = null;
  let previewInfo: AssetMeta['preview'] = null;
  if (Math.max(width, height) > WORKING_MAX_PX) {
    const s = WORKING_MAX_PX / Math.max(width, height);
    const w = Math.round(width * s);
    const h = Math.round(height * s);
    preview = await rasterize(bmp, w, h);
    previewInfo = { width: w, height: h, downscaled: true };
    warnings.push(`Editing preview is ${w}×${h} px; the original ${width}×${height} px file is kept unchanged.`);
  }
  bmp.close();
  const mime = kind === 'png' ? 'image/png' : kind === 'jpeg' ? 'image/jpeg' : 'image/webp';
  return {
    meta: { ...base, kind: 'raster', mime, width, height, preview: previewInfo, warnings },
    blobs: { original: file, preview, sanitizedSvg: null },
  };
}

async function importSvg(file: File, base: Pick<AssetMeta, 'id' | 'name' | 'bytes' | 'sha256' | 'createdAt'>, warnings: string[]): Promise<ImportedArtwork> {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.nodeName.toLowerCase() !== 'svg')
    throw new ImportError(`"${file.name}" is not well-formed SVG and cannot be used.`);

  // Sanitise before the markup is used anywhere. The app never inserts user
  // SVG into its own DOM; it is only rasterised through an <img>.
  const clean = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } });
  const removed = DOMPurify.removed.length;
  if (!clean || !/<svg[\s>]/i.test(clean)) throw new ImportError(`"${file.name}" contained no safe SVG content after sanitising.`);
  if (removed > 0) warnings.push(`Removed ${removed} unsafe SVG element(s)/attribute(s) (scripts, event handlers or external references). The original file is stored unchanged.`);
  if (/<text[\s>]/i.test(clean)) warnings.push('This SVG contains live text. It renders with the fonts installed in this browser; convert text to outlines for exact typography.');

  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml').documentElement;
  const vb = doc.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let w = parseFloat(doc.getAttribute('width') ?? '');
  let h = parseFloat(doc.getAttribute('height') ?? '');
  if (!(w > 0 && h > 0) && vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) [w, h] = [vb[2], vb[3]];
  if (!(w > 0 && h > 0)) {
    [w, h] = [1024, 1024];
    warnings.push('SVG has no width/height or viewBox; assumed a square artboard.');
  }
  const s = WORKING_MAX_PX / Math.max(w, h);
  const pw = Math.max(1, Math.round(w * s));
  const ph = Math.max(1, Math.round(h * s));
  // Explicit pixel size so the browser rasterises at full working resolution.
  doc.setAttribute('width', String(pw));
  doc.setAttribute('height', String(ph));
  if (!doc.getAttribute('viewBox')) doc.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const sized = new XMLSerializer().serializeToString(doc);

  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  let img: HTMLImageElement;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImportError(`"${file.name}" could not be rendered by the browser.`));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  const preview = await rasterize(img, pw, ph);
  return {
    meta: { ...base, kind: 'svg', mime: 'image/svg+xml', width: Math.round(w), height: Math.round(h), preview: { width: pw, height: ph, downscaled: false }, warnings },
    blobs: { original: file, preview, sanitizedSvg: clean },
  };
}

async function rasterize(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImportError('Could not create a canvas to prepare the artwork (the browser may be low on memory).');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new ImportError('Could not encode the working preview (the browser may be low on memory).');
  return blob;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
