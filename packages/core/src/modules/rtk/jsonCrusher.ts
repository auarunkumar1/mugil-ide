/**
 * JSON SmartCrusher (Headroom Pattern)
 * ===================================
 * Compresses repetitive, verbose JSON objects and arrays by 60%–90%:
 * - Converts arrays of objects with identical keys into compact tabular/CSV format.
 * - Strips null, undefined, and empty objects/arrays.
 * - Leaves small or non-tabular JSON readable and minimal.
 */

export function compressJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return raw;
  }

  const cleaned = cleanJsonValue(parsed);
  if (cleaned === undefined) return '';

  // 1. Array of uniform objects -> Tabular TSV format
  if (Array.isArray(cleaned) && cleaned.length >= 2 && cleaned.every(isPlainObject)) {
    const keys = Array.from(new Set(cleaned.flatMap((obj) => Object.keys(obj))));
    if (keys.length > 0 && keys.length <= 15) {
      const header = `[Table: ${cleaned.length} rows | cols: ${keys.join(', ')}]`;
      const rows = cleaned.map((row) =>
        keys.map((k) => formatValue((row as Record<string, unknown>)[k])).join('\t'),
      );
      return `${header}\n${keys.join('\t')}\n${rows.join('\n')}`;
    }
  }

  // 2. Compact JSON serialization (no multi-line whitespace padding)
  return JSON.stringify(cleaned);
}

function cleanJsonValue(val: unknown): unknown {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string' && val.length === 0) return undefined;

  if (Array.isArray(val)) {
    const cleanedArr = val.map(cleanJsonValue).filter((item) => item !== undefined);
    return cleanedArr.length > 0 ? cleanedArr : undefined;
  }

  if (isPlainObject(val)) {
    const res: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(val)) {
      const cleanedV = cleanJsonValue(v);
      if (cleanedV !== undefined) {
        res[k] = cleanedV;
        count++;
      }
    }
    return count > 0 ? res : undefined;
  }

  return val;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return '-';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val).replace(/[\r\n\t]+/g, ' ');
}
