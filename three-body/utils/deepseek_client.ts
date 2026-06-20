import { ThreeBodyConfig } from "../config.js";

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekOptions {
  model: string;
  messages: DeepSeekMessage[];
  temperature?: number;
  max_tokens?: number;
  // DeepSeek reasoning mode — activates extended chain-of-thought
  thinking?: { type: "enabled" | "disabled" };
}

export interface DeepSeekResponse {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function callDeepSeek(
  options: DeepSeekOptions,
  config: ThreeBodyConfig
): Promise<DeepSeekResponse> {
  const response = await fetch(`${config.deepseek.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 8192,
      thinking: options.thinking ?? { type: "enabled" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<DeepSeekResponse>;
}

export function extractContent(res: DeepSeekResponse): {
  content: string;
  reasoning?: string;
  totalTokens: number;
} {
  const choice = res.choices[0];
  if (!choice) throw new Error("DeepSeek returned no choices");
  return {
    content: choice.message.content,
    reasoning: choice.message.reasoning_content,
    totalTokens: res.usage?.total_tokens ?? 0,
  };
}
