import { parseTableRow, isTableDelimiterRow } from './table.js';

export type BlockToken =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code_block'; lang: string; code: string }
  | { type: 'table'; headers: string[]; delimiter: string; rows: string[][] }
  | { type: 'list_item'; ordered: boolean; num?: number; indent: number; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string };

/**
 * Tokenizes GFM markdown into structured block tokens.
 */
export function tokenizeMarkdown(text: string): BlockToken[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const tokens: BlockToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    // Blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // Code block
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length && lines[i]!.trim().startsWith('```')) {
        i++; // skip closing fence
      }
      tokens.push({ type: 'code_block', lang, code: codeLines.join('\n') });
      continue;
    }

    // Heading: #...
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        level: headingMatch[1]!.length,
        text: headingMatch[2]!.trim(),
      });
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) {
      tokens.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote: > ...
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s*/, ''));
        i++;
      }
      tokens.push({ type: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Table: starts with | and next line is delimiter
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableDelimiterRow(lines[i + 1]!)) {
      const headers = parseTableRow(rawLine);
      const delimiter = lines[i + 1]!;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(parseTableRow(lines[i]!));
        i++;
      }
      tokens.push({ type: 'table', headers, delimiter, rows });
      continue;
    }

    // Unordered List: * or - or +
    const uListMatch = rawLine.match(/^(\s*)([*+-])\s+(.*)$/);
    if (uListMatch) {
      tokens.push({
        type: 'list_item',
        ordered: false,
        indent: uListMatch[1]!.length,
        text: uListMatch[3]!.trim(),
      });
      i++;
      continue;
    }

    // Ordered List: 1.
    const oListMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (oListMatch) {
      tokens.push({
        type: 'list_item',
        ordered: true,
        num: parseInt(oListMatch[2]!, 10),
        indent: oListMatch[1]!.length,
        text: oListMatch[3]!.trim(),
      });
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.trim().startsWith('```') &&
      !/^#{1,6}\s+/.test(lines[i]!.trim()) &&
      !/^(?:[-*_]\s*){3,}$/.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith('>') &&
      !/^\s*([*+-]|\d+\.)\s+/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    tokens.push({ type: 'paragraph', text: paraLines.join('\n') });
  }

  return tokens;
}
