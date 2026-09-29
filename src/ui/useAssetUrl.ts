import { useEffect, useState } from 'react';
import { localAssets } from '@/persistence/repositories';

/** Object URL for an asset's working image (preview if present, else original). */
export function useAssetUrl(assetId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    let u: string | null = null;
    localAssets.get(assetId).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b.preview ?? b.original);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [assetId]);
  return url;
}
