import { describe, expect, it, vi } from 'vitest';
import type { Map as LeafletMap } from 'leaflet';
import { fitMap } from './SimMap';

function stubMap(zoomAfterFit: number) {
  const setView = vi.fn();
  const map = {
    fitBounds: vi.fn(),
    getZoom: () => zoomAfterFit,
    setView,
  } as unknown as LeafletMap;
  return { map, setView };
}

describe('fitMap', () => {
  it('recenters on the encounter at the 20 km / 10 mi scale when the fit is far out', () => {
    const { map, setView } = stubMap(7);
    fitMap(map, [[37.6, -122.4]], [40, 40], false);
    expect(setView).toHaveBeenCalledWith(
      [expect.any(Number), expect.any(Number)],
      9,
      { animate: false },
    );
  });

  it('leaves tighter fits alone', () => {
    const { map, setView } = stubMap(11);
    fitMap(map, [[37.6, -122.4]], [40, 40], false);
    expect(setView).not.toHaveBeenCalled();
  });
});
