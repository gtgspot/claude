export interface ThreeBodyConfig {
  anthropic: {
    apiKey: string;
    model: string;
  };
  deepseek: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  openai: {
    apiKey: string;
    model: string;
  };
  maxChunkTokens: number;
  claudeContextLimit: number;
  deepseekContextLimit: number;
  openaiContextLimit: number;
}

export function loadConfig(): ThreeBodyConfig {
  return {
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: "claude-opus-4-8",
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-reasoner",
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: "gpt-4o",
    },
    maxChunkTokens: 100_000,
    claudeContextLimit: 200_000,
    deepseekContextLimit: 128_000,
    openaiContextLimit: 128_000,
  };
}
