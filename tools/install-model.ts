import { Type } from "@sinclair/typebox";
import type { ModelSelectorProvider } from "../providers/interface.js";

export function createInstallModelTool(provider: ModelSelectorProvider) {
  return {
    name: "install_model",
    label: "Install Model",
    description:
      "Install a model via the AA Inference API. " +
      "Call this ONLY after the user has confirmed they want to install the model. " +
      "Do NOT call this automatically — always ask the user first.",
    parameters: Type.Object({
      model_id: Type.String({ description: "The model_id to install" }),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = params as Parameters<typeof provider.installModel>[0];
      const result = await provider.installModel(p);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
