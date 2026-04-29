import { Type } from "@sinclair/typebox";
import type { ModelSelectorProvider } from "../providers/interface.js";

export function createEstimateCostTool(provider: ModelSelectorProvider) {
  return {
    name: "estimate_inference_cost",
    label: "Estimate Inference Cost",
    description:
      "Estimate the wall-clock time and monetary cost for one inference call on a specific model, " +
      "using benchmark data from its Agent Card. " +
      "Call this after selecting a candidate model and BEFORE invoking it, then include the " +
      "estimated_time_ms and estimated_cost in your decision summary.",
    parameters: Type.Object({
      model_id: Type.String({
        description: "Model ID returned by query_model_candidates",
      }),
      estimated_prompt_tokens: Type.Number({
        description: "Estimated number of prompt (input) tokens for this task",
        minimum: 1,
      }),
      estimated_completion_tokens: Type.Number({
        description: "Estimated number of completion (output) tokens for this task",
        minimum: 1,
      }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = params as Parameters<typeof provider.estimateCost>[0];
      const result = await provider.estimateCost(p);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
