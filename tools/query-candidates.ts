import { Type } from "@sinclair/typebox";
import type { ModelSelectorProvider, Catalog } from "../providers/interface.js";

export function createQueryCandidatesTool(provider: ModelSelectorProvider) {
  return {
    name: "query_model_candidates",
    label: "Query Model Candidates",
    description:
      "Query ModelHunt Agent Card API to get candidate models for a generation task. " +
      "Returns full Agent Card data for each candidate including capabilities, deployment info, " +
      "benchmark metrics, scores, and usage guidance. " +
      "Call this FIRST before any LLM generation task — do NOT hardcode a model name. " +
      "IMPORTANT: After selecting the best candidate, check its `installed` field. " +
      "If `installed` is false, ask the user: 'Model <name> is not installed. Would you like to install it?' " +
      "Only call install_model if the user confirms. Do not proceed to invoke_model_via_aa until the model is installed.",
    parameters: Type.Object({
      task_type: Type.String({
        description:
          'Type of generation task. Examples: "format_constrained_generation", "code_review", "qa", "creative_writing", "structured_output"',
      }),
      platform: Type.String({
        description: 'Runtime platform. One of: "macos", "linux", "windows"',
      }),
      available_vram_gb: Type.Number({
        description: "Available GPU VRAM in GB on this machine",
      }),
      priority: Type.Array(Type.String(), {
        description:
          'Ordered list of scoring priorities. Example: ["instruction_following", "cost", "speed"]',
      }),
      catalogs: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Filter by model capability catalogs. Each value must be one of: "Code", "Image", "Audio", "Video". ' +
            'Example: ["Code"] for code/text tasks, ["Image"] for image generation tasks',
        }),
      ),
      constraints: Type.Object(
        {
          tool_calling: Type.Optional(
            Type.Boolean({ description: "True if the task requires function/tool calling support" }),
          ),
          languages: Type.Optional(
            Type.Array(Type.String(), {
              description: 'Required language support. Example: ["zh", "en"]',
            }),
          ),
          min_instruction_following_rate: Type.Optional(
            Type.Number({
              description:
                "Minimum acceptable instruction_following_rate (0-1). Use 0.85 for format-constrained tasks.",
              minimum: 0,
              maximum: 1,
            }),
          ),
          local_only: Type.Optional(
            Type.Boolean({
              description: "True to exclude cloud-based models (cost_per_1k_tokens must be 0)",
            }),
          ),
        },
        { description: "Hard constraints — models not meeting these must be excluded" },
      ),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = params as Parameters<typeof provider.queryCandidates>[0];
      const result = await provider.queryCandidates(p);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
