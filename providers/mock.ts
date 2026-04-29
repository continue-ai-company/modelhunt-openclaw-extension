// Mock Provider — covers all 4 decision branches from the design doc:
//   mock-model-a → rejected: vram exceeded
//   mock-model-b → rejected: platform not verified
//   mock-model-c → rejected: instruction_following_rate below threshold
//   mock-model-d → selected: all constraints pass
//
// estimate_inference_cost uses real formulas so the calculation logic
// is identical to RealProvider — only data source changes when switching.

import type {
  AgentCard,
  EstimateCostParams,
  EstimateCostResult,
  InstallModelParams,
  InstallModelResult,
  InvokeModelParams,
  InvokeModelResult,
  ModelSelectorProvider,
  QueryCandidatesParams,
  QueryCandidatesResult,
} from "./interface.js";

const MOCK_CARDS: AgentCard[] = [
  {
    model_id: "mock-model-a",
    identity: {
      name: { en: "Heavy 70B (Mock)", zh: "重量级70B模型（Mock）" },
      publisher: "MockLab",
      license: "Apache-2.0",
    },
    capabilities: {
      primary_tasks: ["text-generation", "instruction-following"],
      languages: ["zh", "en"],
      context_window: 131072,
      multimodal: false,
      tool_calling: true,
      streaming: true,
    },
    deployment: {
      platforms: [
        { platform: "linux", verified: true, last_verified: "2026-03-10" },
      ],
      min_vram_gb: 48,  // ← will be rejected: exceeds typical local vram
      min_ram_gb: 64,
      install_duration_p50_ms: 180000,
    },
    benchmarks: {
      latency_p50_ms: 3200,
      latency_p95_ms: 5100,
      first_token_ms: 1200,
      cost_per_1k_tokens: 0.002,
      cost_unit: "USD",
      deploy_success_rate: 0.90,
      instruction_following_rate: 0.94,
      format_compliance_rate: 0.92,
      measured_at: "2026-04-01",
    },
    scores: { deployability: 0.85, speed: 0.40, cost: 0.60, capability: 0.96 },
    usage_guide: {
      recommended_for: ["complex reasoning", "long-form generation"],
      not_recommended_for: ["latency-sensitive tasks", "low-vram environments"],
      example_prompt: "You are a helpful assistant. Answer concisely.\nUser: {user_input}",
      invoke_notes: "temperature=0.7, max_tokens=512",
    },
    catalogs: ["Code"],
  },
  {
    model_id: "mock-model-b",
    identity: {
      name: { en: "Unverified 7B (Mock)", zh: "未验证7B模型（Mock）" },
      publisher: "MockLab",
      license: "MIT",
    },
    capabilities: {
      primary_tasks: ["text-generation"],
      languages: ["en"],
      context_window: 8192,
      multimodal: false,
      tool_calling: false,
      streaming: true,
    },
    deployment: {
      platforms: [
        { platform: "linux", verified: true, last_verified: "2026-02-15" },
        { platform: "macos", verified: false, last_verified: null },  // ← rejected on mac
      ],
      min_vram_gb: 6,
      min_ram_gb: 12,
      install_duration_p50_ms: 22000,
    },
    benchmarks: {
      latency_p50_ms: 480,
      latency_p95_ms: 720,
      first_token_ms: 210,
      cost_per_1k_tokens: 0,
      cost_unit: "LOCAL",
      deploy_success_rate: null,  // no data for mac
      instruction_following_rate: 0.80,
      format_compliance_rate: 0.78,
      measured_at: "2026-03-20",
    },
    scores: { deployability: 0.50, speed: 0.82, cost: 1.0, capability: 0.71 },
    usage_guide: {
      recommended_for: ["quick Q&A on linux"],
      not_recommended_for: ["macOS deployments", "function calling tasks"],
      example_prompt: "Answer the user question directly.\nUser: {user_input}",
      invoke_notes: "temperature=0.6, max_tokens=256",
    },
    catalogs: ["Code"],
  },
  {
    model_id: "mock-model-c",
    identity: {
      name: { en: "Low-Follow 7B (Mock)", zh: "指令遵循弱7B模型（Mock）" },
      publisher: "MockLab",
      license: "Apache-2.0",
    },
    capabilities: {
      primary_tasks: ["text-generation", "code-completion"],
      languages: ["zh", "en"],
      context_window: 32768,
      multimodal: false,
      tool_calling: true,
      streaming: true,
    },
    deployment: {
      platforms: [
        { platform: "macos", verified: true, last_verified: "2026-03-28" },
        { platform: "linux", verified: true, last_verified: "2026-03-25" },
      ],
      min_vram_gb: 6,
      min_ram_gb: 12,
      install_duration_p50_ms: 18000,
    },
    benchmarks: {
      latency_p50_ms: 320,
      latency_p95_ms: 510,
      first_token_ms: 150,
      cost_per_1k_tokens: 0,
      cost_unit: "LOCAL",
      deploy_success_rate: 0.88,
      instruction_following_rate: 0.63,  // ← rejected: below typical 0.85 threshold
      format_compliance_rate: 0.60,
      measured_at: "2026-04-03",
    },
    scores: { deployability: 0.88, speed: 0.88, cost: 1.0, capability: 0.74 },
    usage_guide: {
      recommended_for: ["open-ended chat"],
      not_recommended_for: ["format-constrained generation", "structured output tasks"],
      example_prompt: "You are a helpful assistant.\nUser: {user_input}",
      invoke_notes: "temperature=0.8, max_tokens=200",
    },
    catalogs: ["Code"],
  },
  {
    model_id: "mock-model-e",
    identity: {
      name: { en: "FLUX.1 Pro (Mock)", zh: "FLUX.1 Pro（Mock）" },
      publisher: "Black Forest Labs",
      license: "Commercial",
    },
    capabilities: {
      primary_tasks: ["image-generation", "text-to-image"],
      languages: ["en"],
      context_window: 512,      // prompt token limit
      multimodal: true,
      tool_calling: false,
      streaming: false,
    },
    deployment: {
      platforms: [],             // cloud-only, no local platform verified
      min_vram_gb: 0,            // not applicable — cloud API
      min_ram_gb: 0,
      install_duration_p50_ms: null,
    },
    benchmarks: {
      latency_p50_ms: 4200,      // ~4s per image (1024x1024)
      latency_p95_ms: 8500,
      first_token_ms: null,      // image gen has no streaming TTFT
      cost_per_1k_tokens: 0.04,  // $0.04 per image (billed as ~1k "tokens")
      cost_unit: "USD",
      deploy_success_rate: 0.99,
      instruction_following_rate: 0.94,  // prompt adherence score
      format_compliance_rate: null,       // N/A for image output
      measured_at: "2026-04-06",
    },
    scores: { deployability: 0.95, speed: 0.65, cost: 0.45, capability: 0.97 },
    usage_guide: {
      recommended_for: ["高质量宣传海报", "产品图生成", "创意概念图", "营销物料"],
      not_recommended_for: ["本地部署（仅云端API）", "实时流式输出", "需要精确文字排版的图片"],
      example_prompt: "A professional product promotional poster for {product_name}. {style_description}. High resolution, commercial photography style, clean background.",
      invoke_notes: "每次调用生成一张图，prompt 建议用英文以获得最佳效果，max_tokens 设置为 1（图像生成不适用）",
    },
    catalogs: ["Image"],
  },
  {
    model_id: "mock-model-d",
    identity: {
      name: { en: "Qwen2.5 7B Instruct Q8 (Mock)", zh: "通义千问2.5 7B 指令版 Q8（Mock）" },
      publisher: "Alibaba Cloud",
      license: "Apache-2.0",
    },
    capabilities: {
      primary_tasks: ["text-generation", "instruction-following", "code-completion"],
      languages: ["zh", "en"],
      context_window: 32768,
      multimodal: false,
      tool_calling: true,
      streaming: true,
    },
    deployment: {
      platforms: [
        { platform: "macos", verified: true, last_verified: "2026-04-01" },
        { platform: "linux", verified: true, last_verified: "2026-03-28" },
      ],
      min_vram_gb: 8,
      min_ram_gb: 16,
      install_duration_p50_ms: 8500,
    },
    benchmarks: {
      latency_p50_ms: 250,
      latency_p95_ms: 420,
      first_token_ms: 180,
      cost_per_1k_tokens: 0,
      cost_unit: "LOCAL",
      deploy_success_rate: 0.96,
      instruction_following_rate: 0.91,  // ← passes all constraints → selected
      format_compliance_rate: 0.89,
      measured_at: "2026-04-05",
    },
    scores: { deployability: 0.88, speed: 0.75, cost: 1.0, capability: 0.85 },
    usage_guide: {
      recommended_for: ["format-constrained generation", "Chinese/English bilingual tasks", "cost-sensitive API calls"],
      not_recommended_for: ["image understanding (no multimodal)", "ultra-long documents (context window limit)"],
      example_prompt: "你是一个专业助手，请简洁地回答用户的问题。\n用户: {user_input}",
      invoke_notes: "调用时建议设置 temperature=0.7，max_tokens 根据任务调整",
    },
    catalogs: ["Code"],
  },
];

const MOCK_OUTPUTS: Record<string, string> = {
  "mock-model-d": `还在为冬天穿什么发愁吗？这款轻薄防水羽绒服，折叠后和手机一样小，出差旅行超方便！三层防水科技面料，雨雪天气完全不怕。现在下单，限时优惠立减200元，今天就加入购物车！`,
  "mock-model-e": `[MOCK — image generation simulated, no real API call made]\n\nGenerated image URL: https://storage.googleapis.com/mock-flux-outputs/modelhunt-poster-20260409-a3f9c1.png\nDimensions: 1024×1024px | Format: PNG | Model: flux-pro`,
};

export class MockProvider implements ModelSelectorProvider {
  async queryCandidates(_params: QueryCandidatesParams): Promise<QueryCandidatesResult> {
    // Return all mock cards — the LLM planning layer applies the filtering logic
    return { candidates: MOCK_CARDS };
  }

  async estimateCost(params: EstimateCostParams): Promise<EstimateCostResult> {
    const card = MOCK_CARDS.find((c) => c.model_id === params.model_id);
    if (!card) {
      return {
        model_id: params.model_id,
        estimated_time_ms: 0,
        estimated_cost: 0,
        cost_unit: "UNKNOWN",
        confidence: "low",
        cost_breakdown: `Model ${params.model_id} not found in mock data`,
      };
    }

    const { benchmarks } = card;
    const totalTokens = params.estimated_prompt_tokens + params.estimated_completion_tokens;

    // Time estimate: base latency + per-token completion time
    // Use first_token_ms as base, add ~5ms per completion token as rough throughput estimate
    const baseSec = (benchmarks.latency_p50_ms ?? 500) / 1000;
    const completionSec = (params.estimated_completion_tokens * 5) / 1000;
    const estimatedTimeMs = Math.round((baseSec + completionSec) * 1000);

    // Cost estimate
    const costPer1k = benchmarks.cost_per_1k_tokens ?? 0;
    const estimatedCost = (totalTokens / 1000) * costPer1k;

    // Confidence based on data freshness
    const measuredAt = benchmarks.measured_at;
    const ageMs = measuredAt
      ? Date.now() - new Date(measuredAt).getTime()
      : Infinity;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const confidence: "low" | "medium" | "high" =
      ageDays < 7 ? "high" : ageDays < 30 ? "medium" : "low";

    return {
      model_id: params.model_id,
      estimated_time_ms: estimatedTimeMs,
      estimated_cost: Math.round(estimatedCost * 100000) / 100000,
      cost_unit: benchmarks.cost_unit,
      confidence,
      cost_breakdown: `base=${benchmarks.latency_p50_ms}ms + ${params.estimated_completion_tokens} completion tokens × 5ms; cost=${costPer1k}/1k × ${totalTokens} tokens`,
    };
  }

  async invokeModel(params: InvokeModelParams): Promise<InvokeModelResult> {
    const output = MOCK_OUTPUTS[params.model_id] ?? `[Mock output for ${params.model_id}] This is a simulated response that satisfies the task constraints.`;

    // Simulate realistic latency (non-blocking)
    await new Promise((resolve) => setTimeout(resolve, 50));

    const actualTokens = Math.round(output.length / 2);

    return {
      model_id: params.model_id,
      content: output,
      actual_time_ms: 1750,
      actual_prompt_tokens: Math.round((params.prompt.length + (params.system_prompt?.length ?? 0)) / 2),
      actual_completion_tokens: actualTokens,
      actual_cost: 0,
      cost_unit: "LOCAL",
    };
  }

  async installModel(params: InstallModelParams): Promise<InstallModelResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { model_id: params.model_id, success: true, message: "[Mock] Installation started." };
  }
}
