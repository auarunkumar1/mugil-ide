/** Minimal glob matcher supporting `**`, `*`, `?` and `{a,b}`. */

function escapeRegex(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

function segmentToRegex(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const end = segment.indexOf('}', i);
      const alternatives = segment
        .slice(i + 1, end === -1 ? segment.length : end)
        .split(',')
        .map((alt) => escapeRegex(alt))
        .join('|');
      out += `(?:${alternatives})`;
      i = end === -1 ? segment.length : end;
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

/** Converts a glob pattern (with `/` separators) into an anchored RegExp. */
export function globToRegex(pattern: string): RegExp {
  const segments = pattern.split('/');
  let out = '';
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment === '**') {
      out += i === segments.length - 1 ? '(?:.*)?' : '(?:.*/)?';
    } else {
      out += segmentToRegex(segment);
      if (i < segments.length - 1) out += '/';
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when the relative path (forward slashes) matches any of the globs. */
export function matchesAny(relativePath: string, globs: RegExp[]): boolean {
  return globs.some((glob) => glob.test(relativePath));
}
