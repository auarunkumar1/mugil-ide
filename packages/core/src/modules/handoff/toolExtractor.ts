/**
 * Textual Tool Call Extractor
 *
 * Fallback parser for local LLMs (llama.cpp, Ollama, LM Studio, vLLM) that output
 * tool/function calls within message content (as XML tags, markdown code blocks, or raw JSON)
 * rather than in the OpenAI `message.tool_calls` structured array.
 */
import type { ToolCall } from '../../types.js';

export interface ExtractedToolCalls {
  toolCalls: ToolCall[];
  cleanContent: string;
}

/** Finds the end index of a balanced JSON object starting at startIndex. */
export function findBalancedJsonObject(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Extracts tool calls from text content if present, returning the parsed ToolCalls
 * and the cleaned content without the raw tool call markup.
 */
export function extractTextualToolCalls(content: string): ExtractedToolCalls {
  if (!content || !content.includes('{') || !content.includes('"name"')) {
    return { toolCalls: [], cleanContent: content };
  }

  const toolCalls: ToolCall[] = [];
  let cleanContent = content;

  // Helper to parse a JSON candidate and construct ToolCall(s)
  const tryParse = (rawJson: string): boolean => {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        let added = false;
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof item.name === 'string') {
            const args = item.arguments ?? item.parameters ?? item.input ?? {};
            toolCalls.push({
              id: item.id || `call_${Math.random().toString(36).slice(2, 9)}`,
              name: item.name,
              arguments: typeof args === 'string' ? args : JSON.stringify(args),
            });
            added = true;
          }
        }
        return added;
      }
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
        const args = parsed.arguments ?? parsed.parameters ?? parsed.input ?? {};
        toolCalls.push({
          id: parsed.id || `call_${Math.random().toString(36).slice(2, 9)}`,
          name: parsed.name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args),
        });
        return true;
      }
    } catch {
      // Not valid JSON
    }
    return false;
  };

  // 1. <tool_call> ... </tool_call> tags (Qwen2.5 / ChatML native tool tags)
  const toolCallTagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  cleanContent = cleanContent.replace(toolCallTagRegex, (match, jsonText) => {
    if (tryParse(jsonText.trim())) {
      return '';
    }
    return match;
  });

  // 2. [TOOL_CALLS] ... [/TOOL_CALLS] or [TOOL_CALLS] [...] (Hermes / Mistral)
  const toolCallsBracketRegex = /\[TOOL_CALLS\]\s*([\s\S]*?)(?:\[\/TOOL_CALLS\]|$)/gi;
  cleanContent = cleanContent.replace(toolCallsBracketRegex, (match, jsonText) => {
    if (tryParse(jsonText.trim())) {
      return '';
    }
    return match;
  });

  // 3. ```(json|xml|tool_call)? ... ``` code blocks containing {"name": ...}
  const codeBlockRegex = /```(?:json|xml|tool_call)?\s*(\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\})\s*```/gi;
  cleanContent = cleanContent.replace(codeBlockRegex, (match, jsonText) => {
    if (tryParse(jsonText.trim())) {
      return '';
    }
    return match;
  });

  // 4. Fallback: bare JSON object with "name": "tool_name"
  if (toolCalls.length === 0) {
    let searchIdx = 0;
    while (searchIdx < cleanContent.length) {
      const match = cleanContent.slice(searchIdx).search(/\{[\s\n\r]*"name"[\s\n\r]*:/);
      if (match === -1) break;
      const startPos = searchIdx + match;
      const balanced = findBalancedJsonObject(cleanContent, startPos);
      if (balanced && tryParse(balanced.trim())) {
        cleanContent = cleanContent.slice(0, startPos) + cleanContent.slice(startPos + balanced.length);
        searchIdx = startPos;
      } else {
        searchIdx = startPos + 1;
      }
    }
  }

  // Clean up residual tool response tags, whitespace or empty code fences
  cleanContent = cleanContent
    .replace(/<tool_response>[\s\S]*?<\/tool_response>/gi, '')
    .replace(/```(?:json|xml|tool_call)?\s*```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { toolCalls, cleanContent };
}

/**
 * Streaming tool call filter.
 * Buffers and suppresses textual tool call syntax (<tool_call>, [TOOL_CALLS], ```json {"name":...}```)
 * from being streamed directly to user-facing text handlers (onDelta).
 */
export class StreamToolFilter {
  private buffer = '';

  process(chunk: string, onDelta: (text: string) => void): void {
    this.buffer += chunk;

    for (;;) {
      // 1. If buffer has a <tool_call> tag
      const toolCallStart = this.buffer.indexOf('<tool_call>');
      if (toolCallStart !== -1) {
        if (toolCallStart > 0) {
          onDelta(this.buffer.slice(0, toolCallStart));
          this.buffer = this.buffer.slice(toolCallStart);
        }
        const toolCallEnd = this.buffer.indexOf('</tool_call>');
        if (toolCallEnd !== -1) {
          this.buffer = this.buffer.slice(toolCallEnd + 12);
          continue;
        } else {
          return;
        }
      }

      // 1b. If buffer has a <tool_response> tag (Qwen / ChatML tool echo)
      const toolRespStart = this.buffer.indexOf('<tool_response>');
      if (toolRespStart !== -1) {
        if (toolRespStart > 0) {
          onDelta(this.buffer.slice(0, toolRespStart));
          this.buffer = this.buffer.slice(toolRespStart);
        }
        const toolRespEnd = this.buffer.indexOf('</tool_response>');
        if (toolRespEnd !== -1) {
          this.buffer = this.buffer.slice(toolRespEnd + 16);
          continue;
        } else {
          return;
        }
      }

      // Check partial <tool_call> or <tool_response> prefix
      const partialToolTag = this.buffer.match(/<t?(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l)?)?)?|r(?:e(?:s(?:p(?:o(?:n(?:s(?:e)?)?)?)?)?)?)?)?)?)?)?)?$/);
      if (partialToolTag && partialToolTag.index !== undefined && partialToolTag.index > 0) {
        onDelta(this.buffer.slice(0, partialToolTag.index));
        this.buffer = this.buffer.slice(partialToolTag.index);
        return;
      }

      // 2. If buffer has [TOOL_CALLS]
      const toolCallsStart = this.buffer.indexOf('[TOOL_CALLS]');
      if (toolCallsStart !== -1) {
        if (toolCallsStart > 0) {
          onDelta(this.buffer.slice(0, toolCallsStart));
          this.buffer = this.buffer.slice(toolCallsStart);
        }
        const toolCallsEnd = this.buffer.indexOf('[/TOOL_CALLS]');
        if (toolCallsEnd !== -1) {
          this.buffer = this.buffer.slice(toolCallsEnd + 13);
          continue;
        } else {
          return;
        }
      }

      // 3. If buffer has ```(json|xml|tool_call)? code block
      const fenceMatch = this.buffer.match(/```(?:json|xml|tool_call)?\s*/i);
      if (fenceMatch && fenceMatch.index !== undefined) {
        const fenceStart = fenceMatch.index;
        const afterFence = fenceStart + fenceMatch[0].length;
        const rest = this.buffer.slice(afterFence);

        // Check if the content inside fence starts with JSON object containing "name"
        if (rest.length < 50 && !rest.includes('```')) {
          if (fenceStart > 0) {
            onDelta(this.buffer.slice(0, fenceStart));
            this.buffer = this.buffer.slice(fenceStart);
          }
          return;
        }

        const looksLikeToolCall = /^\s*\[?\s*\{[\s\S]*?"name"\s*:/i.test(rest);
        if (looksLikeToolCall) {
          if (fenceStart > 0) {
            onDelta(this.buffer.slice(0, fenceStart));
            this.buffer = this.buffer.slice(fenceStart);
          }
          const closingFence = this.buffer.indexOf('```', fenceStart + 3);
          if (closingFence !== -1) {
            const endIdx = closingFence + 3;
            const candidateBlock = this.buffer.slice(fenceStart, endIdx);
            const extracted = extractTextualToolCalls(candidateBlock);
            if (extracted.toolCalls.length > 0) {
              this.buffer = this.buffer.slice(endIdx);
              continue;
            }
          } else {
            return;
          }
        }
      }

      // 4. If buffer starts with bare JSON tool call: {"name": "..."
      const bareMatch = this.buffer.match(/^\s*\{[\s\n\r]*"name"[\s\n\r]*:/);
      if (bareMatch) {
        const startPos = this.buffer.indexOf('{');
        const balanced = findBalancedJsonObject(this.buffer, startPos);
        if (balanced) {
          const extracted = extractTextualToolCalls(balanced);
          if (extracted.toolCalls.length > 0) {
            const endIdx = startPos + balanced.length;
            this.buffer = this.buffer.slice(endIdx);
            continue;
          }
        } else {
          return;
        }
      }

      // Check for partial fence ``` at tail
      const partialFence = this.buffer.match(/`{1,2}$/);
      if (partialFence && partialFence.index !== undefined && partialFence.index > 0) {
        onDelta(this.buffer.slice(0, partialFence.index));
        this.buffer = this.buffer.slice(partialFence.index);
        return;
      }

      onDelta(this.buffer);
      this.buffer = '';
      break;
    }
  }

  flush(onDelta: (text: string) => void): void {
    if (this.buffer.length > 0) {
      const extracted = extractTextualToolCalls(this.buffer);
      if (extracted.toolCalls.length > 0) {
        if (extracted.cleanContent.trim().length > 0) {
          onDelta(extracted.cleanContent);
        }
      } else {
        onDelta(this.buffer);
      }
      this.buffer = '';
    }
  }
}

