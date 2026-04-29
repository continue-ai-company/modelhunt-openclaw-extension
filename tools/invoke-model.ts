import { Type } from "@sinclair/typebox";
import type { ModelSelectorProvider } from "../providers/interface.js";

export function createInvokeModelTool(provider: ModelSelectorProvider) {
  return {
    name: "invoke_model_via_aa",
    label: "Invoke Model via AI2Apps",
    description:
      "Execute an inference call on the selected model through the AI2Apps AA Inference API. " +
      "Use the invoke_params and system_prompt from the selected model's Agent Card usage_guide. " +
      "After the call, compare actual_time_ms and actual_cost against the earlier estimates " +
      "and include both in your execution summary.",
    parameters: Type.Object({
      model_id: Type.String({
        description: "Model ID to invoke — must be the one selected after query_model_candidates",
      }),
      prompt: Type.String({
        description: "The user task prompt",
      }),
      system_prompt: Type.Optional(
        Type.String({
          description:
            "System prompt. Prefer using the agent_card.usage_guide.example_prompt as a template.",
        }),
      ),
      temperature: Type.Optional(
        Type.Number({
          description:
            "Sampling temperature. Use the value from agent_card.usage_guide.invoke_notes if available.",
          minimum: 0,
          maximum: 2,
        }),
      ),
      max_tokens: Type.Optional(
        Type.Number({
          description: "Maximum completion tokens. Adjust based on task requirements.",
          minimum: 1,
        }),
      ),
      estimated_cost: Type.Optional(
        Type.Number({
          description: "Estimated cost from estimate_inference_cost — used as baseline for actual_cost.",
        }),
      ),
      cost_unit: Type.Optional(
        Type.String({
          description: "Cost unit from estimate_inference_cost (e.g. USD, LOCAL).",
        }),
      ),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = params as Parameters<typeof provider.invokeModel>[0];
      const result = await provider.invokeModel(p);

      const summary =
        `✅ Generation complete\n` +
        `Model: ${result.model_id}\n` +
        `Time: ${result.actual_time_ms}ms | ` +
        `Tokens: ${result.actual_prompt_tokens}→${result.actual_completion_tokens} | ` +
        `Cost: ${result.actual_cost === 0 ? "LOCAL (free)" : `${result.actual_cost} ${result.cost_unit}`}\n\n` +
        `--- Generated Content ---\n${result.content}`;

      return {
        content: [{ type: "text" as const, text: summary }],
        details: result,
      };
    },
  };
}
