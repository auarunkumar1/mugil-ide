import type { ChatMessage, CompletionResult } from '../../../types.js';
import type { ProviderCompleteOptions } from '../provider.js';
import type { StreamedCompletion, StreamHandlers } from '../stream.js';

export interface ProtocolAdapter {
  readonly name: string;
  readonly chatEndpoint: string;
  buildRequestBody(messages: ChatMessage[], options: ProviderCompleteOptions): Record<string, unknown>;
  parseResponse(json: Record<string, unknown>, model: string, providerName: string): CompletionResult;
  parseStream(body: ReadableStream<Uint8Array>, handlers: StreamHandlers): Promise<StreamedCompletion>;
}

export { parseUsageMetadata, type ParsedUsageMetadata } from '../usageMetadata.js';
