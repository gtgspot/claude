import { callDeepSeek, extractContent } from "../utils/deepseek_client.js";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

// This body plays the structure/validation role — implemented via DeepSeek with
// a low temperature and precision-focused prompt to contrast with the high-temperature
// challenger body and produce deterministic, structured output.
const SYSTEM = `You are the Structure and Validation Engine in a three-body reasoning system.

Your role:
1. Receive the full input, the logical decomposition, and the challenge analysis
2. Cross-reference against known facts to validate claims
3. Identify knowledge gaps that neither engine surfaced
4. Assign per-claim confidence ratings (HIGH / MEDIUM / LOW)
5. Produce a structured, validated synthesis for downstream final synthesis

Format your response as:
## Validation Report
[validated claims with confidence: HIGH/MEDIUM/LOW per claim]

## Knowledge Gaps
[claims neither engine could substantiate]

## Cross-Reference Findings
[facts that support or refute the analysis]

## Structured Summary
[validated synthesis in clear, structured prose]

## Confidence Distribution
- HIGH confidence claims: [count]
- MEDIUM confidence claims: [count]
- LOW confidence claims: [count]
- Unresolved claims: [count]`;

export async function runOpenAI(
  lock: ContextLock,
  deepseekOutput: string,
  claudeOutput: string,
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
        `---\n## Logic Engine Output\n${deepseekOutput}\n\n` +
        `---\n## Challenge Engine Output\n${claudeOutput}`;

      const res = await callDeepSeek(
        {
          model: config.deepseek.models.validator,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userContent },
          ],
          temperature: 0.3, // low temperature for factual precision
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

    return { body: "openai", raw_output, token_count: totalTokens };
  } catch (err) {
    return { body: "openai", raw_output: "", error: String(err) };
  }
}
