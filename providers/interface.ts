// Provider interface — both MockProvider and RealProvider must implement this.
// Tool handlers depend only on this contract; switching providers requires zero changes to handlers.

export type Catalog = "Code" | "Image" | "Audio" | "Video";

export type AgentCardCapabilities = {
  primary_tasks: string[];
  languages: string[];
  context_window: number;
  multimodal: boolean;
  tool_calling: boolean;
  streaming: boolean;
};

export type AgentCardDeployment = {
  platforms: Array<{
    platform: string;
    verified: boolean;
    last_verified: string | null;
  }>;
  min_vram_gb: number;
  min_ram_gb: number;
  install_duration_p50_ms: number | null;
};

export type AgentCardBenchmarks = {
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  first_token_ms: number | null;
  cost_per_1k_tokens: number | null;
  cost_unit: string;
  deploy_success_rate: number | null;
  instruction_following_rate: number | null;
  format_compliance_rate: number | null;
  measured_at: string | null;
};

export type AgentCardScores = {
  deployability: number;
  speed: number;
  cost: number;
  capability: number;
};

export type AgentCardUsageGuide = {
  recommended_for: string[];
  not_recommended_for: string[];
  example_prompt: string;
  invoke_notes: string;
};

export type AgentCard = {
  model_id: string;
  identity: {
    name: { en: string; zh?: string };
    publisher: string;
    license: string;
  };
  capabilities: AgentCardCapabilities;
  deployment: AgentCardDeployment;
  benchmarks: AgentCardBenchmarks;
  scores: AgentCardScores;
  usage_guide: AgentCardUsageGuide;
  catalogs: Catalog[];
  installed?: boolean;
};

// ── query_model_candidates ────────────────────────────────────────────────────

export type QueryCandidatesParams = {
  task_type: string;
  platform: string;
  available_vram_gb: number;
  priority: string[];
  catalogs?: Catalog[];
  constraints: {
    tool_calling?: boolean;
    languages?: string[];
    min_instruction_following_rate?: number;
    local_only?: boolean;
  };
};

export type QueryCandidatesResult = {
  candidates: AgentCard[];
};

// ── estimate_inference_cost ───────────────────────────────────────────────────

export type EstimateCostParams = {
  model_id: string;
  estimated_prompt_tokens: number;
  estimated_completion_tokens: number;
};

export type EstimateCostResult = {
  model_id: string;
  estimated_time_ms: number;
  estimated_cost: number;
  cost_unit: string;
  confidence: "low" | "medium" | "high";
  cost_breakdown: string;
};

// ── invoke_model_via_aa ───────────────────────────────────────────────────────

export type InvokeModelParams = {
  model_id: string;
  prompt: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
  estimated_cost?: number;
  cost_unit?: string;
};

export type InvokeModelResult = {
  model_id: string;
  content: string;
  actual_time_ms: number;
  actual_prompt_tokens: number;
  actual_completion_tokens: number;
  actual_cost: number;
  cost_unit: string;
};

// ── install_model ─────────────────────────────────────────────────────────────

export type InstallModelParams = {
  model_id: string;
};

export type InstallModelResult = {
  model_id: string;
  success: boolean;
  message: string;
};

// ── Provider contract ─────────────────────────────────────────────────────────

export interface ModelSelectorProvider {
  queryCandidates(params: QueryCandidatesParams): Promise<QueryCandidatesResult>;
  estimateCost(params: EstimateCostParams): Promise<EstimateCostResult>;
  invokeModel(params: InvokeModelParams): Promise<InvokeModelResult>;
  installModel(params: InstallModelParams): Promise<InstallModelResult>;
}
