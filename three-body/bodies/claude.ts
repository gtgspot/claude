// Adversarial challenge body — uses the Anthropic SDK interface (AnthropicViaDeepSeek)
// routed through DeepSeek's OpenAI-compatible API via the OpenAI SDK.
import { AnthropicViaDeepSeek, TextBlock } from "../utils/anthropic_via_deepseek.js";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

const SYSTEM = `You are the Challenge and Long-Context Engine in a three-body reasoning system.

Your role:
1. Receive the full input and the initial logical decomposition
2. Stress-test every assumption and conclusion — adopt an adversarial counter-position
3. Identify edge cases, contradictions, and unstated premises
4. Cross-reference distant parts of the input for consistency
5. Produce a rigorous challenge report and your own independent nuanced analysis

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
  // Accept the full prior BodyOutput so we can align each chunk with its
  // matching DeepSeek chunk output rather than replaying the full concatenation.
  deepseekResult: BodyOutput,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  const client = new AnthropicViaDeepSeek(config, config.deepseek.models.challenger);

  try {
    const outputs: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < lock.chunks.length; i++) {
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

      // Use only the matching chunk's prior output to avoid inflating the prompt
      // with the full multi-chunk concatenation on every iteration.
      const priorOutput =
        deepseekResult.chunk_outputs?.[i] ?? deepseekResult.raw_output;

      const userContent =
        `${chunkLabel}${lock.chunks[i]}\n\n` +
        `---\n## Logic Engine Output (this chunk)\n${priorOutput}`;

      const message = await client.messages.stream({
        model: config.deepseek.models.challenger,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        messages: [{ role: "user", content: userContent }],
      }).finalMessage();

      const text = message.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      outputs.push(text);
      totalTokens += message.usage.input_tokens + message.usage.output_tokens;
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return { body: "claude", raw_output, chunk_outputs: outputs, token_count: totalTokens };
  } catch (err) {
    return { body: "claude", raw_output: "", error: String(err) };
  }
}
