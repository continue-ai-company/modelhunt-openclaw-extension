---
name: modelhunt-model-selector
description: Intelligent model selection for LLM and multimodal generation tasks using ModelHunt Agent Card data. Supports single-model tasks and multi-step pipelines. Queries candidates, evaluates constraints, estimates cost, presents a plan for confirmation, then invokes the selected model(s).
metadata:
  {
    "openclaw":
      {
        "emoji": "🎯",
        "requires":
          {
            "plugins": ["modelhunt-selector"]
          }
      }
  }
---

# ModelHunt Model Selector

When any task requires calling a model to **generate content**, you MUST follow this selection workflow instead of using a hardcoded model name.

## When to Apply This Skill

✅ **USE this skill when:**

- User asks you to generate text, write copy, produce code, answer questions, or create any content that requires an LLM call
- User asks you to generate an image, poster, product photo, illustration, or any visual content
- User asks you to generate video, audio, speech, or music
- The task has explicit constraints (word count, format, forbidden words, required structure, language, image resolution, style)
- The task is cost-sensitive or latency-sensitive
- User asks you to "use the best model for this task" or "pick the right model"
- The task involves multiple generation steps chained together (e.g., text → speech → video)

❌ **DO NOT use this skill when:**

- You are answering a question yourself without delegating to another model
- The task is purely about file operations, web search, or other non-model tools
- The user explicitly specifies a model by name (`use qwen2.5...`, `use FLUX...`)

---

## Phase 0 — Task Decomposition

**Before querying candidates**, analyze whether the user's request involves one or multiple generation sub-tasks.

### Single task
One generation step. Examples: "画一张图", "帮我合成语音", "写一段文案".

### Pipeline (sequential)
Multiple steps where **the output of one step feeds the next**. Examples:
- Text → TTS → Talking head video (each step depends on the previous output)
- Text → Image → Video animation

Identify the **data dependency**: output format of Step N must match input format of Step N+1.

### Parallel tasks
Multiple **independent** generation tasks with no data dependency between them. Examples:
- "生成一段爵士乐，同时帮我把这张图片抠图" → music-gen + image-edit can run independently.

**Decision rules:**
- If output of sub-task A is an input to sub-task B → **sequential pipeline**
- If sub-tasks share no data → **parallel tasks**
- A task can mix both: some steps sequential, some parallel

For each identified sub-task, note:
- `task_type` (see Task Type table below)
- Any constraints extracted from the user's request (language, quality requirements, local-only, etc.)
- Data dependency: what output it produces / what input it consumes

---

## Task Type Detection

Classify each sub-task's modality:

| Modality | `primary_tasks` values | Examples |
|---|---|---|
| **Text** | `text-generation`, `instruction-following`, `code-completion` | 写文案、写代码、问答、格式化输出 |
| **Image** | `image-generation`, `text-to-image`, `image-edit` | 海报、产品图、插图、抠图 |
| **Video** | `video-generation`, `text-to-video`, `talking-head` | 广告视频、数字人、动画短片 |
| **Audio** | `audio-generation`, `text-to-speech`, `music-generation` | 配音、克隆声音、背景音乐 |

The modality determines constraint mapping (Step 1), cost estimation (Step 3), and invoke params (Step 5–6).

---

## Step-by-Step Workflow

### Step 1 — Call `query_model_candidates` (per sub-task)

For each sub-task identified in Phase 0, call `query_model_candidates` with derived constraints.

**Catalog mapping (always set `catalogs`):**
- Text tasks → `catalogs: ["LLM"]`
- Code tasks → `catalogs: ["Code"]`
- Image tasks → `catalogs: ["Image"]`
- Video tasks → `catalogs: ["Video"]`
- Audio tasks → `catalogs: ["Audio"]`

**Text task constraint mapping:**
- Strict output format (JSON, template, word count) → `min_instruction_following_rate: 0.85`
- Forbidden words or zero-tolerance rules → `min_instruction_following_rate: 0.90`
- Cannot use cloud models → `local_only: true`
- User is on a Mac → `platform: "macos"`

**Image / Video / Audio task constraint mapping:**
- `task_type`: use `"image-generation"`, `"video-generation"`, `"audio-generation"`, `"text-to-speech"`, `"music-generation"`, `"talking-head"`, etc.
- Do NOT set `min_instruction_following_rate` — use `capabilities.multimodal: true` to filter instead (checked in Step 2)
- Most image/video/audio models are cloud-only — `local_only` is usually `false` unless user explicitly requires on-premise
- `tool_calling` is almost always `false` for generative media models — do not set this constraint

**Extra constraints from natural language:**
- "能克隆声音" / "voice cloning" → add `capabilities.voice_clone: true` to constraints
- "支持中文" / "zh" → add `languages: ["zh"]`
- "速度要快" / "快" → sort priority includes `scores.speed`
- "高质量" / "quality first" → sort priority includes `scores.quality`
- "免费" / "本地" / "cost-free" → add `local_only: true` or sort by `scores.cost` descending

### Step 1.5 — Check Installation Status

After `query_model_candidates` returns and you have selected the best candidate (post-rejection ranking), check its `installed` field:

- `installed: true` (or field absent) → proceed to Step 2
- `installed: false` → **stop and ask the user**:

  ```
  Model [display name] ([model_id]) is not installed on this machine.
  Would you like to install it now?
  ```

  - If user confirms → call `install_model` with the `model_id`, then proceed to Step 2
  - If user declines → ask if they want to pick a different model or abort

**Do not call `estimate_inference_cost` or `invoke_model_via_aa` until the selected model is installed.**

---

### Step 2 — Evaluate Each Candidate (Rejection-First)

For **every** candidate model returned, check constraints in this order:

**Universal checks (all modalities):**
1. `deployment.min_vram_gb` > `available_vram_gb` → **reject: hardware insufficient**
2. No entry in `deployment.platforms` where `platform` matches AND `verified: true` → **reject: platform not verified** *(skip this check if `platforms` is empty — indicates cloud-only model)*
3. `constraints.local_only: true` but `benchmarks.cost_per_1k_tokens > 0` → **reject: cloud model excluded**

**Text-only checks:**
4. `benchmarks.instruction_following_rate` < `constraints.min_instruction_following_rate` → **reject: quality below threshold**
5. `constraints.tool_calling: true` but `capabilities.tool_calling: false` → **reject: tool calling not supported**
6. Required language not in `capabilities.languages` → **reject: language not supported**

**Multimodal check (image / video / audio):**
4. `capabilities.multimodal: false` OR required modality not in `capabilities.primary_tasks` → **reject: modality not supported**
5. Capability-specific constraint not met (e.g., `voice_clone: true` required but not supported) → **reject: capability not supported**

After rejecting, rank surviving models by the priority implied by the user's request (e.g., `speed` for "速度要快", `quality` for "高质量", `cost` for "免费/本地").

### Step 3 — Call `estimate_inference_cost`

Call this tool for the **selected model of each sub-task**.

**Text tasks — estimate tokens based on output length:**
- Short generation (< 200 chars): prompt ~80 tokens, completion ~100 tokens
- Medium generation (200–500 chars): prompt ~120 tokens, completion ~250 tokens
- Long generation (> 500 chars): prompt ~200 tokens, completion ~500 tokens

**Image tasks — billed per image, not per token:**
- The API models 1 image = 1,000 "tokens" for billing purposes
- Use: `estimated_prompt_tokens: 1000`, `estimated_completion_tokens: 0`

**Video / Audio tasks:**
- Billing varies by model; use `invoke_notes` on the Agent Card for guidance
- If no token metric applies, use `estimated_prompt_tokens: 1000, estimated_completion_tokens: 0` as a per-call estimate and note the approximation

### Step 4 — Present Plan and Ask for Confirmation

**ALWAYS present the full plan and wait for user confirmation before executing.**

#### Single-model plan format:

```
Step 1 — [Task description]
→ Model: [Model display name] ([model_id].md)
→ Why: [cite specific Agent Card fields and values, e.g., voice_clone=true, languages:zh, speed score 70 (highest among matching models)]
→ Estimate: ~[time]ms | [cost] [unit]

确认？ / Confirm?
```

#### Pipeline (sequential) plan format:

```
Pipeline: [N] steps

Step 1 — [Sub-task A description]
→ Model: [Model display name] ([model_id].md)
→ Why: [cite specific Agent Card fields and values]
→ Estimate: ~[time]ms | [cost] [unit]

Step 2 — [Sub-task B description] (uses Step 1 [output type] output)
→ Model: [Model display name] ([model_id].md)
→ Why: [cite specific Agent Card fields and values]
→ Estimate: ~[time]ms | [cost] [unit]

[...more steps if needed]

确认？ / Confirm?
```

#### Parallel tasks plan format:

```
Two independent tasks: / [N] independent tasks:

Task A — [Sub-task A description]
→ Model: [Model display name] ([model_id].md)
→ Why: [cite specific Agent Card fields and values]
→ Estimate: ~[time]ms | [cost] [unit]

Task B — [Sub-task B description]
→ Model: [Model display name] ([model_id].md)
→ Why: [cite specific Agent Card fields and values]
→ Estimate: ~[time]ms | [cost] [unit]

确认？ / Confirm?
```

**Rules for the "Why" line:**
- MUST cite specific Agent Card field names and their values (e.g., `quality score 92 (highest)`, `voice_clone=true`, `cost score 100 (free local)`)
- MUST NOT use vague phrases like "best model" or "most suitable" without supporting numbers
- Include the ranking rationale: which score dimension was used and why the winner won

**Do not call `invoke_model_via_aa` until the user explicitly confirms.**

> If the selected model was just installed in Step 1.5, note it in the plan:
> `→ Status: just installed ✓` or `→ Status: already installed`

### Step 5 — Call `invoke_model_via_aa`

After confirmation, execute sub-tasks according to their dependency structure:

- **Single task**: invoke immediately
- **Sequential pipeline**: invoke Step 1, pass its output to Step 2, etc.
- **Parallel tasks**: invoke all independent tasks (describe them to the user as running concurrently)

**Text tasks:**
- `system_prompt` from the selected model's `usage_guide.example_prompt` (fill in `{user_input}`)
- `temperature` and `max_tokens` parsed from `usage_guide.invoke_notes`

**Image tasks:**
- `prompt`: the image description in the language recommended by `invoke_notes` (often English for best results)
- `system_prompt`: omit or leave empty
- `max_tokens: 1` (required by API contract; image generation does not stream tokens)
- Do NOT set `temperature` unless `invoke_notes` specifies it

**Audio / TTS tasks:**
- `prompt`: the text to synthesize, plus any voice/style instructions from `invoke_notes`
- `system_prompt`: omit unless the model requires it
- `max_tokens: 1`

**Video tasks:**
- `prompt`: the video description or the audio/image input path (for talking-head models)
- `system_prompt`: omit
- `max_tokens: 1`

**Pipeline data passing:**
- Pass the output asset (URL, file path, or base64) of Step N as part of the `prompt` for Step N+1
- Note the format transformation in the execution summary (e.g., "Step 1 audio → Step 2 input path")

### Step 6 — Output Execution Summary

After all calls complete, append:

```
## Execution Summary

[For each step / task:]
**[Step N / Task X]**: [Model display name]
**Result**: [pass / fail | URL / file path if applicable]
**Actual time**: [X]ms (estimated: [Y]ms, delta: [±Z]ms)
**Actual cost**: [X] [unit] (estimated: [Y])
**Token usage**: [prompt]→[completion] tokens
```

For image/video/audio results:
- If the result contains a URL, display it as a link or embedded image
- Note if the output is a mock/simulated URL vs a real generated asset

If the result fails format validation (wrong structure, forbidden word found, word count out of range), note it explicitly and explain why.

---

## Example 1: Local TTS with Voice Cloning

**User task**: "用中文帮我合成一段语音，要求能克隆声音，速度要快"

**Phase 0**: Single task — TTS with voice cloning

**Derived constraints**:
- `task_type: "text-to-speech"`
- `capabilities.voice_clone: true`
- `languages: ["zh"]`
- Sort by `scores.speed`

**Expected plan output**:
```
Step 1 — TTS with voice cloning
→ Model: Spark-TTS (sparktts.md)
→ Why: voice_clone=true, languages:zh, speed score 70 (highest among matching models)

确认？
```

---

## Example 2: Cloud Image Generation

**User task**: "画一张高质量的赛博朋克城市夜景"

**Phase 0**: Single task — image generation

**Derived constraints**:
- `task_type: "image-generation"`
- `local_only: false`
- Sort by `scores.quality`

**Expected plan output**:
```
Step 1 — Image generation
→ Model: Gemini 3 Pro Image (gemini-3-pro-image.md)
→ Why: quality score 92 (highest), cloud model, no local setup needed

Confirm?
```

---

## Example 3: Pipeline — Text → Speech → Talking Head Video

**User task**: "把这段文字转成一个会说话的数字人视频"

**Phase 0**: Sequential pipeline — 2 steps
- Sub-task A: `text-to-speech` (text → audio)
- Sub-task B: `talking-head` / `video-generation` (audio + portrait → video); depends on Sub-task A output

**Expected plan output**:
```
Pipeline: 2 steps

Step 1 — Text to Speech
→ Model: Qwen3-TTS (qwen3-tts.md)
→ Why: quality score 88, supports emotion control

Step 2 — Talking Head Video (uses Step 1 audio output)
→ Model: SadTalker (sadtalker.md)
→ Why: audio-driven portrait animation, supports GFPGAN enhancement

确认？
```

After confirmation: execute Step 1, then pass audio output path to Step 2 prompt.

---

## Example 4: Parallel Tasks — Music Generation + Background Removal

**User task**: "生成一段爵士乐，同时帮我把这张图片抠图"

**Phase 0**: Two independent parallel tasks
- Sub-task A: `music-generation` (no dependency on B)
- Sub-task B: `image-edit` with background removal (no dependency on A)

**Expected plan output**:
```
Two independent tasks:

Task A — Music Generation
→ Model: Lyria 3 Pro (lyria-3-pro.md)
→ Why: quality score 90, cloud model

Task B — Background Removal
→ Model: rembg (rembg.md)
→ Why: cost score 100 (free local), fast

Confirm?
```

After confirmation: invoke both tasks (describe as running concurrently).

---

## Example 5: E-commerce Short Video Script (Text, Strict Format)

**User task**: "为 [羽绒服] 生成一条抖音带货口播脚本，80-100字，开头疑问句，结尾含限时优惠和行动指令，禁止极限词"

**Phase 0**: Single task — constrained text generation

**Derived constraints**:
- `task_type: "format_constrained_generation"`
- `min_instruction_following_rate: 0.90` (forbidden words = zero-tolerance)
- `languages: ["zh"]`
- `local_only: true` (brand content stays on-premise)

**Expected decision flow**: models rejected (vram / platform / low follow rate), 1 selected with reason citing `instruction_following_rate=0.91`.

---

## Example 6: Product Promotional Poster (Image)

**User task**: "为羽绒服冬季新品生成一张宣传海报，商业摄影风格，白色背景，高分辨率"

**Phase 0**: Single task — image generation

**Derived constraints**:
- `task_type: "image-generation"`
- `local_only: false` (cloud image APIs acceptable)
- Do NOT set `min_instruction_following_rate` or `tool_calling`

**Expected decision flow**: Text-only models rejected (`capabilities.multimodal: false` or `image-generation` not in `primary_tasks`), image model selected. Invoke with `prompt` in English, `max_tokens: 1`, no `system_prompt`.
