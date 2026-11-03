import { describe, expect, it } from 'vitest';
import {
  AIRPORT_LIVE_CLEARANCE_NM,
  BG_MIN_SEP_NM,
  BG_ROUTE_CLEARANCE_NM,
  BG_SEED,
  BG_TRAFFIC_COUNT,
  PARKED_AIRCRAFT,
  SFO_AIRPORT_SLOTS,
  backgroundTrafficAt,
  formatBgTip,
} from './backgroundTraffic';
import { gradualX, intruderTrack } from '../test/fixtures';

const FORBIDDEN = ['conflict', 'collision', 'intruder', 'separation'];

describe('backgroundTrafficAt', () => {
  it('keeps a fixed seed and exactly ten aircraft', () => {
    expect(BG_SEED).toBe(452);
    expect(BG_TRAFFIC_COUNT).toBe(10);
    expect(backgroundTrafficAt(0)).toHaveLength(10);
  });

  it('is a pure function of playback time', () => {
    expect(backgroundTrafficAt(123.4)).toEqual(backgroundTrafficAt(123.4));
    expect(backgroundTrafficAt(0)).not.toEqual(backgroundTrafficAt(60));
  });

  it('moves every slot (nothing static)', () => {
    const a = backgroundTrafficAt(0);
    const b = backgroundTrafficAt(60);
    for (let slot = 0; slot < BG_TRAFFIC_COUNT; slot += 1) {
      expect({ x: b[slot].xNm, y: b[slot].yNm }).not.toEqual({
        x: a[slot].xNm,
        y: a[slot].yNm,
      });
    }
  });

  it('keeps 10 NM sideways clearance and never crosses the route', () => {
    expect(BG_ROUTE_CLEARANCE_NM).toBe(10);
    for (let t = 0; t <= 2400; t += 2) {
      const sky = backgroundTrafficAt(t);
      expect(sky).toHaveLength(BG_TRAFFIC_COUNT);
      for (const ac of sky) {
        // Airport stream slots are sequenced by time, not by band; the
        // live-clearance test below pins their separation instead.
        if (!SFO_AIRPORT_SLOTS.includes(ac.slot)) {
          expect(Math.abs(ac.yNm)).toBeGreaterThanOrEqual(BG_ROUTE_CLEARANCE_NM);
        }
        expect(ac.yNm).toBeGreaterThanOrEqual(-20);
        expect(ac.yNm).toBeLessThanOrEqual(38);
        expect(ac.xNm).toBeGreaterThanOrEqual(-25);
        expect(ac.xNm).toBeLessThanOrEqual(85);
        expect(Number.isFinite(ac.headingDeg)).toBe(true);
      }
    }
  });

  it('keeps sequenced airport slots clear of both live scenario aircraft', () => {
    expect(AIRPORT_LIVE_CLEARANCE_NM).toBe(8);
    expect([...SFO_AIRPORT_SLOTS]).toEqual([6, 7, 8]);
    for (let t = 0; t <= 720; t += 2) {
      const sky = backgroundTrafficAt(t);
      const own = { x: gradualX(t), y: 0 };
      const tfc = intruderTrack(t);
      for (const ac of sky) {
        if (!SFO_AIRPORT_SLOTS.includes(ac.slot)) continue;
        const fromOwn = Math.hypot(ac.xNm - own.x, ac.yNm - own.y);
        const fromTfc = Math.hypot(ac.xNm - tfc.x, ac.yNm - tfc.y);
        expect(fromOwn).toBeGreaterThanOrEqual(AIRPORT_LIVE_CLEARANCE_NM);
        expect(fromTfc).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('recycles slots with fresh routes so the sky never empties', () => {
    const seen = new Set<string>();
    const perSlotCycles = new Map<number, Set<number>>();
    for (let t = 0; t <= 3200; t += 10) {
      const sky = backgroundTrafficAt(t);
      expect(sky).toHaveLength(BG_TRAFFIC_COUNT);
      for (const ac of sky) {
        seen.add(`${ac.slot}:${ac.cycle}:${ac.callsign}`);
        const cycles = perSlotCycles.get(ac.slot) ?? new Set<number>();
        cycles.add(ac.cycle);
        perSlotCycles.set(ac.slot, cycles);
      }
    }
    for (let slot = 0; slot < BG_TRAFFIC_COUNT; slot += 1) {
      expect(perSlotCycles.get(slot)?.size ?? 0).toBeGreaterThan(1);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('uses generic SIM callsigns only', () => {
    for (let t = 0; t <= 3200; t += 25) {
      for (const ac of backgroundTrafficAt(t)) {
        expect(ac.callsign).toMatch(/^SIM [1-8]\d\d$/);
      }
    }
  });

  it('flies arrivals down, departures up, cruise level', () => {
    const byCycle = new Map<string, { kind: string; alts: number[] }>();
    for (let t = 0; t <= 3200; t += 10) {
      for (const ac of backgroundTrafficAt(t)) {
        const key = `${ac.slot}:${ac.cycle}`;
        const entry = byCycle.get(key) ?? { kind: ac.kind, alts: [] };
        entry.alts.push(ac.altFt);
        byCycle.set(key, entry);
      }
    }
    expect(byCycle.size).toBeGreaterThan(10);
    for (const { kind, alts } of byCycle.values()) {
      if (alts.length < 2) continue;
      if (kind === 'arrival') {
        expect(alts[0]).toBeGreaterThan(alts[alts.length - 1]);
        for (let i = 1; i < alts.length; i += 1) {
          expect(alts[i]).toBeLessThanOrEqual(alts[i - 1]);
        }
      } else if (kind === 'departure') {
        expect(alts[0]).toBeLessThan(alts[alts.length - 1]);
        for (let i = 1; i < alts.length; i += 1) {
          expect(alts[i]).toBeGreaterThanOrEqual(alts[i - 1]);
        }
      } else {
        for (const alt of alts) expect(alt).toBe(alts[0]);
      }
    }
  });

  it('flies realistic speeds and slows arrivals near the terminal', () => {
    const byCycle = new Map<string, { kind: string; speeds: number[] }>();
    for (let t = 0; t <= 3200; t += 10) {
      for (const ac of backgroundTrafficAt(t)) {
        expect(Number.isFinite(ac.speedKt)).toBe(true);
        expect(ac.speedKt).toBeGreaterThanOrEqual(100);
        expect(ac.speedKt).toBeLessThanOrEqual(450);
        const key = `${ac.slot}:${ac.cycle}`;
        const entry = byCycle.get(key) ?? { kind: ac.kind, speeds: [] };
        entry.speeds.push(ac.speedKt);
        byCycle.set(key, entry);
      }
    }
    let arrivals = 0;
    for (const { kind, speeds } of byCycle.values()) {
      if (kind !== 'arrival' || speeds.length < 3) continue;
      arrivals += 1;
      expect(speeds[0]).toBeGreaterThan(speeds[speeds.length - 1]);
      for (let i = 1; i < speeds.length; i += 1) {
        expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] + 1e-9);
      }
    }
    expect(arrivals).toBeGreaterThan(0);
  });

  it('keeps background aircraft spaced so none sit on top of each other', () => {
    expect(BG_MIN_SEP_NM).toBe(3);
    for (let t = 0; t <= 2400; t += 2) {
      const sky = backgroundTrafficAt(t);
      for (let i = 0; i < sky.length; i += 1) {
        for (let j = i + 1; j < sky.length; j += 1) {
          const dist = Math.hypot(sky[i].xNm - sky[j].xNm, sky[i].yNm - sky[j].yNm);
          expect(dist).toBeGreaterThanOrEqual(BG_MIN_SEP_NM - 1e-6);
        }
      }
    }
  });

  it('never shows alarming words on hover labels', () => {
    for (let t = 0; t <= 1200; t += 15) {
      for (const ac of backgroundTrafficAt(t)) {
        const tip = formatBgTip(ac).toLowerCase();
        for (const word of FORBIDDEN) {
          expect(tip).not.toContain(word);
        }
      }
    }
  });
});

describe('PARKED_AIRCRAFT', () => {
  it('holds three static gate stands with generic callsigns', () => {
    expect(PARKED_AIRCRAFT).toHaveLength(3);
    for (const ac of PARKED_AIRCRAFT) {
      expect(ac.callsign).toMatch(/^SIM [1-8]\d\d$/);
      expect(formatBgTip(ac)).toMatch(/^SIM [1-8]\d\d · [\d,]+ ft$/);
      const tip = formatBgTip(ac).toLowerCase();
      for (const word of FORBIDDEN) {
        expect(tip).not.toContain(word);
      }
    }
    const slots = PARKED_AIRCRAFT.map((ac) => ac.slot);
    expect(new Set(slots).size).toBe(3);
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(BG_TRAFFIC_COUNT);
    }
  });

  it('keeps gates spaced, off the live track, and clear of the stream', () => {
    for (let i = 0; i < PARKED_AIRCRAFT.length; i += 1) {
      for (let j = i + 1; j < PARKED_AIRCRAFT.length; j += 1) {
        const a = PARKED_AIRCRAFT[i];
        const b = PARKED_AIRCRAFT[j];
        expect(Math.hypot(a.xNm - b.xNm, a.yNm - b.yNm)).toBeGreaterThanOrEqual(BG_MIN_SEP_NM);
      }
    }
    for (let t = 0; t <= 720; t += 2) {
      const own = { x: gradualX(t), y: 0 };
      const sky = backgroundTrafficAt(t);
      for (const gate of PARKED_AIRCRAFT) {
        expect(Math.hypot(gate.xNm - own.x, gate.yNm - own.y)).toBeGreaterThanOrEqual(
          AIRPORT_LIVE_CLEARANCE_NM,
        );
        for (const ac of sky) {
          expect(Math.hypot(gate.xNm - ac.xNm, gate.yNm - ac.yNm)).toBeGreaterThanOrEqual(
            BG_MIN_SEP_NM,
          );
        }
      }
    }
  });
});
