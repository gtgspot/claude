import { ContextLock } from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

// Rough tiktoken approximation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function generateId(): string {
  return `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Splits input into chunks that fit within the smallest shared context limit
function chunkText(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + maxChars, text.length);
    // Prefer breaking at paragraph boundary
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

  // Use smallest shared limit to ensure all three bodies get full input
  const sharedLimit = Math.min(
    config.claudeContextLimit,
    config.deepseekContextLimit,
    config.openaiContextLimit
  );

  const chunks = chunkText(combinedInput, sharedLimit - 2000); // reserve ~2k tokens for system prompts

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
