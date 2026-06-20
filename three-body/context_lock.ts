import { ContextLock } from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

// Conservative estimate: 2 chars/token covers CJK, code, and other dense
// tokenization cases where the common 4 chars/token assumption undershoots badly.
// This ensures chunking triggers before hitting context limits rather than after.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function generateId(): string {
  return `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chunkText(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + maxChars, text.length);
    const breakPoint = text.lastIndexOf("\n\n", end);
    if (breakPoint > offset) end = breakPoint;
    chunks.push(text.slice(offset, end).trim());
    offset = end;
  }
  return chunks;
}

export function lockContext(
  query: string,
  inputText: string,
  config: ThreeBodyConfig
): ContextLock {
  const combinedInput = `QUERY:\n${query}\n\nINPUT:\n${inputText}`;
  const tokenEstimate = estimateTokens(combinedInput);
  const chunks = chunkText(combinedInput, config.maxChunkTokens);

  return {
    lock_id: generateId(),
    timestamp: new Date().toISOString(),
    query,
    full_input_text: combinedInput,
    token_estimate: tokenEstimate,
    chunk_count: chunks.length,
    chunks,
  };
}
