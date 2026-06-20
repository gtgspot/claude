import Anthropic from "@anthropic-ai/sdk";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

const CLAUDE_SYSTEM = `You are the Challenge and Long-Context Engine in a three-body reasoning system.

Your role:
1. Receive the full input and an initial logical decomposition from the Logic Engine
2. Stress-test every assumption and conclusion — adopt an adversarial counter-position
3. Identify edge cases, contradictions, and unstated premises
4. Leverage your full context window to cross-reference distant parts of the input
5. Produce a rigorous challenge report and your own nuanced analysis

Format your response as:
## Challenges to Received Reasoning
[numbered challenges with specific references]

## Edge Cases Identified
[list]

## Contradictions Found
[list, or "None identified"]

## Long-Context Cross-References
[connections found across distant sections]

## Refined Analysis
[your independent position after challenge]`;

export async function runClaude(
  lock: ContextLock,
  deepseekOutput: string,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  try {
    const outputs: string[] = [];
    const thinkingBlocks: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < lock.chunks.length; i++) {
      const chunk = lock.chunks[i];
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

      const userContent =
        `${chunkLabel}${chunk}\n\n` +
        `---\n## DeepSeek Logic Engine Output\n${deepseekOutput}`;

      const stream = await client.messages.stream({
        model: config.anthropic.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: CLAUDE_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      });

      const message = await stream.finalMessage();
      totalTokens += message.usage.input_tokens + message.usage.output_tokens;

      let chunkThinking = "";
      let chunkText = "";

      for (const block of message.content) {
        if (block.type === "thinking") {
          chunkThinking += block.thinking ?? "";
        } else if (block.type === "text") {
          chunkText += block.text;
        }
      }

      if (chunkThinking) thinkingBlocks.push(chunkThinking);
      outputs.push(chunkText);
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return {
      body: "claude",
      raw_output,
      thinking: thinkingBlocks.join("\n\n---\n\n"),
      token_count: totalTokens,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      body: "claude",
      raw_output: "",
      error,
    };
  }
}
