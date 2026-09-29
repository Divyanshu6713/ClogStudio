// Runtime access to stored asset bytes: decoding for rendering and retrieving
// untouched originals.

import type { AssetMeta } from '@/domain/types';
import { localAssets } from '@/persistence/repositories';
import { sha256 } from './importArtwork';

/** Decoded working image for rendering (preview if one exists, else the original). */
export async function loadRenderBitmap(assetId: string): Promise<ImageBitmap> {
  const b = await localAssets.get(assetId);
  if (!b) throw new Error('Asset bytes are missing from local storage.');
  return createImageBitmap(b.preview ?? b.original, { premultiplyAlpha: 'none' });
}

/** Save the original uploaded file, byte-for-byte. */
export async function downloadOriginal(meta: AssetMeta): Promise<void> {
  const b = await localAssets.get(meta.id);
  if (!b) throw new Error(`The original file for "${meta.name}" is not in local storage.`);
  const url = URL.createObjectURL(b.original);
  const a = document.createElement('a');
  a.href = url;
  a.download = meta.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Re-hash the stored original and compare with the hash taken at upload. */
export async function verifyOriginal(meta: AssetMeta): Promise<boolean> {
  const b = await localAssets.get(meta.id);
  return !!b && (await sha256(b.original)) === meta.sha256;
}
