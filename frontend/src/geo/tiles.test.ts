import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TILE_ERROR_THRESHOLD,
  TRUSTED_TILE_URL,
  buildCartoTileUrl,
  isTrustedTileUrl,
  probeTiles,
} from './tiles';

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseOf(bytes: number[]): Response {
  const buffer = new Uint8Array(bytes).buffer;
  return {
    ok: true,
    arrayBuffer: () => Promise.resolve(buffer),
  } as Response;
}

describe('probeTiles', () => {
  it('reports placeholder when distant tiles are byte-identical', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(responseOf([1, 2, 3])));
    await expect(probeTiles('https://{s}.x/{z}/{x}/{y}{r}.png')).resolves.toBe('placeholder');
  });

  it('reports ok when distant tiles differ', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(responseOf(calls === 1 ? [1, 2, 3] : [4, 5, 6]));
    });
    await expect(probeTiles('https://{s}.x/{z}/{x}/{y}{r}.png')).resolves.toBe('ok');
  });

  it('reports unknown on HTTP errors and network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false } as Response));
    await expect(probeTiles('https://{s}.x/{z}/{x}/{y}.png')).resolves.toBe('unknown');
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(probeTiles('https://{s}.x/{z}/{x}/{y}.png')).resolves.toBe('unknown');
  });

  it('trusts the default CARTO URL exactly', () => {
    expect(TRUSTED_TILE_URL).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    );
    expect(isTrustedTileUrl(TRUSTED_TILE_URL)).toBe(true);
    expect(isTrustedTileUrl('https://tiles.example.com/{z}/{x}/{y}.png')).toBe(false);
    expect(TILE_ERROR_THRESHOLD).toBeGreaterThanOrEqual(3);
  });
});

describe('buildCartoTileUrl', () => {
  it('appends the key exactly once with URL encoding', () => {
    expect(buildCartoTileUrl('demo-key-1')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=demo-key-1',
    );
    expect(buildCartoTileUrl('a b+c&d/e?f')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=a%20b%2Bc%26d%2Fe%3Ff',
    );
  });

  it('trims surrounding whitespace from the key', () => {
    expect(buildCartoTileUrl('  spaced-key  ')).toBe(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=spaced-key',
    );
  });

  it('returns null when the key is missing or blank', () => {
    expect(buildCartoTileUrl(undefined)).toBeNull();
    expect(buildCartoTileUrl(null)).toBeNull();
    expect(buildCartoTileUrl('')).toBeNull();
    expect(buildCartoTileUrl('   ')).toBeNull();
  });
});

describe('isTrustedTileUrl with keys', () => {
  it('trusts the keyed CARTO URL but rejects lookalikes', () => {
    const keyed = buildCartoTileUrl('demo-key-1') as string;
    expect(isTrustedTileUrl(keyed)).toBe(true);
    expect(isTrustedTileUrl('https://evil.example.com/light_all/{z}/{x}/{y}.png?key=x')).toBe(false);
    expect(isTrustedTileUrl(`${TRUSTED_TILE_URL}?other=x`)).toBe(false);
    expect(isTrustedTileUrl(`${TRUSTED_TILE_URL}?key=`)).toBe(true);
  });
});
