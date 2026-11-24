import { ANSI } from '../ansi.js';
import { highlightCode } from './code.js';
import { ProgressiveTableStreamer } from './table.js';

export interface StreamMarkdownOptions {
  columns?: number;
  hyperlinks?: boolean;
}

/**
 * Real-time width-aware streaming markdown formatter.
 * Formats incoming chunks token-by-token on the wire, holding back only ambiguous
 * boundary tokens across chunks (e.g. *, **, ```, #, |, [, ~~), ensuring immediate token
 * delivery while progressively rendering headers, bullets, task lists, code blocks, and tables.
 */
export class StreamMarkdown {
  private inCodeBlock = false;
  private codeLang = '';
  private inInlineCode = false;
  private inBold = false;
  private inItalic = false;
  private inStrike = false;
  private inHeader = false;
  private atLineStart = true;
  private prefixBuffer = '';
  private starBuffer = '';
  private tildeBuffer = '';
  private linkBuffer = '';
  private inLink = false;
  private lineBuffer = '';
  private tableStreamer: ProgressiveTableStreamer;
  private inTable = false;
  private columns: number;
  private hyperlinks: boolean;

  constructor(options: StreamMarkdownOptions = {}) {
    this.columns = options.columns || (typeof process !== 'undefined' && process.stdout?.columns) || 80;
    this.hyperlinks = options.hyperlinks ?? true;
    this.tableStreamer = new ProgressiveTableStreamer(this.columns);
  }

  public setColumns(cols: number): void {
    if (cols > 0) {
      this.columns = cols;
      this.tableStreamer.setColumns(cols);
    }
  }

  public process(chunk: string): string {
    let out = '';

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;

      // Handle newlines
      if (ch === '\n') {
        // Flush any pending inline buffers
        if (this.starBuffer) {
          out += this.starBuffer;
          this.starBuffer = '';
        }
        if (this.tildeBuffer) {
          out += this.tildeBuffer;
          this.tildeBuffer = '';
        }
        if (this.inLink && this.linkBuffer) {
          out += this.linkBuffer;
          this.linkBuffer = '';
          this.inLink = false;
        }

        const line = this.lineBuffer;
        this.lineBuffer = '';

        // Opening fenced code block: the fence may still be sitting in
        // prefixBuffer, so detect it before the generic prefix flush.
        const combined = line;
        if (!this.inCodeBlock && combined.trim().startsWith('```')) {
          const fence = combined.trim();
          this.prefixBuffer = '';
          this.inCodeBlock = true;
          this.codeLang = fence.slice(3).trim();
          const langDisplay = this.codeLang || 'code';
          const boxWidth = Math.min(this.columns - 4, 60);
          out += `${ANSI.dim}┌─── ${langDisplay} ${'─'.repeat(Math.max(0, boxWidth - (langDisplay.length + 6)))}┐${ANSI.reset}\r\n`;
          this.atLineStart = true;
          continue;
        }

        // If prefixBuffer was never resolved before newline
        if (this.prefixBuffer) {
          // Horizontal rule check: ---, ***, ___
          if (/^(?:[-*_]\s*){3,}$/.test(this.prefixBuffer.trim())) {
            const hrWidth = Math.min(this.columns - 4, 48);
            out += `${ANSI.dim}${'─'.repeat(hrWidth)}${ANSI.reset}\r\n`;
            this.prefixBuffer = '';
            this.atLineStart = true;
            continue;
          }
          const bulletMatch = this.prefixBuffer.match(/^(\s*)([-*])\s*$/);
          if (bulletMatch) {
            const indent = bulletMatch[1] || '';
            out += `${indent}  • `;
          } else {
            out += this.prefixBuffer;
          }
          this.prefixBuffer = '';
        }

        this.atLineStart = true;

        // Table line processing
        if (this.inTable || line.trim().startsWith('|')) {
          if (line.trim().startsWith('|')) {
            this.inTable = true;
            out += this.tableStreamer.addRow(line);
            continue;
          } else {
            // Table ended
            this.inTable = false;
            out += this.tableStreamer.flush();
          }
        }

        // Code block processing
        if (this.inCodeBlock) {
          if (line.trim().startsWith('```')) {
            // Closing fence
            this.inCodeBlock = false;
            const boxWidth = Math.min(this.columns - 4, 60);
            out += `${ANSI.dim}└───${'─'.repeat(Math.max(0, boxWidth - 4))}┘${ANSI.reset}\r\n`;
            continue;
          }
          // Highlight code line
          const highlighted = highlightCode(line, this.codeLang);
          out += `  ${highlighted}\r\n`;
          continue;
        }

        // Opening code fence
        if (line.trim().startsWith('```')) {
          this.inCodeBlock = true;
          this.codeLang = line.trim().slice(3).trim();
          const langDisplay = this.codeLang || 'code';
          const boxWidth = Math.min(this.columns - 4, 60);
          out += `${ANSI.dim}┌─── ${langDisplay} ${'─'.repeat(Math.max(0, boxWidth - (langDisplay.length + 6)))}┐${ANSI.reset}\r\n`;
          continue;
        }

        // Header line finish
        if (this.inHeader) {
          out += ANSI.reset + '\r\n';
          this.inHeader = false;
          continue;
        }

        // Horizontal rule
        if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
          const hrWidth = Math.min(this.columns - 4, 48);
          out += `${ANSI.dim}${'─'.repeat(hrWidth)}${ANSI.reset}\r\n`;
          continue;
        }

        // Reset inline styles that shouldn't spill across lines without continuation
        if (this.inBold || this.inItalic || this.inStrike || this.inInlineCode) {
          out += ANSI.reset;
          this.inBold = false;
          this.inItalic = false;
          this.inStrike = false;
          this.inInlineCode = false;
        }

        out += '\r\n';
        continue;
      }

      if (ch === '\r') continue;

      this.lineBuffer += ch;

      // Inside a code block, accumulate line characters until \n
      if (this.inCodeBlock) {
        continue;
      }

      // 1. Process line-start prefix buffering
      if (this.atLineStart) {
        // Resolve bullet vs task list based on upcoming character
        if (/^(\s*)([-*])\s+$/.test(this.prefixBuffer)) {
          if (ch === '[') {
            this.prefixBuffer += '[';
            continue;
          }
          if (ch === ' ') {
            this.prefixBuffer += ' ';
            continue;
          }
          const indent = this.prefixBuffer.match(/^(\s*)/)?.[1] || '';
          out += `${indent}  • `;
          this.atLineStart = false;
          this.prefixBuffer = '';
          out += this.processInlineChar(ch);
          continue;
        } else if (/^(\s*)([-*])\s+\[$/.test(this.prefixBuffer)) {
          if (ch === ' ' || ch === 'x' || ch === 'X') {
            this.prefixBuffer += ch;
            continue;
          }
          const indent = this.prefixBuffer.match(/^(\s*)/)?.[1] || '';
          out += `${indent}  • `;
          this.atLineStart = false;
          this.prefixBuffer = '';
          this.inLink = true;
          this.linkBuffer = '[';
          out += this.processInlineChar(ch);
          continue;
        } else if (/^(\s*)([-*])\s+\[([ xX])$/.test(this.prefixBuffer)) {
          if (ch === ']') {
            this.prefixBuffer += ']';
            continue;
          }
          const indent = this.prefixBuffer.match(/^(\s*)/)?.[1] || '';
          out += `${indent}  • ` + this.prefixBuffer.slice(indent.length + 2);
          this.atLineStart = false;
          this.prefixBuffer = '';
          out += this.processInlineChar(ch);
          continue;
        } else if (/^(\s*)([-*])\s+\[([ xX])\]$/.test(this.prefixBuffer)) {
          if (ch === ' ') {
            const taskMatch = (this.prefixBuffer + ' ').match(/^(\s*)([-*])\s+\[([ xX])\]\s$/);
            const indent = taskMatch?.[1] || '';
            const checked = taskMatch?.[3]!.toLowerCase() === 'x';
            const box = checked ? `${ANSI.green}☑${ANSI.reset}` : `${ANSI.cyan}☐${ANSI.reset}`;
            out += `${indent}  ${box} `;
            this.atLineStart = false;
            this.prefixBuffer = '';
            continue;
          }
          const buf = this.prefixBuffer;
          this.prefixBuffer = '';
          this.atLineStart = false;
          for (const c of buf) {
            out += this.processInlineChar(c);
          }
          out += this.processInlineChar(ch);
          continue;
        }

        if (this.atLineStart) {
          // If prefixBuffer is empty and ch cannot start any block element,
          // switch directly to inline mode without buffering
          if (!this.prefixBuffer && !/^[\s#>*\-_|`0-9]$/.test(ch)) {
            this.atLineStart = false;
            out += this.processInlineChar(ch);
            continue;
          }

          this.prefixBuffer += ch;

          // Table row start
          if (this.prefixBuffer.trim() === '|' || (this.inTable && ch === '|')) {
            this.inTable = true;
            this.atLineStart = false;
            this.prefixBuffer = '';
            continue;
          }

          // Code block opening fence
          if (this.prefixBuffer.startsWith('```')) {
            continue; // wait for language or newline
          }

          // Heading: #{1,6} followed by space
          const headingMatch = this.prefixBuffer.match(/^(#{1,6})\s$/);
          if (headingMatch) {
            this.inHeader = true;
            this.atLineStart = false;
            this.prefixBuffer = '';
            out += `\r\n${ANSI.bold}${ANSI.brightCyan}`;
            continue;
          }

          // Task list complete: - [ ] or - [x]
          const taskMatch = this.prefixBuffer.match(/^(\s*)([-*])\s+\[([ xX])\]\s$/);
          if (taskMatch) {
            const indent = taskMatch[1] || '';
            const checked = taskMatch[3]!.toLowerCase() === 'x';
            const box = checked ? `${ANSI.green}☑${ANSI.reset}` : `${ANSI.cyan}☐${ANSI.reset}`;
            out += `${indent}  ${box} `;
            this.atLineStart = false;
            this.prefixBuffer = '';
            continue;
          }

          // Bullet list prefix: wait to see if it's task list
          if (/^(\s*)([-*])\s$/.test(this.prefixBuffer)) {
            continue;
          }

          // Numbered list: 1. followed by space
          const numMatch = this.prefixBuffer.match(/^(\s*)(\d+)\.\s$/);
          if (numMatch) {
            const indent = numMatch[1] || '';
            const num = numMatch[2]!;
            out += `${indent}  ${ANSI.bold}${num}.${ANSI.reset} `;
            this.atLineStart = false;
            this.prefixBuffer = '';
            continue;
          }

          // Blockquote: > followed by space
          const quoteMatch = this.prefixBuffer.match(/^(\s*)(>+)\s$/);
          if (quoteMatch) {
            const indent = quoteMatch[1] || '';
            out += `${indent}  ${ANSI.dim}│${ANSI.reset} `;
            this.atLineStart = false;
            this.prefixBuffer = '';
            continue;
          }

          // Check if prefixBuffer is a valid partial prefix
          const isPossiblePrefix =
            /^\s*$/.test(this.prefixBuffer) ||
            /^\s*#{1,6}$/.test(this.prefixBuffer) ||
            /^\s*>+$/.test(this.prefixBuffer) ||
            /^\s*`{1,3}$/.test(this.prefixBuffer) ||
            /^\s*~{1,3}$/.test(this.prefixBuffer) ||
            /^\s*[-*_]{1,3}$/.test(this.prefixBuffer) ||
            /^\s*\d+\.?$/.test(this.prefixBuffer);

          if (!isPossiblePrefix || this.prefixBuffer.length > 12) {
            const buf = this.prefixBuffer;
            this.prefixBuffer = '';
            this.atLineStart = false;
            for (const c of buf) {
              out += this.processInlineChar(c);
            }
          }
          continue;
        }
      }

      // If we are accumulating table row
      if (this.inTable) {
        continue;
      }

      out += this.processInlineChar(ch);
    }

    return out;
  }

  private processInlineChar(ch: string): string {
    let out = '';

    // 2. Link buffering: [text](url)
    if (this.inLink) {
      this.linkBuffer += ch;
      if (ch === ')') {
        const linkMatch = this.linkBuffer.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const label = linkMatch[1]!;
          const url = linkMatch[2]!;
          if (this.hyperlinks) {
            out += `\x1b]8;;${url}\x1b\\${ANSI.brightCyan}${label}${ANSI.reset}\x1b]8;;\x1b\\`;
          } else {
            out += `${ANSI.brightCyan}${label}${ANSI.reset} ${ANSI.dim}(${url})${ANSI.reset}`;
          }
          this.linkBuffer = '';
          this.inLink = false;
          return out;
        }
      }
      if (this.linkBuffer.length > 500) {
        out += this.linkBuffer;
        this.linkBuffer = '';
        this.inLink = false;
      }
      return out;
    }

    if (ch === '[' && !this.inInlineCode) {
      this.inLink = true;
      this.linkBuffer = '[';
      return out;
    }

    // 3. Inline code toggle `
    if (ch === '`') {
      if (!this.inInlineCode) {
        this.inInlineCode = true;
        out += ANSI.yellow;
      } else {
        this.inInlineCode = false;
        out += ANSI.reset;
      }
      return out;
    }

    if (this.inInlineCode) {
      out += ch;
      return out;
    }

    // 4. Strikethrough toggle ~~
    if (ch === '~') {
      this.tildeBuffer += '~';
      if (this.tildeBuffer === '~~') {
        this.tildeBuffer = '';
        if (!this.inStrike) {
          this.inStrike = true;
          out += '\x1b[9m';
        } else {
          this.inStrike = false;
          out += ANSI.reset;
        }
      }
      return out;
    } else if (this.tildeBuffer) {
      out += this.tildeBuffer;
      this.tildeBuffer = '';
    }

    // 5. Bold & Italic toggle *
    if (ch === '*') {
      this.starBuffer += '*';
      if (this.starBuffer === '**') {
        this.starBuffer = '';
        if (!this.inBold) {
          this.inBold = true;
          out += ANSI.bold;
        } else {
          this.inBold = false;
          out += ANSI.reset;
        }
      }
      return out;
    } else if (this.starBuffer) {
      if (this.starBuffer === '*') {
        if (!this.inItalic) {
          this.inItalic = true;
          out += ANSI.italic;
        } else {
          this.inItalic = false;
          out += ANSI.reset;
        }
      } else {
        out += this.starBuffer;
      }
      this.starBuffer = '';
    }

    out += ch;
    return out;
  }

  public flush(): string {
    let out = '';

    if (this.prefixBuffer) {
      if (/^(?:[-*_]\s*){3,}$/.test(this.prefixBuffer.trim())) {
        const hrWidth = Math.min(this.columns - 4, 48);
        out += `${ANSI.dim}${'─'.repeat(hrWidth)}${ANSI.reset}\r\n`;
      } else {
        const bulletMatch = this.prefixBuffer.match(/^(\s*)([-*])\s*$/);
        if (bulletMatch) {
          const indent = bulletMatch[1] || '';
          out += `${indent}  • `;
        } else {
          for (const c of this.prefixBuffer) {
            out += this.processInlineChar(c);
          }
        }
      }
      this.prefixBuffer = '';
    }

    if (this.starBuffer) {
      out += this.starBuffer;
      this.starBuffer = '';
    }
    if (this.tildeBuffer) {
      out += this.tildeBuffer;
      this.tildeBuffer = '';
    }
    if (this.inLink && this.linkBuffer) {
      out += this.linkBuffer;
      this.linkBuffer = '';
      this.inLink = false;
    }

    // If still in table, flush it
    if (this.inTable) {
      if (this.lineBuffer.trim().startsWith('|')) {
        this.tableStreamer.addRow(this.lineBuffer);
      }
      out += this.tableStreamer.flush();
      this.inTable = false;
    }

    // Close any unclosed code block box
    if (this.inCodeBlock) {
      const boxWidth = Math.min(this.columns - 4, 60);
      out += `${ANSI.dim}└───${'─'.repeat(Math.max(0, boxWidth - 4))}┘${ANSI.reset}\r\n`;
      this.inCodeBlock = false;
    }

    // Reset styles
    if (this.inHeader || this.inBold || this.inItalic || this.inStrike || this.inInlineCode) {
      out += ANSI.reset;
    }

    this.inBold = false;
    this.inItalic = false;
    this.inStrike = false;
    this.inInlineCode = false;
    this.inHeader = false;
    this.atLineStart = true;
    this.lineBuffer = '';

    return out;
  }

  public reset(): void {
    this.flush();
  }
}
