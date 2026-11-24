import { ANSI } from '../ansi.js';
import { formatInline, visibleWidth, truncateWidth } from './inline.js';

export type ColumnAlignment = 'left' | 'center' | 'right';

export interface ParsedTableRow {
  cells: string[];
}

/** Parses a markdown table row into trimmed cell strings, handling escaped pipes \| */
export function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Strip leading and trailing pipes if present
  let body = trimmed;
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);

  // Split on unescaped pipes
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (ch === '|' && !escaped) {
      cells.push(current.trim());
      current = '';
    } else {
      if (escaped) {
        current += '\\';
        escaped = false;
      }
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Checks whether a line is a markdown table delimiter row (e.g. |---|:---:|---:|) */
export function isTableDelimiterRow(line: string): boolean {
  const cells = parseTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

/** Parses column alignments from a delimiter row */
export function parseTableAlignments(delimiterLine: string): ColumnAlignment[] {
  const cells = parseTableRow(delimiterLine);
  return cells.map((cell) => {
    const c = cell.trim();
    const startColon = c.startsWith(':');
    const endColon = c.endsWith(':');
    if (startColon && endColon) return 'center';
    if (endColon) return 'right';
    return 'left';
  });
}

export interface TableLayout {
  colWidths: number[];
  alignments: ColumnAlignment[];
  totalWidth: number;
}

/**
 * Computes optimal column widths based on buffered sample rows (header + first 2 data rows)
 * and available terminal width.
 */
export function computeTableLayout(
  headers: string[],
  sampleRows: string[][],
  alignments: ColumnAlignment[],
  terminalWidth: number = 80,
): TableLayout {
  const numCols = headers.length;
  if (numCols === 0) {
    return { colWidths: [], alignments: [], totalWidth: 0 };
  }

  // 1. Calculate raw content widths
  const rawWidths: number[] = new Array(numCols).fill(0);
  for (let i = 0; i < numCols; i++) {
    const h = headers[i] || '';
    rawWidths[i] = Math.max(rawWidths[i]!, visibleWidth(h));
  }

  for (const row of sampleRows) {
    for (let i = 0; i < numCols; i++) {
      const cell = row[i] || '';
      rawWidths[i] = Math.max(rawWidths[i]!, visibleWidth(cell));
    }
  }

  // Ensure minimum cell width of at least 3 chars
  const minColWidth = 3;
  const colWidths = rawWidths.map((w) => Math.max(minColWidth, w));

  // Border overhead: '│ ' + (numCols - 1) * ' │ ' + ' │' = 3 * numCols + 1
  const borderOverhead = 3 * numCols + 1;
  const maxAvailable = Math.max(20, terminalWidth - 2);
  const maxContentBudget = maxAvailable - borderOverhead;

  const totalContentWidth = colWidths.reduce((a, b) => a + b, 0);

  // If table fits in terminal width, use ideal widths
  if (totalContentWidth <= maxContentBudget || maxContentBudget <= minColWidth * numCols) {
    return {
      colWidths,
      alignments: alignments.slice(0, numCols),
      totalWidth: totalContentWidth + borderOverhead,
    };
  }

  // Otherwise, scale columns down proportionally to fit terminal
  const scaledWidths: number[] = new Array(numCols).fill(minColWidth);
  const remainingBudget = maxContentBudget - minColWidth * numCols;
  const expandableDemand = totalContentWidth - minColWidth * numCols;

  if (expandableDemand > 0 && remainingBudget > 0) {
    for (let i = 0; i < numCols; i++) {
      const extra = colWidths[i]! - minColWidth;
      const share = Math.floor((extra / expandableDemand) * remainingBudget);
      scaledWidths[i]! += share;
    }
  }

  const finalTotal = scaledWidths.reduce((a, b) => a + b, 0) + borderOverhead;
  return {
    colWidths: scaledWidths,
    alignments: alignments.slice(0, numCols),
    totalWidth: finalTotal,
  };
}

/** Formats a single table row with padded/aligned cells and box borders */
export function formatTableRow(
  cells: string[],
  layout: TableLayout,
  isHeader = false,
): string {
  const parts: string[] = [];

  for (let i = 0; i < layout.colWidths.length; i++) {
    const width = layout.colWidths[i]!;
    const rawCell = cells[i] || '';
    const align = layout.alignments[i] || 'left';

    // Truncate cell if it exceeds column width
    const truncated = truncateWidth(rawCell, width);
    const visW = visibleWidth(truncated);
    const paddingNeeded = Math.max(0, width - visW);

    let formattedContent: string;
    if (isHeader) {
      formattedContent = `${ANSI.bold}${ANSI.brightCyan}${truncated}${ANSI.reset}`;
    } else {
      formattedContent = formatInline(truncated);
    }

    let cellText: string;
    if (align === 'right') {
      cellText = ' '.repeat(paddingNeeded) + formattedContent;
    } else if (align === 'center') {
      const leftPad = Math.floor(paddingNeeded / 2);
      const rightPad = paddingNeeded - leftPad;
      cellText = ' '.repeat(leftPad) + formattedContent + ' '.repeat(rightPad);
    } else {
      cellText = formattedContent + ' '.repeat(paddingNeeded);
    }

    parts.push(` ${cellText} `);
  }

  return `${ANSI.dim}│${ANSI.reset}${parts.join(`${ANSI.dim}│${ANSI.reset}`)}${ANSI.dim}│${ANSI.reset}`;
}

/** Builds horizontal box-drawing separator line */
export function formatTableBorder(
  colWidths: number[],
  left: string,
  mid: string,
  right: string,
  fill = '─',
): string {
  const segments = colWidths.map((w) => fill.repeat(w + 2));
  return `${ANSI.dim}${left}${segments.join(mid)}${right}${ANSI.reset}`;
}

/**
 * Two-phase progressive table streaming processor.
 * Buffers the header, separator, and up to 2 data rows to compute layout
 * against available terminal columns, then streams subsequent rows line-by-line.
 */
export class ProgressiveTableStreamer {
  private buffer: string[] = [];
  private headers: string[] | null = null;
  private alignments: ColumnAlignment[] = [];
  private layout: TableLayout | null = null;
  private streamedPhase2 = false;

  constructor(private columns: number = 80) {}

  public setColumns(cols: number): void {
    if (cols > 0) this.columns = cols;
  }

  public isBuffering(): boolean {
    return !this.streamedPhase2 && this.buffer.length > 0;
  }

  /**
   * Consumes a table line (header, delimiter, or row).
   * Returns formatted ANSI text if layout is resolved or a row is emitted.
   */
  public addRow(line: string): string {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') && !trimmed.endsWith('|')) {
      // Not a table line, flush table and return
      return this.flush();
    }

    if (!this.headers) {
      // First line is header
      this.headers = parseTableRow(line);
      return '';
    }

    if (this.alignments.length === 0 && isTableDelimiterRow(line)) {
      // Delimiter row
      this.alignments = parseTableAlignments(line);
      return '';
    }

    const cells = parseTableRow(line);

    // If still in Phase 1 (buffering rows)
    if (!this.streamedPhase2) {
      this.buffer.push(line);
      // Wait for 2 data rows before emitting Phase 1
      if (this.buffer.length >= 2) {
        return this.enterPhase2();
      }
      return '';
    }

    // Phase 2: Stream row immediately with ellipsis truncation
    return formatTableRow(cells, this.layout!) + '\r\n';
  }

  private enterPhase2(): string {
    if (!this.headers) return '';
    const sampleRows = this.buffer.map((b) => parseTableRow(b));
    this.layout = computeTableLayout(this.headers, sampleRows, this.alignments, this.columns);
    this.streamedPhase2 = true;

    const out: string[] = [];
    // Top border
    out.push(formatTableBorder(this.layout.colWidths, '┌', '┬', '┐'));
    // Header row
    out.push(formatTableRow(this.headers, this.layout, true));
    // Header separator
    out.push(formatTableBorder(this.layout.colWidths, '├', '┼', '┤'));
    // Buffered data rows
    for (const rawLine of this.buffer) {
      out.push(formatTableRow(parseTableRow(rawLine), this.layout));
    }
    this.buffer = [];

    return out.join('\r\n') + '\r\n';
  }

  /** Flushes any buffered table rows and renders the bottom border */
  public flush(): string {
    let out = '';
    if (!this.streamedPhase2 && this.headers) {
      // Flushed before 2 rows were buffered
      out += this.enterPhase2();
    }
    if (this.streamedPhase2 && this.layout) {
      out += formatTableBorder(this.layout.colWidths, '└', '┴', '┘') + '\r\n';
    }

    this.headers = null;
    this.alignments = [];
    this.buffer = [];
    this.layout = null;
    this.streamedPhase2 = false;

    return out;
  }
}
