/**
 * Tile-provider helpers.
 *
 * The CARTO basemap requires an API key. The trusted URL is built from the
 * `VITE_CARTO_BASEMAP_KEY` environment variable; without a key the map must
 * not request unauthenticated tiles and instead shows the sandy vector
 * fallback. The key travels only inside the tile request URL — it is never
 * logged, displayed, or embedded in errors.
 *
 * Some tile endpoints answer every request with the same static "API key
 * required" image (HTTP 200, so no tileerror fires). Two distant tiles that
 * are byte-identical prove the basemap carries no geography, and the map
 * should fall back to the sandy vector view instead of showing watermarks.
 * Placeholder probing applies to custom tile URLs only, never to the
 * trusted CARTO provider.
 */

export type TileProbe = 'ok' | 'placeholder' | 'unknown';

/** Default trusted basemap. Never placeholder-probed; failures come from tile errors. */
export const TRUSTED_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

/** Consecutive tile errors required before the basemap is declared failed. */
export const TILE_ERROR_THRESHOLD = 3;

/**
 * Build the trusted CARTO tile URL for the given key, or null when no key
 * is configured. The key is URL-encoded exactly once at this boundary.
 */
export function buildCartoTileUrl(key: string | undefined | null): string | null {
  if (key === undefined || key === null) return null;
  const trimmed = key.trim();
  if (trimmed.length === 0) return null;
  return `${TRUSTED_TILE_URL}?key=${encodeURIComponent(trimmed)}`;
}

export function isTrustedTileUrl(tileUrl: string): boolean {
  return tileUrl === TRUSTED_TILE_URL || tileUrl.startsWith(`${TRUSTED_TILE_URL}?key=`);
}

function fillTemplate(tileUrl: string, s: string, z: number, x: number, y: number): string {
  return tileUrl
    .replace('{s}', s)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i += 1) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}

export async function probeTiles(tileUrl: string): Promise<TileProbe> {
  try {
    const [ra, rb] = await Promise.all([
      fetch(fillTemplate(tileUrl, 'a', 3, 1, 2)),
      fetch(fillTemplate(tileUrl, 'b', 3, 6, 4)),
    ]);
    if (!ra.ok || !rb.ok) return 'unknown';
    const [ba, bb] = await Promise.all([ra.arrayBuffer(), rb.arrayBuffer()]);
    return bytesEqual(ba, bb) ? 'placeholder' : 'ok';
  } catch {
    // Network errors surface through tileerror events instead.
    return 'unknown';
  }
}
