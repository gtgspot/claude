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

// 200K chars per body, 50K for challenge notes — keeps total synthesis prompt
// well under 1M regardless of chunk count or note verbosity.
const MAX_BODY_CHARS = 200_000;
const MAX_CHALLENGE_CHARS = 50_000;

function budgetOutput(text: string, label: string, maxChars = MAX_BODY_CHARS): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n[... ${label} truncated at ${maxChars.toLocaleString()} chars]`
  );
}

// For chunked bodies, distribute the per-body budget evenly across chunks so
// every chunk is represented in the synthesis prompt — not just the prefix.
function budgetBodyOutput(output: BodyOutput, label: string): string {
  const chunks = output.chunk_outputs;
  if (!chunks || chunks.length <= 1) {
    return budgetOutput(output.raw_output || "[failed]", label);
  }
  const perChunk = Math.floor(MAX_BODY_CHARS / chunks.length);
  return chunks
    .map((c, i) => {
      const excerpt =
        c.length <= perChunk
          ? c
          : c.slice(0, perChunk) + `\n[... chunk ${i + 1} truncated at ${perChunk.toLocaleString()} chars]`;
      return `### Chunk ${i + 1}/${chunks.length}\n${excerpt}`;
    })
    .join("\n\n");
}

function buildSynthesisPrompt(
  query: string,
  deepseek: BodyOutput,
  claude: BodyOutput,
  openai: BodyOutput,
  challengeResults: ChallengeResult[],
  convergence: ConvergenceStatus
): string {
  const challengeSummary = budgetOutput(
    challengeResults
      .map(
        (r) =>
          `**${r.original_body}** — survived: ${r.survived}. ${r.challenge_notes}`
      )
      .join("\n"),
    "challenge summary",
    MAX_CHALLENGE_CHARS
  );

  return (
    `## Original Query\n${query}\n\n` +
    `## Convergence Status: ${convergence}\n\n` +
    `## Challenge Gate Summary\n${challengeSummary}\n\n` +
    `## Logic Engine (Decomposition) Output\n${budgetBodyOutput(deepseek, "Logic Engine")}\n\n` +
    `## Challenge Engine (Adversarial) Output\n${budgetBodyOutput(claude, "Challenge Engine")}\n\n` +
    `## Validation Engine (Structure) Output\n${budgetBodyOutput(openai, "Validation Engine")}\n\n` +
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
  const client = new AnthropicViaDeepSeek(config, config.deepseek.models.reasoner);

  const prompt = buildSynthesisPrompt(
    query,
    deepseek,
    claude,
    openai,
    challengeResults,
    convergence
  );

  try {
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
  } catch (err) {
    // Transient synthesis failure (429, timeout, auth): degrade gracefully rather
    // than discarding the three body outputs and challenge results already computed.
    const synthesis =
      `## Synthesis\n[Synthesis unavailable — transient error during Phase 4]\n\n` +
      `## Preserved Dissents\nSynthesis engine failed; review individual body outputs directly.\n\n` +
      `## Confidence Tier\nUnresolved\n\n` +
      `## Rationale\nSynthesis call failed: ${String(err)}`;
    return { synthesis, confidence_tier: "Unresolved" };
  }
}
