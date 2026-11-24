import { ANSI } from '../ansi.js';
import { formatInline } from './inline.js';
import { highlightCode } from './code.js';
import {
  computeTableLayout,
  formatTableRow,
  formatTableBorder,
  parseTableAlignments,
} from './table.js';
import { tokenizeMarkdown } from './tokenize.js';

export interface RenderMarkdownOptions {
  columns?: number;
  hyperlinks?: boolean;
}

/**
 * Renders complete markdown text into rich ANSI terminal formatted output.
 */
export function renderMarkdown(text: string, options: RenderMarkdownOptions = {}): string {
  if (!text) return '';
  const columns = options.columns || (typeof process !== 'undefined' && process.stdout?.columns) || 80;
  const tokens = tokenizeMarkdown(text);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    switch (token.type) {
      case 'heading': {
        const prefix = token.level <= 2 ? '\r\n' : '';
        const color = token.level === 1 ? ANSI.brightCyan : ANSI.cyan;
        out.push(`${prefix}${ANSI.bold}${color}${token.text}${ANSI.reset}`);
        break;
      }

      case 'code_block': {
        const lang = token.lang || 'code';
        const boxWidth = Math.min(columns - 4, 60);
        const topBar = `${ANSI.dim}┌─── ${lang} ${'─'.repeat(Math.max(0, boxWidth - (lang.length + 6)))}┐${ANSI.reset}`;
        const bottomBar = `${ANSI.dim}└───${'─'.repeat(Math.max(0, boxWidth - 4))}┘${ANSI.reset}`;
        const highlighted = highlightCode(token.code, token.lang);
        const indentedCode = highlighted
          .split(/\r?\n/)
          .map((line) => `  ${line}`)
          .join('\r\n');
        out.push(`${topBar}\r\n${indentedCode}\r\n${bottomBar}`);
        break;
      }

      case 'table': {
        const alignments = parseTableAlignments(token.delimiter);
        const layout = computeTableLayout(token.headers, token.rows, alignments, columns);
        if (layout.colWidths.length > 0) {
          const tableLines: string[] = [];
          tableLines.push(formatTableBorder(layout.colWidths, '┌', '┬', '┐'));
          tableLines.push(formatTableRow(token.headers, layout, true));
          tableLines.push(formatTableBorder(layout.colWidths, '├', '┼', '┤'));
          for (const row of token.rows) {
            tableLines.push(formatTableRow(row, layout));
          }
          tableLines.push(formatTableBorder(layout.colWidths, '└', '┴', '┘'));
          out.push(tableLines.join('\r\n'));
        }
        break;
      }

      case 'list_item': {
        const indentStr = ' '.repeat(token.indent);
        const content = formatInline(token.text, { hyperlinks: options.hyperlinks });
        if (token.ordered && token.num !== undefined) {
          out.push(`${indentStr}  ${ANSI.bold}${token.num}.${ANSI.reset} ${content}`);
        } else {
          out.push(`${indentStr}  • ${content}`);
        }
        break;
      }

      case 'blockquote': {
        const formatted = formatInline(token.text, { hyperlinks: options.hyperlinks });
        const quoteLines = formatted
          .split(/\r?\n/)
          .map((line) => `${ANSI.dim}│${ANSI.reset} ${ANSI.italic}${line}${ANSI.reset}`)
          .join('\r\n');
        out.push(quoteLines);
        break;
      }

      case 'hr': {
        const hrWidth = Math.min(columns - 4, 48);
        out.push(`${ANSI.dim}${'─'.repeat(hrWidth)}${ANSI.reset}`);
        break;
      }

      case 'paragraph': {
        const formatted = formatInline(token.text, { hyperlinks: options.hyperlinks });
        out.push(formatted);
        break;
      }
    }
  }

  return out.join('\r\n');
}
