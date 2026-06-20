// Challenge Gate — uses the Anthropic SDK interface (AnthropicViaDeepSeek)
// routed through DeepSeek's OpenAI-compatible API via the OpenAI SDK.
import { AnthropicViaDeepSeek, TextBlock } from "./utils/anthropic_via_deepseek.js";
import { BodyOutput, ChallengeResult, ConvergenceStatus } from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

function buildChallengePrompt(target: BodyOutput, challengers: BodyOutput[]): string {
  return (
    `Review the following output from the ${target.body} engine:\n\n` +
    `"""\n${target.raw_output}\n"""\n\n` +
    `These are the outputs from the other two engines for comparison:\n\n` +
    challengers
      .map((c) => `### ${c.body.toUpperCase()} Engine\n${c.raw_output}`)
      .join("\n\n") +
    `\n\nIdentify any claims in the reviewed output that are:\n` +
    `1. Directly contradicted by the other engines\n` +
    `2. Unsupported and not corroborated\n` +
    `3. Logically inconsistent with the broader analysis\n\n` +
    `Respond in JSON with this exact shape:\n` +
    `{\n` +
    `  "challenges": [{"challenger": "<engine>", "challenge_text": "<text>"}],\n` +
    `  "survived": <true|false>,\n` +
    `  "challenge_notes": "<summary>"\n` +
    `}`
  );
}

interface ParsedChallenge {
  challenges: Array<{ challenger: string; challenge_text: string }>;
  survived: boolean;
  challenge_notes: string;
}

function parseChallenge(raw: string): ParsedChallenge {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  // Unparseable gate responses default to survived: false — a gate that produces
  // no usable JSON cannot confirm the output passed cross-examination, so it must
  // not count as a successful challenge (which would inflate convergence scores).
  if (!jsonMatch) {
    return { challenges: [], survived: false, challenge_notes: `Parse failed — no JSON block in gate response: ${raw.slice(0, 200)}` };
  }
  try {
    return JSON.parse(jsonMatch[0]) as ParsedChallenge;
  } catch (e) {
    return { challenges: [], survived: false, challenge_notes: `Parse failed — malformed JSON: ${String(e)}` };
  }
}

export async function runChallengeGate(
  deepseekOutput: BodyOutput,
  claudeOutput: BodyOutput,
  openaiOutput: BodyOutput,
  config: ThreeBodyConfig
): Promise<{ results: ChallengeResult[]; convergence_status: ConvergenceStatus }> {
  // Uses the Anthropic SDK interface routed through DeepSeek
  const client = new AnthropicViaDeepSeek(config, config.deepseek.models.challenger);

  const bodies = [deepseekOutput, claudeOutput, openaiOutput];
  const results: ChallengeResult[] = [];

  for (const target of bodies) {
    if (target.error || !target.raw_output) {
      results.push({
        original_body: target.body,
        original_output: target.raw_output,
        challenges: [],
        survived: false,
        challenge_notes: target.error ?? "Empty output — challenge failed",
      });
      continue;
    }

    const challengers = bodies.filter((b) => b.body !== target.body);
    const prompt = buildChallengePrompt(target, challengers);

    const message = await client.messages.create({
      model: config.deepseek.models.challenger,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system:
        "You are a rigorous cross-examiner in a three-body AI reasoning system. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = message.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = parseChallenge(rawText);

    results.push({
      original_body: target.body,
      original_output: target.raw_output,
      challenges: parsed.challenges.map((c) => ({
        challenger: c.challenger as "deepseek" | "claude" | "openai",
        challenge_text: c.challenge_text,
      })),
      survived: parsed.survived,
      challenge_notes: parsed.challenge_notes,
    });
  }

  const survivedCount = results.filter((r) => r.survived).length;
  let convergence_status: ConvergenceStatus;
  if (survivedCount === 3) convergence_status = "Converged";
  else if (survivedCount === 2) convergence_status = "Partial";
  else if (survivedCount === 1) convergence_status = "Contested";
  else convergence_status = "Unresolved";

  return { results, convergence_status };
}
