import { BodyOutput, ChallengeResult, ConvergenceStatus } from "./schema.js";
import Anthropic from "@anthropic-ai/sdk";
import { ThreeBodyConfig } from "./config.js";

// Each body's output is challenged by the other two.
// If challenges surface a substantive contradiction, survived = false.
function buildChallengePrompt(
  outputUnderReview: BodyOutput,
  challengers: BodyOutput[]
): string {
  return (
    `Review the following output from the ${outputUnderReview.body} engine:\n\n` +
    `"""\n${outputUnderReview.raw_output}\n"""\n\n` +
    `These are the outputs from the other two engines for comparison:\n\n` +
    challengers
      .map((c) => `### ${c.body.toUpperCase()} Engine\n${c.raw_output}`)
      .join("\n\n") +
    `\n\nIdentify any claims in the reviewed output that are:\n` +
    `1. Directly contradicted by the other engines\n` +
    `2. Unsupported and not corroborated\n` +
    `3. Logically inconsistent with the broader analysis\n\n` +
    `Respond in JSON with this shape:\n` +
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
  if (!jsonMatch) {
    return { challenges: [], survived: true, challenge_notes: raw };
  }
  try {
    return JSON.parse(jsonMatch[0]) as ParsedChallenge;
  } catch {
    return { challenges: [], survived: true, challenge_notes: raw };
  }
}

export async function runChallengeGate(
  deepseekOutput: BodyOutput,
  claudeOutput: BodyOutput,
  openaiOutput: BodyOutput,
  config: ThreeBodyConfig
): Promise<{
  results: ChallengeResult[];
  convergence_status: ConvergenceStatus;
}> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
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

    const stream = await client.messages.stream({
      model: config.anthropic.model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system:
        "You are a rigorous cross-examiner in a three-body AI reasoning system. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const message = await stream.finalMessage();
    const rawText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
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
