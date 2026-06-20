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
  try {
    const outputs: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < lock.chunks.length; i++) {
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

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

      const { content, reasoning, totalTokens: t } = extractContent(res);
      outputs.push(content);
      totalTokens += t;
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return { body: "deepseek", raw_output, token_count: totalTokens };
  } catch (err) {
    return { body: "deepseek", raw_output: "", error: String(err) };
  }
}
