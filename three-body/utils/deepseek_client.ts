import OpenAI from "openai";
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

// Routes the OpenAI SDK to DeepSeek's OpenAI-compatible endpoint.
// All three bodies, the challenge gate, and synthesis share this client.
export function createOpenAIClient(config: ThreeBodyConfig): OpenAI {
  return new OpenAI({
    apiKey: config.deepseek.apiKey,
    baseURL: `${config.deepseek.baseUrl}/v1`,
  });
}

export async function callDeepSeek(
  options: DeepSeekOptions,
  config: ThreeBodyConfig
): Promise<DeepSeekResponse> {
  const client = createOpenAIClient(config);

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.max_tokens ?? 8192,
  };

  body["temperature"] = options.temperature ?? 0.7;

  // DeepSeek thinking mode is a top-level param; pass via extra_body
  if (options.thinking?.type !== "disabled") {
    body["thinking"] = { type: "enabled" };
  }

  const completion = await client.chat.completions.create(
    body as Parameters<typeof client.chat.completions.create>[0]
  );

  type ExtendedMessage = OpenAI.Chat.ChatCompletionMessage & {
    reasoning_content?: string;
  };

  return {
    choices: completion.choices.map((c) => ({
      message: {
        content: c.message.content ?? "",
        reasoning_content: (c.message as ExtendedMessage).reasoning_content,
      },
      finish_reason: c.finish_reason ?? "stop",
    })),
    usage: completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : undefined,
  };
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
