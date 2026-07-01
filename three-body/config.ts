export interface DeepSeekModels {
  reasoner: string;   // logical decomposition — chain-of-thought
  challenger: string; // adversarial challenge — finds flaws
  validator: string;  // factual validation — structured output
}

export interface ThreeBodyConfig {
  deepseek: {
    apiKey: string;
    baseUrl: string;
    models: DeepSeekModels;
  };
  maxChunkTokens: number;
  contextLimit: number; // shared across all three bodies
}

export function loadConfig(): ThreeBodyConfig {
  return {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: "https://api.deepseek.com",
      models: {
        // deepseek-reasoner is retired after 2026-07-24; use v4-pro with thinking enabled
        reasoner: "deepseek-v4-pro",    // Pro + thinking mode — deep chain-of-thought
        challenger: "deepseek-v4-pro",  // Pro — adversarial + creative critique
        validator: "deepseek-v4-flash", // Flash — fast factual validation
      },
    },
    maxChunkTokens: 900_000,
    contextLimit: 1_000_000, // DeepSeek 1M token window
  };
}
