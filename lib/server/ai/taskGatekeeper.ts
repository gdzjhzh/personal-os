import type { DeepSeekMessage } from "@/lib/server/ai/deepseek";
import type {
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
  DecisionContextPack,
  TaskGateContextSnapshot,
  TaskGateDialogMessage,
  TaskGateEvidence,
  TaskGateOption,
  TaskGateVerdict,
  TaskGateVerdictKind,
  TaskOwner,
  TaskPriority,
} from "@/lib/types";

export type TaskGatePromptInput = {
  rawTask: string;
  project?: string;
  currentPhaseContext?: string;
  contextPack: DecisionContextPack;
  dialogMessages?: TaskGateDialogMessage[];
  force?: boolean;
  previousVerdict?: TaskGateVerdict;
};

const defaultNorthStar =
  "成为独立 SaaS 产品创建者，逐步建立第二增长曲线。";
const defaultCurrentFocus =
  "让 Personal SaaS OS 成为日用的任务规划和复盘系统。";

const verdictKinds: TaskGateVerdictKind[] = ["reject", "ask", "recommend"];
const priorities: TaskPriority[] = ["P0", "P1", "P2"];
const statuses: ClarifiedTaskStatus[] = [
  "inbox",
  "active",
  "codex_ready",
  "waiting",
  "frozen",
];
const codexFits: CodexFit[] = ["high", "medium", "low", "none"];
const owners: TaskOwner[] = ["human", "codex", "mixed"];
const sourceTypes: TaskGateEvidence["sourceType"][] = [
  "rawInput",
  "operatingContext",
  "task",
  "review",
  "evidence",
  "productTeardown",
  "driftPattern",
];
const optionIntents: TaskGateOption["intent"][] = [
  "answer",
  "revise_smaller",
  "continue",
  "dismiss",
  "force",
];

export class TaskGatekeeperError extends Error {
  code: "invalid_json" | "invalid_verdict";
  rawOutput?: string;

  constructor(
    code: TaskGatekeeperError["code"],
    message: string,
    rawOutput?: string,
  ) {
    super(message);
    this.name = "TaskGatekeeperError";
    this.code = code;
    this.rawOutput = rawOutput;
  }
}

export function buildTaskGateMessages(
  input: TaskGatePromptInput,
): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(Boolean(input.force)),
    },
    {
      role: "user",
      content: buildUserPrompt(input),
    },
  ];
}

export function buildForceTaskMessages(
  input: TaskGatePromptInput,
): DeepSeekMessage[] {
  return buildTaskGateMessages({
    ...input,
    force: true,
  });
}

export function parseTaskGateVerdict(
  rawOutput: string,
  input: TaskGatePromptInput,
): TaskGateVerdict {
  let parsed: unknown;
  const trimmed = rawOutput.trim();

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new TaskGatekeeperError(
      "invalid_json",
      "AI 返回了无法解析的判断结果。输入已保留，可以重试或改为手动新增。",
      rawOutput,
    );
  }

  return validateTaskGateVerdict(parsed, input, rawOutput);
}

export function validateTaskGateVerdict(
  value: unknown,
  input: TaskGatePromptInput,
  rawOutput = "",
): TaskGateVerdict {
  if (!isRecord(value)) {
    throwInvalid(rawOutput);
  }

  const verdict = readEnum(value.verdict, verdictKinds, rawOutput);
  const contextSnapshot = readContextSnapshotOrFallback(
    value.contextSnapshot,
    input.contextPack,
  );
  const summary =
    readOptionalString(value.summary, rawOutput) || fallbackSummary(verdict);
  const reason =
    readOptionalString(value.reason, rawOutput) || fallbackReason(verdict);
  const evidence = readEvidenceArray(value.evidence, rawOutput, input);
  const forceDraftSuggestion = readForceDraftSuggestion(value.forceDraftSuggestion);

  if (input.force) {
    const taskDraft =
      readTaskDraftIfPossible(value.taskDraft, rawOutput, input) ||
      buildTaskFromForceSuggestion(forceDraftSuggestion, input) ||
      buildMinimalForcedTask(input);

    return {
      verdict: "recommend",
      summary:
        summary || "已按你的要求强制生成一个最小任务草稿。",
      reason:
        reason ||
        "这是用户强制生成，不代表系统推荐；默认放入 inbox / P2，并保留风险标记。",
      evidence,
      blockingQuestion: undefined,
      options: forceResultOptions(),
      contextSnapshot,
      taskDraft: enforceForcedTask(taskDraft),
      forceDraftSuggestion: null,
    };
  }

  let taskDraft: ClarifiedTaskDraft | null = null;

  if (verdict === "recommend") {
    taskDraft = readTaskDraftIfPossible(value.taskDraft, rawOutput, input);

    if (!taskDraft) {
      throw new TaskGatekeeperError(
        "invalid_verdict",
        "AI 建议生成任务，但没有返回可保存的任务草稿。输入已保留，可以重试或手动新增。",
        rawOutput,
      );
    }

    assertTaskDraftIsExecutable(taskDraft, rawOutput);
  }

  if (verdict === "reject") {
    return {
      verdict,
      summary,
      reason,
      evidence,
      blockingQuestion: undefined,
      options: normalizeRejectOptions(value.options, rawOutput),
      contextSnapshot,
      taskDraft: null,
      forceDraftSuggestion,
    };
  }

  if (verdict === "ask") {
    return {
      verdict,
      summary,
      reason,
      evidence,
      blockingQuestion:
        readOptionalString(value.blockingQuestion, rawOutput) ||
        "你想推进的是产品验证、具体开发、发布流程，还是只是先记录一个想法？",
      options: normalizeAskOptions(value.options, rawOutput),
      contextSnapshot,
      taskDraft: null,
      forceDraftSuggestion: null,
    };
  }

  return {
    verdict,
    summary,
    reason,
    evidence,
    blockingQuestion: undefined,
    options: normalizeRecommendOptions(value.options, rawOutput),
    contextSnapshot,
    taskDraft,
    forceDraftSuggestion: null,
  };
}

export function buildFallbackVerdict(
  input: TaskGatePromptInput,
): TaskGateVerdict {
  if (input.force) {
    return {
      verdict: "recommend",
      summary: "AI 未能及时完成强制草稿，已按强制规则生成最小任务草稿。",
      reason:
        "这是用户强制生成，不代表系统推荐；默认放入 inbox / P2，并保留风险标记。",
      evidence: [
        {
          sourceType: "rawInput",
          label: "原始输入",
          quote: input.rawTask.trim(),
          interpretation: "用户明确要求强制生成，因此只能创建最小风险任务。",
        },
      ],
      blockingQuestion: undefined,
      options: forceResultOptions(),
      contextSnapshot: buildContextSnapshot(input.contextPack),
      taskDraft: enforceForcedTask(buildMinimalForcedTask(input)),
      forceDraftSuggestion: null,
    };
  }

  return {
    verdict: "ask",
    summary: "这个输入暂时不能判断是否值得生成任务。",
    reason:
      "为了避免把一个模糊想法包装成低价值任务，需要先确认你想推进的具体方向。",
    evidence: [
      {
        sourceType: "rawInput",
        label: "原始输入",
        quote: input.rawTask.trim(),
        interpretation: "信息不足，无法判断是否服务于当前重点。",
      },
    ],
    blockingQuestion:
      "你想推进的是产品验证、具体开发、发布流程，还是只是先记录一个想法？",
    options: normalizeAskOptions([], ""),
    contextSnapshot: buildContextSnapshot(input.contextPack),
    taskDraft: null,
    forceDraftSuggestion: null,
  };
}

export function isAmbiguousShortInput(rawTask: string) {
  const text = rawTask.trim();
  const hasActionVerb =
    /做|改|修|写|发|看|研究|整理|上线|发布|开发|设计|验证|拆解/.test(text);

  return text.length <= 8 && !hasActionVerb;
}

function buildSystemPrompt(force: boolean) {
  return `You are Personal OS's task gatekeeper, not a generic todo generator.

The user's long-term north star is: ${defaultNorthStar}
The current focus is: ${defaultCurrentFocus}

Your first job is to decide whether the user's idea deserves to become a task now.
Your second job is to compress it into an executable task only after it deserves entry.
Do not generate a task by default.
AI is not an encouragement machine and not a todo parser. It should block low-value tasks.
The user has final control and may force creation. Force does not mean recommendation.

Use the user's northStar, currentFocus, active constraints, antiGoals, principles, active tasks, recent reviews, evidence, product teardowns, and drift patterns.

Return exactly one verdict:
- reject: the idea should not become a task now.
- ask: one blocking question must be answered before deciding.
- recommend: the idea is worth turning into a task.

Rules:
- If the idea conflicts with currentFocus, prefer reject or ask.
- If it looks like 泛学习、信息刷屏、系统打磨成瘾、任务过大、只整理不交付、产出不可观察、新方向扩散、逃避用户验证, prefer reject or ask.
- Learning, research, sorting, summarizing, and review are not automatically low value.
- Only treat learning as drift when it has no application target, no output artifact, and no link to the current monthly goal, current task, knowledge card, or review.
- If the user is asking to review, recall, explain, or understand something instead of explicitly creating a task, do not force a task draft. Prefer ask/reject and tell them to use Personal OS Coach for review or knowledge recall.
- If the user explicitly wants to create a learning task, judge whether it has doneWhen, an application scene, and a concrete output artifact.
- If the input is too short or ambiguous, prefer ask.
- If the output cannot be observed within 25 minutes, do not recommend yet.
- Do not create a task unless verdict is recommend or force is true.
- In reject and ask, taskDraft must be null.
- If force is true, create the smallest possible task, mark risks, set priority P2 and status inbox.
- If force is true, notes must mention 用户强制生成 or 强制执行.
- User-facing fields should be Chinese.
- Return ONLY strict JSON. No markdown. No comments. No code fences.
- Do not output chain-of-thought. evidence should be short, auditable, and based on rawInput or DecisionContextPack.

Required JSON shape:
{
  "verdict": "reject" | "ask" | "recommend",
  "summary": string,
  "reason": string,
  "evidence": [
    {
      "sourceType": "rawInput" | "operatingContext" | "task" | "review" | "evidence" | "productTeardown" | "driftPattern",
      "label": string,
      "quote": string,
      "interpretation": string
    }
  ],
  "blockingQuestion": string | null,
  "options": [
    {
      "label": string,
      "value": string,
      "intent": "answer" | "revise_smaller" | "continue" | "dismiss" | "force"
    }
  ],
  "contextSnapshot": {
    "northStar": string,
    "currentFocus": string,
    "activeTaskCount": number,
    "recentReviewCount": number,
    "recentEvidenceCount": number,
    "recentProductTeardownCount": number,
    "recentDriftPatternCount": number,
    "driftPatterns": string[]
  },
  "taskDraft": {
    "title": string,
    "project": string,
    "priority": "P0" | "P1" | "P2",
    "status": "inbox" | "active" | "codex_ready" | "waiting" | "frozen",
    "codexFit": "high" | "medium" | "low" | "none",
    "owner": "human" | "codex" | "mixed",
    "nextAction": string,
    "doneWhen": string,
    "riskFlags": string[],
    "doNot": string[],
    "notes": string
  } | null,
  "forceDraftSuggestion": {
    "title": string,
    "nextAction": string,
    "doneWhen": string,
    "riskFlags": string[],
    "doNot": string[],
    "notes": string
  } | null
}

Current force mode: ${force ? "true" : "false"}.`;
}

function buildUserPrompt(input: TaskGatePromptInput) {
  const contextSnapshot = buildContextSnapshot(input.contextPack);
  const shortInputWarning = isAmbiguousShortInput(input.rawTask)
    ? "This input is very short and ambiguous. Prefer ask unless context makes it clearly actionable."
    : "None";

  return `Raw user idea:
${input.rawTask.trim()}

Project:
${normalizedProject(input)}

Current phase context:
${
  input.currentPhaseContext?.trim() ||
  "Build the simplest local V0 and use it daily. Keep scope small."
}

Short input guard:
${shortInputWarning}

Force mode:
${input.force ? "true" : "false"}

Dialog messages so far:
${JSON.stringify(input.dialogMessages?.slice(-8) || [], null, 2)}

Previous verdict:
${JSON.stringify(input.previousVerdict || null, null, 2)}

Actual context snapshot to preserve if model is unsure:
${JSON.stringify(contextSnapshot, null, 2)}

DecisionContextPack:
${JSON.stringify(input.contextPack, null, 2)}

Return the strict JSON verdict now.`;
}

function readTaskDraftIfPossible(
  value: unknown,
  rawOutput: string,
  input: TaskGatePromptInput,
) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return readTaskDraft(value, rawOutput, input);
  } catch {
    return null;
  }
}

function readTaskDraft(
  value: unknown,
  rawOutput: string,
  input: TaskGatePromptInput,
): ClarifiedTaskDraft {
  const record = readRecord(value, rawOutput);
  const task: ClarifiedTaskDraft = {
    title: readString(record.title, rawOutput),
    project: readOptionalString(record.project, rawOutput) || normalizedProject(input),
    priority: readEnum(record.priority, priorities, rawOutput),
    status: readEnum(record.status, statuses, rawOutput),
    codexFit: readEnum(record.codexFit, codexFits, rawOutput),
    owner: readEnum(record.owner, owners, rawOutput),
    nextAction: readString(record.nextAction, rawOutput),
    doneWhen: readString(record.doneWhen, rawOutput),
    riskFlags: readStringArray(record.riskFlags, rawOutput),
    doNot: readStringArray(record.doNot, rawOutput),
    notes: readString(record.notes, rawOutput),
  };

  assertTaskDraftIsExecutable(task, rawOutput);

  return task;
}

function assertTaskDraftIsExecutable(
  task: ClarifiedTaskDraft,
  rawOutput: string,
) {
  if (!task.title || !task.nextAction || !task.doneWhen) {
    throwInvalid(rawOutput);
  }

  if (task.nextAction.length < 4 || task.doneWhen.length < 4) {
    throwInvalid(rawOutput);
  }
}

function enforceForcedTask(task: ClarifiedTaskDraft): ClarifiedTaskDraft {
  const riskFlags = uniqueStrings([
    ...task.riskFlags,
    task.riskFlags.length > 0 ? "" : "信息不足仍强制执行",
  ]);
  const notes = /用户强制生成|强制执行/.test(task.notes)
    ? task.notes
    : `用户强制生成，不代表系统推荐。${task.notes ? ` ${task.notes}` : ""}`;

  return {
    ...task,
    priority: "P2",
    status: "inbox",
    riskFlags:
      riskFlags.length > 0 ? riskFlags : ["信息不足仍强制执行"],
    notes,
  };
}

function readForceDraftSuggestion(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringOrEmpty(value.title);
  const nextAction = stringOrEmpty(value.nextAction);
  const doneWhen = stringOrEmpty(value.doneWhen);

  if (!title || !nextAction || !doneWhen) {
    return null;
  }

  return {
    title,
    nextAction,
    doneWhen,
    riskFlags: stringArrayOrEmpty(value.riskFlags),
    doNot: stringArrayOrEmpty(value.doNot),
    notes: stringOrEmpty(value.notes),
  };
}

function buildTaskFromForceSuggestion(
  suggestion: TaskGateVerdict["forceDraftSuggestion"],
  input: TaskGatePromptInput,
): ClarifiedTaskDraft | null {
  if (!suggestion) {
    return null;
  }

  return {
    title: suggestion.title,
    project: normalizedProject(input),
    priority: "P2",
    status: "inbox",
    codexFit: "medium",
    owner: "human",
    nextAction: suggestion.nextAction,
    doneWhen: suggestion.doneWhen,
    riskFlags: suggestion.riskFlags,
    doNot: suggestion.doNot,
    notes: suggestion.notes || "用户强制生成，不代表系统推荐。",
  };
}

function buildMinimalForcedTask(input: TaskGatePromptInput): ClarifiedTaskDraft {
  const idea = input.rawTask.trim();

  return {
    title: `验证是否要推进：${idea || "未命名想法"}`,
    project: normalizedProject(input),
    priority: "P2",
    status: "inbox",
    codexFit: "none",
    owner: "human",
    nextAction:
      "用 25 分钟写出这个想法要服务的用户、可观察证据，以及今天不做什么。",
    doneWhen:
      "得到一段不超过 5 行的判断：继续、缩小、还是放弃，并能说明依据。",
    riskFlags: ["信息不足仍强制执行", "新方向扩散"],
    doNot: ["不要直接开发", "不要扩成泛调研", "不要加入今日 P0"],
    notes: "用户强制生成，不代表系统推荐；先作为 inbox / P2 风险任务保存。",
  };
}

function readEvidenceArray(
  value: unknown,
  rawOutput: string,
  input: TaskGatePromptInput,
): TaskGateEvidence[] {
  const evidence = Array.isArray(value)
    ? value
        .slice(0, 5)
        .map((item) => {
          const record = readRecord(item, rawOutput);

          return {
            sourceType: readEnum(record.sourceType, sourceTypes, rawOutput),
            label: readString(record.label, rawOutput),
            quote: readString(record.quote, rawOutput),
            interpretation: readString(record.interpretation, rawOutput),
          };
        })
        .filter((item) => item.label && item.quote && item.interpretation)
    : [];

  if (evidence.length > 0) {
    return evidence;
  }

  return [
    {
      sourceType: "rawInput",
      label: "原始输入",
      quote: input.rawTask.trim(),
      interpretation: "系统保留了原始想法作为判断依据。",
    },
  ];
}

function readOptions(value: unknown, rawOutput: string): TaskGateOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = readRecord(item, rawOutput);

      return {
        label: readString(record.label, rawOutput),
        value: readString(record.value, rawOutput),
        intent: readEnum(record.intent, optionIntents, rawOutput),
      };
    })
    .filter((option) => option.label && option.value)
    .slice(0, 5);
}

function normalizeRejectOptions(value: unknown, rawOutput: string) {
  const options = readOptions(value, rawOutput);

  appendUniqueOption(options, {
    label: "暂不生成",
    value: "dismiss",
    intent: "dismiss",
  });
  appendUniqueOption(options, {
    label: "改成更小的验证动作",
    value: "请把这个想法改成 25 分钟内可验证的最小动作。",
    intent: "revise_smaller",
  });
  appendUniqueOption(options, {
    label: "继续讨论",
    value: "continue",
    intent: "continue",
  });
  appendUniqueOption(options, {
    label: "强制生成",
    value: "force",
    intent: "force",
  });

  return options.slice(0, 5);
}

function normalizeAskOptions(value: unknown, rawOutput: string) {
  const options = readOptions(value, rawOutput);

  appendUniqueOption(options, {
    label: "验证小程序是否适合作为产品入口",
    value: "我想验证小程序是否适合作为产品入口。",
    intent: "answer",
  });
  appendUniqueOption(options, {
    label: "开发一个具体小程序功能",
    value: "我想开发一个具体小程序功能。",
    intent: "answer",
  });
  appendUniqueOption(options, {
    label: "整理小程序发布流程",
    value: "我想整理小程序发布流程。",
    intent: "answer",
  });
  appendUniqueOption(options, {
    label: "只是一个想法，先不生成",
    value: "dismiss",
    intent: "dismiss",
  });
  appendUniqueOption(options, {
    label: "强制生成",
    value: "force",
    intent: "force",
  });

  return options.slice(0, 5);
}

function normalizeRecommendOptions(value: unknown, rawOutput: string) {
  const options = readOptions(value, rawOutput);

  appendUniqueOption(options, {
    label: "接受并生成任务",
    value: "save",
    intent: "answer",
  });
  appendUniqueOption(options, {
    label: "改得更小",
    value: "请把这个任务再缩小一档。",
    intent: "revise_smaller",
  });
  appendUniqueOption(options, {
    label: "继续讨论",
    value: "continue",
    intent: "continue",
  });
  appendUniqueOption(options, {
    label: "暂不生成",
    value: "dismiss",
    intent: "dismiss",
  });

  return options.slice(0, 5);
}

function forceResultOptions(): TaskGateOption[] {
  return [
    {
      label: "写入任务",
      value: "save",
      intent: "answer",
    },
    {
      label: "继续修改",
      value: "continue",
      intent: "continue",
    },
    {
      label: "放弃",
      value: "dismiss",
      intent: "dismiss",
    },
  ];
}

function appendUniqueOption(options: TaskGateOption[], option: TaskGateOption) {
  if (
    options.some(
      (item) =>
        item.label === option.label ||
        item.value === option.value ||
        (option.intent !== "answer" && item.intent === option.intent),
    )
  ) {
    return;
  }

  options.push(option);
}

function readContextSnapshotOrFallback(
  value: unknown,
  contextPack: DecisionContextPack,
): TaskGateContextSnapshot {
  const fallback = buildContextSnapshot(contextPack);

  if (!isRecord(value)) {
    return fallback;
  }

  const driftPatterns = stringArrayOrEmpty(value.driftPatterns).slice(0, 8);

  return {
    northStar: stringOrEmpty(value.northStar) || fallback.northStar,
    currentFocus: stringOrEmpty(value.currentFocus) || fallback.currentFocus,
    activeTaskCount: numberOrFallback(
      value.activeTaskCount,
      fallback.activeTaskCount,
    ),
    recentReviewCount: numberOrFallback(
      value.recentReviewCount,
      fallback.recentReviewCount,
    ),
    recentEvidenceCount: numberOrFallback(
      value.recentEvidenceCount,
      fallback.recentEvidenceCount,
    ),
    recentProductTeardownCount: numberOrFallback(
      value.recentProductTeardownCount,
      fallback.recentProductTeardownCount,
    ),
    recentDriftPatternCount: numberOrFallback(
      value.recentDriftPatternCount,
      fallback.recentDriftPatternCount,
    ),
    driftPatterns:
      driftPatterns.length > 0 ? driftPatterns : fallback.driftPatterns,
  };
}

function buildContextSnapshot(
  contextPack: DecisionContextPack,
): TaskGateContextSnapshot {
  const stats = contextPack.contextStats;

  return {
    northStar: contextPack.operatingContext.northStar || defaultNorthStar,
    currentFocus:
      contextPack.operatingContext.currentFocus || defaultCurrentFocus,
    activeTaskCount: stats.activeTaskCount,
    recentReviewCount: stats.recentReviewCount,
    recentEvidenceCount: stats.recentEvidenceCount,
    recentProductTeardownCount: stats.recentProductTeardownCount,
    recentDriftPatternCount: stats.recentDriftPatternCount,
    driftPatterns: contextPack.recentDriftPatterns
      .map((pattern) => pattern.pattern)
      .filter(Boolean)
      .slice(0, 8),
  };
}

function fallbackSummary(verdict: TaskGateVerdictKind) {
  if (verdict === "reject") {
    return "暂不建议把这个想法生成任务。";
  }

  if (verdict === "ask") {
    return "需要先确认一个阻塞问题。";
  }

  return "建议生成一个很小的任务草稿。";
}

function fallbackReason(verdict: TaskGateVerdictKind) {
  if (verdict === "recommend") {
    return "它可以在 25 分钟内形成可观察输出，并且没有明显偏离当前重点。";
  }

  return "目前还不能确认这个想法值得进入任务系统，需要先降低歧义和漂移风险。";
}

function normalizedProject(input: TaskGatePromptInput) {
  return input.project?.trim() || "Personal SaaS OS";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, rawOutput: string) {
  if (!isRecord(value)) {
    throwInvalid(rawOutput);
  }

  return value;
}

function readString(value: unknown, rawOutput: string) {
  if (typeof value !== "string") {
    throwInvalid(rawOutput);
  }

  return value.trim();
}

function readOptionalString(value: unknown, rawOutput: string) {
  if (value === undefined || value === null) {
    return "";
  }

  return readString(value, rawOutput);
}

function readStringArray(value: unknown, rawOutput: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throwInvalid(rawOutput);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  rawOutput: string,
) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throwInvalid(rawOutput);
  }

  return value as T;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayOrEmpty(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOrFallback(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function throwInvalid(rawOutput: string): never {
  throw new TaskGatekeeperError(
    "invalid_verdict",
    "AI 返回的任务准入判断不符合结构要求。输入已保留，可以重试或手动新增。",
    rawOutput,
  );
}
