import { BodyOutput, ContextLock } from "../schema.js";
import { ThreeBodyConfig } from "../config.js";

const OPENAI_SYSTEM = `You are the Structure and Validation Engine in a three-body reasoning system.

Your role:
1. Receive the full input, the logical decomposition, and the challenge analysis
2. Cross-reference against broad world knowledge to validate factual claims
3. Identify knowledge gaps that neither of the other engines surfaced
4. Synthesize a structured, validated output with clear confidence ratings per claim
5. Format the final structured summary for downstream synthesis

Format your response as:
## Validation Report
[validated claims with confidence: HIGH/MEDIUM/LOW per claim]

## Knowledge Gaps
[claims neither engine could substantiate]

## Cross-Reference Findings
[external knowledge that supports or refutes the analysis]

## Structured Summary
[validated synthesis in clear, structured prose]

## Confidence Distribution
- HIGH confidence claims: [count]
- MEDIUM confidence claims: [count]
- LOW confidence claims: [count]
- Unresolved claims: [count]`;

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    total_tokens: number;
  };
}

async function callOpenAI(
  messages: OpenAIMessage[],
  config: ThreeBodyConfig
): Promise<OpenAIResponse> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<OpenAIResponse>;
}

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
      const chunk = lock.chunks[i];
      const chunkLabel =
        lock.chunk_count > 1 ? `[Chunk ${i + 1}/${lock.chunk_count}]\n\n` : "";

      const userContent =
        `${chunkLabel}${chunk}\n\n` +
        `---\n## DeepSeek Logic Engine Output\n${deepseekOutput}\n\n` +
        `---\n## Claude Challenge Engine Output\n${claudeOutput}`;

      const result = await callOpenAI(
        [
          { role: "system", content: OPENAI_SYSTEM },
          { role: "user", content: userContent },
        ],
        config
      );

      const choice = result.choices[0];
      if (!choice) throw new Error("OpenAI returned no choices");

      outputs.push(choice.message.content);
      totalTokens += result.usage?.total_tokens ?? 0;
    }

    const raw_output =
      outputs.length === 1
        ? outputs[0]
        : outputs.map((o, i) => `### Chunk ${i + 1}\n${o}`).join("\n\n---\n\n");

    return {
      body: "openai",
      raw_output,
      token_count: totalTokens,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      body: "openai",
      raw_output: "",
      error,
    };
  }
}
