// Challenge Gate — uses the Anthropic SDK interface (AnthropicViaDeepSeek)
// routed through DeepSeek's OpenAI-compatible API via the OpenAI SDK.
import { AnthropicViaDeepSeek, TextBlock } from "./utils/anthropic_via_deepseek.js";
import { BodyOutput, ChallengeResult, ConvergenceStatus } from "./schema.js";
import { ThreeBodyConfig } from "./config.js";

function buildChallengePrompt(
  targetText: string,
  targetBody: string,
  challengers: Array<{ body: string; text: string }>
): string {
  return (
    `Review the following output from the ${targetBody} engine:\n\n` +
    `"""\n${targetText}\n"""\n\n` +
    `These are the outputs from the other two engines for comparison:\n\n` +
    challengers
      .map((c) => `### ${c.body.toUpperCase()} Engine\n${c.text}`)
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
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    // Coerce survived to a real boolean — the model may return "true"/"false"
    // strings, which are truthy regardless of value and would inflate scores.
    const survived = raw["survived"] === true || raw["survived"] === "true";
    const challenges = Array.isArray(raw["challenges"])
      ? (raw["challenges"] as Array<{ challenger: string; challenge_text: string }>)
      : [];
    const challenge_notes =
      typeof raw["challenge_notes"] === "string"
        ? raw["challenge_notes"]
        : "No challenge notes provided";
    return { challenges, survived, challenge_notes };
  } catch (e) {
    return { challenges: [], survived: false, challenge_notes: `Parse failed — malformed JSON: ${String(e)}` };
  }
}

async function challengeChunk(
  targetText: string,
  targetBody: string,
  challengers: Array<{ body: string; text: string }>,
  client: AnthropicViaDeepSeek,
  config: ThreeBodyConfig
): Promise<ParsedChallenge> {
  const prompt = buildChallengePrompt(targetText, targetBody, challengers);

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

  return parseChallenge(rawText);
}

export async function runChallengeGate(
  deepseekOutput: BodyOutput,
  claudeOutput: BodyOutput,
  openaiOutput: BodyOutput,
  config: ThreeBodyConfig
): Promise<{ results: ChallengeResult[]; convergence_status: ConvergenceStatus }> {
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
    const chunkCount = target.chunk_outputs?.length ?? 1;

    let allChallenges: Array<{ challenger: string; challenge_text: string }> = [];
    let survived: boolean;
    const noteParts: string[] = [];

    if (chunkCount <= 1) {
      // Single chunk: challenge using raw_output directly
      try {
        const parsed = await challengeChunk(
          target.raw_output,
          target.body,
          challengers.map((c) => ({ body: c.body, text: c.raw_output })),
          client,
          config
        );
        allChallenges = parsed.challenges;
        survived = parsed.survived;
        noteParts.push(parsed.challenge_notes);
      } catch (err) {
        // Transient errors (429, network, timeout) produce an Unresolved result
        // rather than aborting the whole orchestration run.
        survived = false;
        noteParts.push(`Challenge call failed: ${String(err)}`);
      }
    } else {
      // Multi-chunk: challenge each chunk against the matching chunk from each
      // challenger so no single prompt exceeds the 1M context window.
      const chunkResults: ParsedChallenge[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const targetChunk = target.chunk_outputs![i];
        const challengerData = challengers.map((c) => ({
          body: c.body,
          text: c.chunk_outputs?.[i] ?? c.raw_output,
        }));
        try {
          const parsed = await challengeChunk(
            targetChunk, target.body, challengerData, client, config
          );
          chunkResults.push(parsed);
          noteParts.push(`Chunk ${i + 1}/${chunkCount}: ${parsed.challenge_notes}`);
          allChallenges.push(...parsed.challenges);
        } catch (err) {
          chunkResults.push({ challenges: [], survived: false, challenge_notes: `call failed: ${String(err)}` });
          noteParts.push(`Chunk ${i + 1}/${chunkCount}: call failed — ${String(err)}`);
        }
      }
      // Survived only if every chunk passed cross-examination
      survived = chunkResults.every((r) => r.survived);
    }

    results.push({
      original_body: target.body,
      original_output: target.raw_output,
      challenges: allChallenges.map((c) => ({
        challenger: c.challenger as "deepseek" | "claude" | "openai",
        challenge_text: c.challenge_text,
      })),
      survived,
      challenge_notes: noteParts.join("; "),
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
