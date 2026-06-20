import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

const DEEPSEEK_SYSTEM = `You are the Logic and Decomposition Engine in a three-body reasoning system.

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

interface DeepSeekMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    total_tokens: number;
  };
}

async function callDeepSeek(
  messages: DeepSeekMessage[],
  config: ThreeBodyConfig
): Promise<DeepSeekResponse> {
  const response = await fetch(`${config.deepseek.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseek.model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<DeepSeekResponse>;
}

export async function runDeepSeek(
  lock: ContextLock,
  config: ThreeBodyConfig
): Promise<BodyOutput> {
  try {
    const outputs: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < lock.chunks.length; i++) {
      const chunk = lock.chunks[i];
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

      const result = await callDeepSeek(
        [
          { role: "system", content: DEEPSEEK_SYSTEM },
          { role: "user", content: `${chunkLabel}${chunk}` },
        ],
        config
      );

      const choice = result.choices[0];
      if (!choice) throw new Error("DeepSeek returned no choices");

      outputs.push(choice.message.content);
      totalTokens += result.usage?.total_tokens ?? 0;
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return {
      body: "deepseek",
      raw_output,
      token_count: totalTokens,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      body: "deepseek",
      raw_output: "",
      error,
    };
  }
}
