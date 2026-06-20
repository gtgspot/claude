import OpenAI from "openai";
import { ThreeBodyConfig } from "../config.js";

// Implements the subset of @anthropic-ai/sdk's Messages interface used by this
// codebase, routing all calls through DeepSeek's OpenAI-compatible API via the
// OpenAI SDK. No Anthropic API key required — only DEEPSEEK_API_KEY.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock = TextBlock | ThinkingBlock;

export interface AnthropicMessage {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface CreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | ContentBlock[];
  }>;
  thinking?: { type: "adaptive" | "enabled" | "disabled" };
}

type ExtendedMessage = OpenAI.Chat.ChatCompletionMessage & {
  reasoning_content?: string;
};

function contentToString(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function buildMessages(
  system: string | undefined,
  messages: CreateParams["messages"]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) result.push({ role: "system", content: system });
  for (const m of messages) {
    result.push({ role: m.role, content: contentToString(m.content) });
  }
  return result;
}

// Minimal stream wrapper matching the Anthropic SDK's stream interface.
// Callers use: await client.messages.stream({...}).finalMessage()
class StreamAdapter {
  private pending: Promise<AnthropicMessage>;
  constructor(pending: Promise<AnthropicMessage>) {
    this.pending = pending;
  }
  async finalMessage(): Promise<AnthropicMessage> {
    return this.pending;
  }
}

export class AnthropicViaDeepSeek {
  private openai: OpenAI;
  private modelOverride: string | undefined;
  private config: ThreeBodyConfig;

  constructor(config: ThreeBodyConfig, modelOverride?: string) {
    this.config = config;
    this.modelOverride = modelOverride;
    this.openai = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseUrl,
    });
  }

  messages = {
    // Drop-in replacement for Anthropic SDK's messages.create()
    create: (params: CreateParams): Promise<AnthropicMessage> =>
      this.execute(params),

    // Drop-in replacement for Anthropic SDK's messages.stream().finalMessage()
    stream: (params: CreateParams): StreamAdapter =>
      new StreamAdapter(this.execute(params)),
  };

  private async execute(params: CreateParams): Promise<AnthropicMessage> {
    const model =
      this.modelOverride ?? this.config.deepseek.models.reasoner;

    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(params.system, params.messages),
      max_tokens: params.max_tokens,
    };

    // deepseek-reasoner rejects custom temperatures
    if (!model.includes("reasoner")) {
      body["temperature"] = 0.7;
    }

    // Map Anthropic's thinking param → DeepSeek's thinking param
    if (params.thinking?.type !== "disabled") {
      body["thinking"] = { type: "enabled" };
    }

    const completion = await this.openai.chat.completions.create(
      body as Parameters<typeof this.openai.chat.completions.create>[0]
    );

    const choice = completion.choices[0];
    if (!choice) throw new Error("DeepSeek returned no choices");

    const raw = choice.message as ExtendedMessage;
    const content: ContentBlock[] = [];

    if (raw.reasoning_content) {
      content.push({ type: "thinking", thinking: raw.reasoning_content });
    }
    if (raw.content) {
      content.push({ type: "text", text: raw.content });
    }

    return {
      id: completion.id,
      type: "message",
      role: "assistant",
      content,
      model: completion.model,
      stop_reason: choice.finish_reason ?? "end_turn",
      usage: {
        input_tokens: completion.usage?.prompt_tokens ?? 0,
        output_tokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }
}
