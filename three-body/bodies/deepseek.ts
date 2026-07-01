import { callDeepSeek, extractContent } from "../utils/deepseek_client.js";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

const SYSTEM = `You are the Logic and Decomposition Engine in a three-body reasoning system.

Your role:
1. Break the input into discrete logical sub-problems
2. Apply step-by-step chain-of-thought reasoning to each
3. Identify mathematical relationships, causal chains, and structural dependencies
4. Enumerate assumptions explicitly — flag any that are unverified
5. Output your reasoning as numbered logical steps, then a structured decomposition

Format your response as:
## Logical Decomposition
[numbered steps]

## Structural Dependencies
[dependency map]

## Unverified Assumptions
[list]

## Decomposition Summary
[concise conclusion]`;

export async function runDeepSeek(
  lock: ContextLock,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  const outputs: string[] = [];
  let totalTokens = 0;
  const chunkErrors: string[] = [];

  for (let i = 0; i < lock.chunks.length; i++) {
    const chunkLabel =
      lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

    try {
      const res = await callDeepSeek(
        {
          model: config.deepseek.models.reasoner,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `${chunkLabel}${lock.chunks[i]}` },
          ],
          thinking: { type: "enabled" },
        },
        config
      );

      const { content, totalTokens: t } = extractContent(res);
      outputs.push(content);
      totalTokens += t;
    } catch (err) {
      // Retain a marker so downstream bodies still have an aligned chunk_outputs[i]
      const marker = `[Chunk ${i + 1}/${lock.chunk_count} failed: ${String(err)}]`;
      outputs.push(marker);
      chunkErrors.push(marker);
    }
  }

  const raw_output =
    outputs.length === 1
      ? outputs[0]
      : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

  if (chunkErrors.length === lock.chunks.length) {
    return { body: "deepseek", raw_output: "", chunk_outputs: outputs, error: chunkErrors.join("; ") };
  }

  return {
    body: "deepseek",
    raw_output,
    chunk_outputs: outputs,
    token_count: totalTokens,
    ...(chunkErrors.length > 0 ? { partial_errors: chunkErrors } : {}),
  };
}
