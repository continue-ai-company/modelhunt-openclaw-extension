/**
 * ModelHunt Model Selector Plugin for OpenClaw
 *
 * Provides three tools for intelligent model selection before LLM generation tasks:
 *   1. query_model_candidates  — fetch Agent Cards from ModelHunt
 *   2. estimate_inference_cost — pre-compute time and cost estimates
 *   3. invoke_model_via_aa     — execute inference through AI2Apps AA API
 *
 * Provider switching:
 *   config.provider = "mock"  → MockProvider (static data, for validation)
 *   config.provider = "real"  → RealProvider (live ModelHunt + AI2Apps APIs)
 *
 * Install:
 *   openclaw plugins install /path/to/agents/openclaw/extensions/modelhunt-selector
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MockProvider } from "./providers/mock.js";
import { RealProvider } from "./providers/real.js";
import { createEstimateCostTool } from "./tools/estimate-cost.js";
import { createInstallModelTool } from "./tools/install-model.js";
import { createInvokeModelTool } from "./tools/invoke-model.js";
import { createQueryCandidatesTool } from "./tools/query-candidates.js";

export default definePluginEntry({
  id: "modelhunt-selector",
  name: "ModelHunt Model Selector",
  description:
    "Queries ModelHunt Agent Card API to select the best model for a generation task, " +
    "estimates cost and latency, then invokes the model via AI2Apps.",

  register(api) {
    const pluginConfig = ((api.config as Record<string, unknown>)?.plugins as Record<string, unknown>)?.entries as Record<string, Record<string, unknown>> | undefined;
    const config = (pluginConfig?.["modelhunt-selector"]?.config ?? {}) as {
      provider?: string;
      modelhuntApiUrl?: string;
      aaInferenceUrl?: string;
    };

    const providerName = config.provider ?? "real";

    let provider;
    if (providerName === "real") {
      provider = new RealProvider(
        config.modelhuntApiUrl ?? "http://127.0.0.1:8665",
        config.aaInferenceUrl ?? "http://127.0.0.1:3015",
      );
      api.logger.info(`[modelhunt-selector] registered with provider="real" modelhuntApiUrl=${config.modelhuntApiUrl ?? "http://127.0.0.1:8665"}`);
    } else {
      provider = new MockProvider();
      api.logger.info(`[modelhunt-selector] registered with provider="mock"`);
    }

    api.registerTool(createQueryCandidatesTool(provider));
    api.registerTool(createEstimateCostTool(provider));
    api.registerTool(createInvokeModelTool(provider));
    api.registerTool(createInstallModelTool(provider));
  },
});
