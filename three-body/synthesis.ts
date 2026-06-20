import Anthropic from "@anthropic-ai/sdk";
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
    `You are the De Novo Synthesis Engine. Your task is to produce the final, authoritative ` +
    `answer from three independent AI reasoning bodies.\n\n` +
    `## Original Query\n${query}\n\n` +
    `## Convergence Status: ${convergence}\n\n` +
    `## Challenge Gate Summary\n${challengeSummary}\n\n` +
    `## DeepSeek (Logic/Decomposition) Output\n${deepseek.raw_output || "[failed]"}\n\n` +
    `## Claude (Challenge/Long-Context) Output\n${claude.raw_output || "[failed]"}\n\n` +
    `## OpenAI (Structure/Validation) Output\n${openai.raw_output || "[failed]"}\n\n` +
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
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const prompt = buildSynthesisPrompt(
    query,
    deepseek,
    claude,
    openai,
    challengeResults,
    convergence
  );

  const stream = await client.messages.stream({
    model: config.anthropic.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You are the De Novo Synthesis Engine in a three-body AI reasoning system. " +
      "Your synthesis is the authoritative final output.",
    messages: [{ role: "user", content: prompt }],
  });

  const message = await stream.finalMessage();
  const synthesis = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  return {
    synthesis,
    confidence_tier: parseConfidenceTier(synthesis),
  };
}
