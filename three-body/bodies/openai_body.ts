// Validation body — uses the OpenAI SDK directly, routed to DeepSeek's
// OpenAI-compatible endpoint. This is the most direct SDK-to-DeepSeek path.
import OpenAI from "openai";
import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

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

type ExtendedMessage = OpenAI.Chat.ChatCompletionMessage & {
  reasoning_content?: string;
};

export async function runOpenAI(
  lock: ContextLock,
  // Accept full BodyOutput objects so each chunk only sees its matching
  // prior-stage outputs rather than the full multi-chunk concatenation.
  deepseekResult: BodyOutput,
  claudeResult: BodyOutput,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  const client = new OpenAI({
    apiKey: config.deepseek.apiKey,
    baseURL: config.deepseek.baseUrl,
  });

  const outputs: string[] = [];
  let totalTokens = 0;
  const chunkErrors: string[] = [];

  for (let i = 0; i < lock.chunks.length; i++) {
    const chunkLabel =
      lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

    // Align with the matching chunk from each prior body
    const deepseekChunk =
      deepseekResult.chunk_outputs?.[i] ?? deepseekResult.raw_output;
    const claudeChunk =
      claudeResult.chunk_outputs?.[i] ?? claudeResult.raw_output;

    const userContent =
      `${chunkLabel}${lock.chunks[i]}\n\n` +
      `---\n## Logic Engine Output (this chunk)\n${deepseekChunk}\n\n` +
      `---\n## Challenge Engine Output (this chunk)\n${claudeChunk}`;

    try {
      const completion = (await client.chat.completions.create({
        model: config.deepseek.models.validator,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 8192,
        ...({ thinking: { type: "enabled" } } as Record<string, unknown>),
      } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)) as OpenAI.Chat.ChatCompletion;

      const choice = completion.choices[0];
      if (!choice) throw new Error("OpenAI/DeepSeek returned no choices");

      const raw = choice.message as ExtendedMessage;
      outputs.push(raw.content ?? "");
      totalTokens +=
        (completion.usage?.prompt_tokens ?? 0) +
        (completion.usage?.completion_tokens ?? 0);
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
    return { body: "openai", raw_output: "", chunk_outputs: outputs, error: chunkErrors.join("; ") };
  }

  return {
    body: "openai",
    raw_output,
    chunk_outputs: outputs,
    token_count: totalTokens,
    ...(chunkErrors.length > 0 ? { partial_errors: chunkErrors } : {}),
  };
}
