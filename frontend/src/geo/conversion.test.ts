import { describe, expect, it } from 'vitest';
import { ROUTE_END_NM, SFO_ANCHOR, nmToLatLng, scenarioNmToLatLng } from './conversion';

describe('nmToLatLng', () => {
  it('maps the origin to the SFO anchor', () => {
    expect(nmToLatLng(0, 0)).toEqual({ lat: 37.6213, lng: -122.379 });
    expect(SFO_ANCHOR).toEqual({ lat: 37.6213, lng: -122.379 });
  });

  it('adds exactly one degree of latitude per 60 NM north', () => {
    expect(nmToLatLng(0, 60).lat).toBeCloseTo(38.6213, 10);
    expect(nmToLatLng(0, -60).lat).toBeCloseTo(36.6213, 10);
  });

  it('scales eastings by the cosine of the anchor latitude', () => {
    const expected = -122.379 + 60 / (60 * Math.cos((37.6213 * Math.PI) / 180));
    expect(nmToLatLng(60, 0).lng).toBeCloseTo(expected, 10);
    expect(nmToLatLng(60, 0).lng).toBeGreaterThan(-122.379);
    // One minute of longitude is longer than one NM away from the equator.
    expect(nmToLatLng(1, 0).lng - -122.379).toBeGreaterThan(1 / 60);
  });

  it('keeps waypoint order east of the anchor', () => {
    const merit = nmToLatLng(20, 0);
    const ponct = nmToLatLng(60, 0);
    expect(merit.lng).toBeGreaterThan(-122.379);
    expect(ponct.lng).toBeGreaterThan(merit.lng);
    expect(merit.lat).toBeCloseTo(37.6213, 10);
  });
});

describe('scenarioNmToLatLng', () => {
  it('places PONCT at the SFO terminal end', () => {
    expect(ROUTE_END_NM).toBe(60);
    expect(scenarioNmToLatLng(60, 0)).toEqual({ lat: 37.6213, lng: -122.379 });
  });

  it('starts ownship west of SFO with MERIT between', () => {
    const start = scenarioNmToLatLng(0, 0);
    const merit = scenarioNmToLatLng(20, 0);
    const ponct = scenarioNmToLatLng(60, 0);
    expect(start.lng).toBeLessThan(merit.lng);
    expect(merit.lng).toBeLessThan(ponct.lng);
    expect(start.lat).toBeCloseTo(37.6213, 10);
    // 60 NM west in longitude degrees at SFO latitude.
    expect(ponct.lng - start.lng).toBeCloseTo(60 / (60 * Math.cos((37.6213 * Math.PI) / 180)), 10);
  });
});
