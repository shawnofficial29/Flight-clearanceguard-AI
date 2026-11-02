/** Pure presentation helpers shared by panels (and their tests). */

export function formatSeconds(value: number): string {
  return `${Math.round(value)} seconds`;
}

/** Whole-second margin between conflict time and last safe correction. */
export function safetyMargin(
  conflictS: number | null | undefined,
  lastSafeS: number | null | undefined,
): number | null {
  if (conflictS === null || conflictS === undefined) return null;
  if (lastSafeS === null || lastSafeS === undefined) return null;
  return Math.round(conflictS - lastSafeS);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function compactValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return truncate(value.map((item) => String(item)).join(', '), 60);
    }
    return `${value.length} items`;
  }
  return '{…}';
}

/** One-line human summary of a coordinator tool-call result (JSON or text). */
export function summarizeToolCall(summary: string): string {
  const text = summary.trim();
  if (text === '') return 'No output.';
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(parsed)) {
        const compact = compactValue(value);
        if (compact !== null) parts.push(`${key}: ${compact}`);
        if (parts.join('; ').length > 120) break;
      }
      if (parts.length > 0) return truncate(parts.join('; '), 140);
      return 'Done.';
    }
  } catch {
    // Not JSON: fall through to the raw first line.
  }
  return truncate(text.split('\n')[0], 140);
}

/** Full technical output for the collapsed details section. */
export function formatTechnicalOutput(summary: string): string {
  try {
    const parsed: unknown = JSON.parse(summary);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return summary;
  }
}
