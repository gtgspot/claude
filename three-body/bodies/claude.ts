import { callDeepSeek, extractContent } from "../utils/deepseek_client.js";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

// This body plays the adversarial challenger role — implemented via DeepSeek with
// a high-temperature, critique-focused system prompt to maximize diversity from
// the reasoner body despite sharing the same underlying provider.
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
  deepseekOutput: string,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  try {
    const outputs: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < lock.chunks.length; i++) {
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

      const userContent =
        `${chunkLabel}${lock.chunks[i]}\n\n` +
        `---\n## Logic Engine Output\n${deepseekOutput}`;

      const res = await callDeepSeek(
        {
          model: config.deepseek.models.challenger,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userContent },
          ],
          temperature: 0.9, // higher temperature drives adversarial diversity
          thinking: { type: "enabled" },
        },
        config
      );

      const { content, totalTokens: t } = extractContent(res);
      outputs.push(content);
      totalTokens += t;
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return { body: "claude", raw_output, token_count: totalTokens };
  } catch (err) {
    return { body: "claude", raw_output: "", error: String(err) };
  }
}
