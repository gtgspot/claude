import { loadConfig, ThreeBodyConfig } from "./config.js";
import { lockContext } from "./context_lock.js";
import { runDeepSeek } from "./bodies/deepseek.js";
import { runClaude } from "./bodies/claude.js";
import { runOpenAI } from "./bodies/openai_body.js";
import { runChallengeGate } from "./challenge_gate.js";
import { runSynthesis } from "./synthesis.js";
import {
  CoverageIssue,
  ReasoningIssue,
  ThreeBodyResult,
} from "./schema.js";

let issueCounter = 0;
let coverageCounter = 0;

function nextIssueId(): string {
  return `R-${String(++issueCounter).padStart(3, "0")}`;
}

function nextCoverageId(): string {
  return `C-${String(++coverageCounter).padStart(3, "0")}`;
}

export async function runThreeBody(
  query: string,
  inputText: string,
  config?: ThreeBodyConfig
): Promise<ThreeBodyResult> {
  const cfg = config ?? loadConfig();

  // Phase 1: Context Lockdown
  const lock = lockContext(query, inputText, cfg);

  const coverageIssues: CoverageIssue[] = [];

  if (lock.chunk_count > 1) {
    coverageIssues.push({
      coverage_issue_id: nextCoverageId(),
      input_document: query,
      bodies_receiving_full_input: [],
      bodies_truncating_input: ["deepseek", "claude", "openai"],
      truncation_point_tokens: cfg.deepseekContextLimit,
      material_lost: "Input exceeds single-pass context; chunked reprocessing activated",
      reprocessing_triggered: true,
      chunking_strategy: `Sequential ${lock.chunk_count}-chunk reprocessing across all three bodies`,
      coverage_risk: "Cross-chunk reasoning continuity may degrade for very long inputs",
      fallback: "Each body receives overlapping chunk windows; synthesis recombines outputs",
    });
  }

  // Phase 2: Three-Body Activation (sequential — each body builds on prior)
  const [deepseekOutput] = await Promise.all([runDeepSeek(lock, cfg)]);
  const claudeOutput = await runClaude(lock, deepseekOutput.raw_output, cfg);
  const openaiOutput = await runOpenAI(
    lock,
    deepseekOutput.raw_output,
    claudeOutput.raw_output,
    cfg
  );

  // Phase 3: Challenge Gate
  const { results: challengeResults, convergence_status } =
    await runChallengeGate(deepseekOutput, claudeOutput, openaiOutput, cfg);

  // Phase 4: De Novo Synthesis
  const { synthesis, confidence_tier } = await runSynthesis(
    query,
    deepseekOutput,
    claudeOutput,
    openaiOutput,
    challengeResults,
    convergence_status,
    cfg
  );

  // Assemble ReasoningIssue record
  const reasoningIssue: ReasoningIssue = {
    reasoning_issue_id: nextIssueId(),
    query_segment: query,
    deepseek_output: deepseekOutput.raw_output,
    claude_output: claudeOutput.raw_output,
    openai_output: openaiOutput.raw_output,
    convergence_status,
    synthesis_position: synthesis,
    dissent_preserved: challengeResults
      .filter((r) => !r.survived)
      .map((r) => r.challenge_notes),
    confidence_tier,
    context_coverage: {
      full_input_provided_to_all_bodies: lock.chunk_count === 1,
      truncation_warnings:
        lock.chunk_count > 1
          ? [`Input chunked into ${lock.chunk_count} segments`]
          : [],
      chunk_reprocessing_required: lock.chunk_count > 1,
    },
    objection_routes: challengeResults.flatMap((r) =>
      r.challenges.map((c) => `[${c.challenger}→${r.original_body}] ${c.challenge_text}`)
    ),
    output: synthesis,
    fallback:
      confidence_tier === "Unresolved" || convergence_status === "Unresolved"
        ? "Manual review required — bodies did not converge on a shared position"
        : "",
  };

  const totalTokens =
    (deepseekOutput.token_count ?? 0) +
    (claudeOutput.token_count ?? 0) +
    (openaiOutput.token_count ?? 0);

  const activatedBodies: string[] = ["deepseek"];
  if (!claudeOutput.error) activatedBodies.push("claude");
  if (!openaiOutput.error) activatedBodies.push("openai");

  return {
    reasoning_issues: [reasoningIssue],
    coverage_issues: coverageIssues,
    final_synthesis: synthesis,
    confidence_tier,
    convergence_status,
    metadata: {
      query,
      timestamp: lock.timestamp,
      total_tokens_estimated: totalTokens || lock.token_estimate,
      chunks_processed: lock.chunk_count,
      bodies_activated: activatedBodies,
    },
  };
}
