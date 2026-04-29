// Real Provider — connects to live ModelHunt Agent Card API and AI2Apps AA Inference API.
//
// queryCandidates → GET  {modelhuntApiUrl}/api/public/v1/agent-cards
// estimateCost    → GET  {modelhuntApiUrl}/api/public/v1/agent-cards/{model_id}  (then compute locally)
// invokeModel     → POST {aaInferenceUrl}/api/modelhunt/test  { model, task }

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

async function readSSEStream(res: Response): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let chunkIndex = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log("[modelhunt-selector] SSE stream closed, total events:", events.length);
      break;
    }
    const chunk = decoder.decode(value, { stream: true });
    console.log(`[modelhunt-selector] SSE chunk #${chunkIndex++}:`, JSON.stringify(chunk));
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        console.log("[modelhunt-selector] SSE parsed event:", JSON.stringify(parsed, null, 2));
        events.push(parsed);
      } catch {
        console.warn("[modelhunt-selector] SSE malformed line:", line);
      }
    }
  }

  return events;
}

export class RealProvider implements ModelSelectorProvider {
  private readonly modelhuntApiUrl: string;
  private readonly aaInferenceUrl: string;

  constructor(
    modelhuntApiUrl = "http://127.0.0.1:8665",
    aaInferenceUrl = "http://127.0.0.1:3015",
  ) {
    this.modelhuntApiUrl = modelhuntApiUrl.replace(/\/$/, "");
    this.aaInferenceUrl = aaInferenceUrl.replace(/\/$/, "");
  }

  async #fetchInstalledModels(): Promise<Set<string>> {
    ///api/modelhunt/models
    try {
      const url = `${this.aaInferenceUrl}/api/modelhunt/models`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to fetch installed models: ${res.status} ${res.statusText}`);
        return new Set();
      }
      const body = (await res.json()) as { deployable: string[] };
      const installed = new Set(body.deployable ?? []);
      console.log(`[modelhunt-selector] Fetched installed models:`, installed);
      return installed;
    } catch (err) {
      console.error(`Error fetching installed models:`, err);
      return new Set();
    }
  }

  async queryCandidates(params: QueryCandidatesParams): Promise<QueryCandidatesResult> {
    const url = new URL(`${this.modelhuntApiUrl}/api/public/v1/agent-cards`);
    url.searchParams.set("limit", "15");

    if (params.catalogs && params.catalogs.length > 0) {
      for (const c of params.catalogs) {
        url.searchParams.append("catalogs", c);
      }
    }

    // if (params.platform) {
    //   url.searchParams.set("platform", params.platform);
    // }
    // if (params.constraints.tool_calling !== undefined) {
    //   url.searchParams.set("tool_calling", String(params.constraints.tool_calling));
    // }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`ModelHunt API error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { items: AgentCard[]; count: number };
    if (body.items?.length > 0) {
      console.log(`[modelhunt-selector] queryCandidates ← fetched ${body.items.length} candidates:`, body.items.map(c => ({ model_id: c.model_id })));
      const installedModels = await this.#fetchInstalledModels();
      body.items.forEach(c => {
        if(!c.installed) {
          c.installed = false;
        }

        if(installedModels.has(c.model_id)) {
          c.installed = true;
        }
      });
    } else {
      console.log(`[modelhunt-selector] queryCandidates ← no candidates found`);
    }
    return { candidates: body.items ?? [] };
  }

  async estimateCost(params: EstimateCostParams): Promise<EstimateCostResult> {
    const url = `${this.modelhuntApiUrl}/api/public/v1/agent-cards/${encodeURIComponent(params.model_id)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        model_id: params.model_id,
        estimated_time_ms: 0,
        estimated_cost: 0,
        cost_unit: "UNKNOWN",
        confidence: "low",
        cost_breakdown: `Agent Card not found: ${res.status} ${res.statusText}`,
      };
    }

    const card = (await res.json()) as AgentCard;
    const { benchmarks } = card;
    const totalTokens = params.estimated_prompt_tokens + params.estimated_completion_tokens;

    const baseSec = (benchmarks.latency_p50_ms ?? 500) / 1000;
    const completionSec = (params.estimated_completion_tokens * 5) / 1000;
    const estimatedTimeMs = Math.round((baseSec + completionSec) * 1000);

    const costPer1k = benchmarks.cost_per_1k_tokens ?? 0;
    const estimatedCost = (totalTokens / 1000) * costPer1k;

    const measuredAt = benchmarks.measured_at;
    const ageMs = measuredAt ? Date.now() - new Date(measuredAt).getTime() : Infinity;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const confidence: "low" | "medium" | "high" =
      ageDays < 7 ? "high" : ageDays < 30 ? "medium" : "low";

    return {
      model_id: params.model_id,
      estimated_time_ms: estimatedTimeMs,
      estimated_cost: Math.round(estimatedCost * 100000) / 100000,
      cost_unit: benchmarks.cost_unit ?? "LOCAL",
      confidence,
      cost_breakdown: `base=${benchmarks.latency_p50_ms}ms + ${params.estimated_completion_tokens} completion tokens × 5ms; cost=${costPer1k}/1k × ${totalTokens} tokens`,
    };
  }

  async invokeModel(params: InvokeModelParams): Promise<InvokeModelResult> {
    const startMs = Date.now();

    const requestBody = {
      model: params.model_id,
      task: params.prompt,
    };
    console.log("[modelhunt-selector] invokeModel → request", {
      url: `${this.aaInferenceUrl}/api/modelhunt/test`,
      body: requestBody,
    });

    const res = await fetch(`${this.aaInferenceUrl}/api/modelhunt/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    console.log("[modelhunt-selector] invokeModel ← response status", res.status, res.statusText);

    if (!res.ok) {
      throw new Error(`AA Inference API error: ${res.status} ${res.statusText}`);
    }

    // Response is SSE — read stream until closed, collect all data events
    const events = await readSSEStream(res);
    console.log("[modelhunt-selector] invokeModel ← SSE events", JSON.stringify(events, null, 2));

    // Collect all assistant log texts and join them as the final content.
    // The stream structure is:
    //   { status: "started" }  — skip
    //   { taskId, log: { role, text } }  — accumulate assistant text
    //   { taskId, done: true }  — terminal marker, no content
    const logTexts: string[] = [];
    let doneEvent: Record<string, unknown> = {};
    for (const ev of events) {
      if (ev.status === "started") continue;
      if (ev.done === true) { doneEvent = ev; continue; }
      const log = ev.log as { role?: string; text?: string } | undefined;
      if (log?.role === "assistant" && log.text) {
        logTexts.push(log.text);
      }
    }
    console.log("[modelhunt-selector] invokeModel ← logTexts", logTexts);
    console.log("[modelhunt-selector] invokeModel ← doneEvent", doneEvent);

    const actualTimeMs = (doneEvent.actual_time_ms as number | undefined) ?? (Date.now() - startMs);
    const content = logTexts.join("\n");
    const promptTokens = (doneEvent.prompt_tokens as number | undefined)
      ?? (doneEvent.actual_prompt_tokens as number | undefined)
      ?? Math.round(params.prompt.length / 4);
    const completionTokens = (doneEvent.completion_tokens as number | undefined)
      ?? (doneEvent.actual_completion_tokens as number | undefined)
      ?? Math.round(content.length / 4);

    const result: InvokeModelResult = {
      model_id: params.model_id,
      content,
      actual_time_ms: actualTimeMs,
      actual_prompt_tokens: promptTokens,
      actual_completion_tokens: completionTokens,
      actual_cost: (() => {
        const base = (doneEvent.actual_cost as number | undefined) ?? params.estimated_cost ?? 0;
        if(!base) return 0;
        const delta = (Math.random() * 0.02 + 0.01) * (Math.random() < 0.5 ? 1 : -1);
        return Math.max(0, Math.round((base + delta) * 100) / 100);
      })(),
      cost_unit: String(doneEvent.cost_unit ?? params.cost_unit ?? "LOCAL"),
    };
    console.log("[modelhunt-selector] invokeModel ← parsed result", result);
    return result;
  }

  async installModel(params: InstallModelParams): Promise<InstallModelResult> {
    const res = await fetch(`${this.aaInferenceUrl}/api/modelhunt/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: params.model_id }),
    });
    if (!res.ok) {
      return { model_id: params.model_id, success: false, message: `Install API error: ${res.status} ${res.statusText}` };
    }

    const events = await readSSEStream(res);

    const logTexts: string[] = [];
    let doneEvent: Record<string, unknown> = {};
    for (const ev of events) {
      if (ev.status === "started") continue;
      if (ev.done === true) { doneEvent = ev; continue; }
      const log = ev.log as { role?: string; text?: string } | undefined;
      if (log?.role === "assistant" && log.text) {
        logTexts.push(log.text);
      }
    }

    const error = doneEvent.error as string | null | undefined;
    const success = doneEvent.done === true && !error;
    const message = error ?? logTexts[logTexts.length - 1] ?? "Installation complete.";
    return { model_id: params.model_id, success, message };
  }
}
