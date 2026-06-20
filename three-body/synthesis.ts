// De Novo Synthesis — uses the Anthropic SDK interface (AnthropicViaDeepSeek)
// routed through DeepSeek's OpenAI-compatible API via the OpenAI SDK.
import { AnthropicViaDeepSeek, TextBlock } from "./utils/anthropic_via_deepseek.js";
import {
  BodyOutput,
  ChallengeResult,
  ConfidenceTier,
  ConvergenceStatus,
} from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

function buildSynthesisPrompt(
  query: string,
  deepseek: BodyOutput,
  claude: BodyOutput,
  openai: BodyOutput,
  challengeResults: ChallengeResult[],
  convergence: ConvergenceStatus
): string {
  const challengeSummary = challengeResults
    .map(
      (r) =>
        `**${r.original_body}** — survived: ${r.survived}. ${r.challenge_notes}`
    )
    .join("\n");

  return (
    `## Original Query\n${query}\n\n` +
    `## Convergence Status: ${convergence}\n\n` +
    `## Challenge Gate Summary\n${challengeSummary}\n\n` +
    `## Logic Engine (Decomposition) Output\n${deepseek.raw_output || "[failed]"}\n\n` +
    `## Challenge Engine (Adversarial) Output\n${claude.raw_output || "[failed]"}\n\n` +
    `## Validation Engine (Structure) Output\n${openai.raw_output || "[failed]"}\n\n` +
    `---\n\n` +
    `Synthesize a final answer that:\n` +
    `1. Accepts claims with cross-body consensus\n` +
    `2. Preserves dissent where bodies meaningfully disagree\n` +
    `3. Flags unresolved contradictions explicitly\n` +
    `4. Assigns an overall confidence tier: High / Medium / Low / Unresolved\n\n` +
    `Format your response as:\n` +
    `## Synthesis\n[authoritative answer]\n\n` +
    `## Preserved Dissents\n[list of unresolved disagreements, or "None"]\n\n` +
    `## Confidence Tier\n[High | Medium | Low | Unresolved]\n\n` +
    `## Rationale\n[brief justification of confidence assignment]`
  );
}

function parseConfidenceTier(text: string): ConfidenceTier {
  const match = text.match(/## Confidence Tier\s*\n+([^\n]+)/);
  if (!match) return "Unresolved";
  const tier = match[1].trim();
  if (tier === "High" || tier === "Medium" || tier === "Low") return tier;
  return "Unresolved";
}

export async function runSynthesis(
  query: string,
  deepseek: BodyOutput,
  claude: BodyOutput,
  openai: BodyOutput,
  challengeResults: ChallengeResult[],
  convergence: ConvergenceStatus,
  config: ThreeBodyConfig
): Promise<{ synthesis: string; confidence_tier: ConfidenceTier }> {
  // Uses the Anthropic SDK interface routed through DeepSeek
  const client = new AnthropicViaDeepSeek(config, config.deepseek.models.reasoner);

  const prompt = buildSynthesisPrompt(
    query,
    deepseek,
    claude,
    openai,
    challengeResults,
    convergence
  );

  const message = await client.messages.stream({
    model: config.deepseek.models.reasoner,
    max_tokens: 16384,
    thinking: { type: "adaptive" },
    system:
      "You are the De Novo Synthesis Engine in a three-body AI reasoning system. " +
      "Your synthesis is the authoritative final output.",
    messages: [{ role: "user", content: prompt }],
  }).finalMessage();

  const synthesis = message.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    synthesis,
    confidence_tier: parseConfidenceTier(synthesis),
  };
}
