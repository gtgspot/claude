import { ContextLock } from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

// Conservative estimate: 2 chars/token covers CJK, code, and other dense
// tokenization cases where the common 4 chars/token assumption undershoots badly.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function generateId(): string {
  return `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chunkText(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 2; // symmetric with estimateTokens
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + maxChars, text.length);
    const breakPoint = text.lastIndexOf("\n\n", end);
    let nextOffset: number;
    if (breakPoint > offset) {
      // Split at paragraph boundary; skip the \n\n separator so the next
      // chunk doesn't start with leading blank lines (no trim needed).
      end = breakPoint;
      nextOffset = breakPoint + 2;
    } else {
      nextOffset = end;
    }
    // No .trim() — preserves semantic whitespace in code, diffs, YAML, Markdown.
    chunks.push(text.slice(offset, end));
    offset = nextOffset;
  }
  return chunks;
}

export function lockContext(
  query: string,
  inputText: string,
  config: ThreeBodyConfig
): ContextLock {
  // The query is kept outside the chunked content and prepended to every chunk
  // so that bodies processing chunk 2, 3, … still know what task they are on.
  const queryPrefix = `QUERY:\n${query}\n\nINPUT SEGMENT:\n`;
  const prefixTokens = estimateTokens(queryPrefix);
  const chunkBudget = config.maxChunkTokens - prefixTokens;
  if (chunkBudget <= 0) {
    throw new Error(
      `Query prefix (${prefixTokens} tokens estimated) leaves no room for input content; ` +
      `maxChunkTokens is ${config.maxChunkTokens}. Shorten the query or increase maxChunkTokens.`
    );
  }

  const rawChunks = chunkText(inputText, chunkBudget);
  const chunks = rawChunks.map((c) => `${queryPrefix}${c}`);

  const fullText = `QUERY:\n${query}\n\nINPUT:\n${inputText}`;

  return {
    lock_id: generateId(),
    timestamp: new Date().toISOString(),
    query,
    full_input_text: fullText,
    token_estimate: estimateTokens(fullText),
    chunk_count: chunks.length,
    chunks,
  };
}
