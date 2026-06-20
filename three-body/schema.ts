export type ConvergenceStatus = "Converged" | "Partial" | "Contested" | "Unresolved";

export type ConfidenceTier = "High" | "Medium" | "Low" | "Unresolved";

export interface ContextCoverage {
  full_input_provided_to_all_bodies: boolean;
  truncation_warnings: string[];
  chunk_reprocessing_required: boolean;
}

export interface ReasoningIssue {
  reasoning_issue_id: string;
  query_segment: string;
  deepseek_output: string;
  claude_output: string;
  openai_output: string;
  convergence_status: ConvergenceStatus;
  synthesis_position: string;
  dissent_preserved: string[];
  confidence_tier: ConfidenceTier;
  context_coverage: ContextCoverage;
  objection_routes: string[];
  output: string;
  fallback: string;
}

export interface CoverageIssue {
  coverage_issue_id: string;
  input_document: string;
  bodies_receiving_full_input: string[];
  bodies_truncating_input: string[];
  truncation_point_tokens: number;
  material_lost: string;
  reprocessing_triggered: boolean;
  chunking_strategy: string;
  coverage_risk: string;
  fallback: string;
}

export interface ContextLock {
  lock_id: string;
  timestamp: string;
  query: string;
  full_input_text: string;
  token_estimate: number;
  chunk_count: number;
  chunks: string[];
}

export interface BodyOutput {
  body: "deepseek" | "claude" | "openai";
  raw_output: string;
  thinking?: string;
  token_count?: number;
  error?: string;
}

export interface ChallengeResult {
  original_body: "deepseek" | "claude" | "openai";
  original_output: string;
  challenges: Array<{
    challenger: "deepseek" | "claude" | "openai";
    challenge_text: string;
  }>;
  survived: boolean;
  challenge_notes: string;
}

export interface ThreeBodyResult {
  reasoning_issues: ReasoningIssue[];
  coverage_issues: CoverageIssue[];
  final_synthesis: string;
  confidence_tier: ConfidenceTier;
  convergence_status: ConvergenceStatus;
  metadata: {
    query: string;
    timestamp: string;
    total_tokens_estimated: number;
    chunks_processed: number;
    bodies_activated: string[];
  };
}
