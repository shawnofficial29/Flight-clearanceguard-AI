import { describe, expect, it } from 'vitest';
import {
  formatSeconds,
  formatTechnicalOutput,
  safetyMargin,
  summarizeToolCall,
} from './demoLabels';

describe('formatSeconds', () => {
  it('rounds to whole seconds', () => {
    expect(formatSeconds(215)).toBe('215 seconds');
    expect(formatSeconds(197.4)).toBe('197 seconds');
  });
});

describe('safetyMargin', () => {
  it('returns the whole-second gap between conflict and last safe correction', () => {
    expect(safetyMargin(215, 197)).toBe(18);
  });

  it('returns null when either time is missing', () => {
    expect(safetyMargin(null, 197)).toBeNull();
    expect(safetyMargin(215, null)).toBeNull();
    expect(safetyMargin(undefined, undefined)).toBeNull();
  });
});

describe('summarizeToolCall', () => {
  it('compacts a JSON object into one line', () => {
    expect(
      summarizeToolCall('{"overall": "mismatch", "categories": ["MISSING_CONDITION"]}'),
    ).toBe('overall: mismatch; categories: MISSING_CONDITION');
  });

  it('counts arrays of objects', () => {
    expect(summarizeToolCall('{"candidates": [{"id": "a"}, {"id": "b"}]}')).toBe(
      'candidates: 2 items',
    );
  });

  it('passes plain text through on one line', () => {
    expect(summarizeToolCall('Candidate x is unknown or unverified.')).toBe(
      'Candidate x is unknown or unverified.',
    );
  });

  it('handles empty output', () => {
    expect(summarizeToolCall('  ')).toBe('No output.');
  });
});

describe('formatTechnicalOutput', () => {
  it('pretty-prints JSON', () => {
    expect(formatTechnicalOutput('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('leaves plain text untouched', () => {
    expect(formatTechnicalOutput('boom')).toBe('boom');
  });
});
