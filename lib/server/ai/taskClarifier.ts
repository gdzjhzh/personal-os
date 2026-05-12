import type {
  AiCandidateDecision,
  AiDecisionSignal,
  AiDecisionTrace,
  AiGuardrailApplied,
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
  DecisionContextPack,
  NeedClarification,
  NeedConfidence,
  TaskOwner,
  TaskPriority,
} from "@/lib/types";
import {
  createDeepSeekChatCompletion,
  DeepSeekRequestError,
  type DeepSeekReasoningEffort,
  MissingDeepSeekApiKeyError,
} from "@/lib/server/ai/deepseek";

type ClarifyTaskInput = {
  rawTask: string;
  project?: string;
  currentPhaseContext?: string;
  reasoningEffort?: DeepSeekReasoningEffort;
  contextPack?: DecisionContextPack;
  clarificationFeedback?: string;
  previousNeedClarification?: NeedClarification;
};

type ClarifyTaskSuccess = {
  needClarification: NeedClarification;
  decisionTrace: AiDecisionTrace;
  task: ClarifiedTaskDraft;
  rawOutput: string;
};

type SafetyRuleResult = {
  task: ClarifiedTaskDraft;
  guardrailsApplied: AiGuardrailApplied[];
};

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
const signalSourceTypes: AiDecisionSignal["sourceType"][] = [
  "rawInput",
  "operatingContext",
  "task",
  "review",
  "evidence",
  "productTeardown",
  "driftPattern",
];
const signalStrengths: AiDecisionSignal["strength"][] = [
  "weak",
  "medium",
  "strong",
];
const effortLevels: AiCandidateDecision["effortLevel"][] = [
  "small",
  "medium",
  "large",
];
const candidateDecisions: AiCandidateDecision["decision"][] = [
  "recommended",
  "alternative",
  "rejected",
];
const forbiddenSuggestions = [
  "RAG",
  "vector search",
  "database",
  "Docker",
  "crawler",
  "auth",
  "dashboard",
  "向量搜索",
  "数据库",
  "爬虫",
  "认证",
  "仪表盘",
];

export class TaskClarifierError extends Error {
  code: "missing_api_key" | "invalid_json" | "request_failed";
  rawOutput?: string;

  constructor(
    code: TaskClarifierError["code"],
    message: string,
    rawOutput?: string,
  ) {
    super(message);
    this.name = "TaskClarifierError";
    this.code = code;
    this.rawOutput = rawOutput;
  }
}

export async function clarifyTask(
  input: ClarifyTaskInput,
): Promise<ClarifyTaskSuccess> {
  try {
    const rawOutput = await createDeepSeekChatCompletion({
      reasoningEffort: input.reasoningEffort,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
    });

    return parseClarifierResult(rawOutput, input);
  } catch (error) {
    if (error instanceof TaskClarifierError) {
      throw error;
    }

    if (error instanceof MissingDeepSeekApiKeyError) {
      throw new TaskClarifierError(
        "missing_api_key",
        "未配置 DEEPSEEK_API_KEY，无法使用 AI 任务整理。",
      );
    }

    if (error instanceof DeepSeekRequestError) {
      if (error.status === 401 || error.status === 403) {
        throw new TaskClarifierError(
          "request_failed",
          "AI Key 已配置，但 DeepSeek 拒绝了请求。请确认这是有效的 DeepSeek 官方 API Key，且没有失效。",
        );
      }

      if (error.status === 402) {
        throw new TaskClarifierError(
          "request_failed",
          "DeepSeek 账户余额不足或额度不可用，请检查账户余额后重试。",
        );
      }

      if (error.status === 400) {
        throw new TaskClarifierError(
          "request_failed",
          `DeepSeek 拒绝了请求参数：${error.details || "请检查模型和整理等级配置。"}`,
        );
      }

      throw new TaskClarifierError(
        "request_failed",
        `AI 请求失败（DeepSeek ${error.status ?? "未知错误"}）：${
          error.details || "请检查网络、API Key 或模型配置。"
        }`,
      );
    }

    throw new TaskClarifierError(
      "request_failed",
      "AI 请求失败，请检查网络、API Key 或模型配置。",
    );
  }
}

function parseClarifierResult(
  rawOutput: string,
  input: ClarifyTaskInput = { rawTask: "" },
): ClarifyTaskSuccess {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch {
    throw new TaskClarifierError(
      "invalid_json",
      "AI 返回内容不是合法 JSON，请调整任务描述后重试。",
      rawOutput,
    );
  }

  if (!isRecord(parsed)) {
    throwInvalid(rawOutput);
  }

  if (!isRecord(parsed.needClarification) || !isRecord(parsed.task)) {
    throwInvalid(rawOutput);
  }

  const needClarification = readNeedClarification(
    parsed.needClarification,
    rawOutput,
  );
  const parsedTask = parseClarifiedTask(parsed.task, rawOutput, input);
  const safetyResult = applyDeterministicSafetyRules(
    parsedTask,
    input.rawTask,
  );
  const decisionTrace = mergeDecisionTraceGuardrails(
    readDecisionTraceOrFallback(
      parsed.decisionTrace,
      rawOutput,
      needClarification,
      safetyResult.task,
      input.contextPack,
    ),
    safetyResult.guardrailsApplied,
  );

  return {
    needClarification,
    decisionTrace,
    task: safetyResult.task,
    rawOutput,
  };
}

function parseClarifiedTask(
  value: unknown,
  rawOutput: string,
  input: ClarifyTaskInput,
) {
  if (!isRecord(value)) {
    throwInvalid(rawOutput);
  }

  const task: ClarifiedTaskDraft = {
    title: readString(value.title, rawOutput),
    project: readString(value.project, rawOutput) || normalizedProject(input),
    priority: readEnum(value.priority, priorities, rawOutput),
    status: readEnum(value.status, statuses, rawOutput),
    codexFit: readEnum(value.codexFit, codexFits, rawOutput),
    owner: readEnum(value.owner, owners, rawOutput),
    nextAction: readString(value.nextAction, rawOutput),
    doneWhen: readString(value.doneWhen, rawOutput),
    riskFlags: readStringArray(value.riskFlags, rawOutput),
    doNot: readStringArray(value.doNot, rawOutput),
    notes: readString(value.notes, rawOutput),
  };

  return task;
}

function buildSystemPrompt() {
  return `You are Personal OS's personal execution coach, not a generic Todo generator.
The user's long-term north star is: become an independent SaaS product creator and gradually build a second growth curve.
Your job is not to directly rewrite the input into task fields. You must first perform need extraction from the user's personal context, then generate one executable task.

Before generating the task, judge:
1. What the user truly wants to move forward.
2. What the user may be avoiding.
3. How this input relates to northStar and currentFocus.
4. Which recent tasks, reviews, evidence, product teardowns, or drift patterns support that judgment.
5. What the smallest real action for today is.

Return ONLY strict JSON. Do not include markdown, comments, code fences, or explanations.
Do not output chain-of-thought. decisionTrace must be a concise, auditable decision summary: evidence, candidate comparison, guardrails, and conclusion.

The JSON must match this exact structure:
{
  "needClarification": {
    "understoodInput": string,
    "inferredRealNeed": {
      "statement": string,
      "confidence": "low" | "medium" | "high",
      "evidence": string[]
    },
    "possibleAvoidance": {
      "pattern": string,
      "evidence": string[],
      "warning": string
    },
    "alignment": {
      "northStarFit": number,
      "currentFocusFit": number,
      "whyThisMatters": string
    },
    "contextUsed": {
      "operatingContext": string[],
      "tasks": string[],
      "reviews": string[],
      "evidence": string[],
      "productTeardowns": string[],
      "driftPatterns": string[]
    },
    "missingQuestions": string[],
    "candidateTasks": [
      {
        "title": string,
        "whyThisTask": string,
        "nextAction": string,
        "doneWhen": string,
        "riskFlags": string[],
        "recommended": boolean
      }
    ],
    "recommendation": string
  },
  "decisionTrace": {
    "decisionQuestion": string,
    "contextSummary": {
      "northStar": string,
      "currentFocus": string,
      "antiGoalsUsed": string[],
      "principlesUsed": string[],
      "contextStats": {
        "activeTaskCount": number,
        "recentReviewCount": number,
        "recentEvidenceCount": number,
        "recentProductTeardownCount": number,
        "recentDriftPatternCount": number
      }
    },
    "signals": [
      {
        "sourceType": "rawInput" | "operatingContext" | "task" | "review" | "evidence" | "productTeardown" | "driftPattern",
        "sourceId": string,
        "label": string,
        "quote": string,
        "interpretation": string,
        "strength": "weak" | "medium" | "strong"
      }
    ],
    "hypotheses": [
      {
        "statement": string,
        "confidence": "low" | "medium" | "high",
        "supportingSignals": string[],
        "uncertainty": string
      }
    ],
    "candidateComparison": [
      {
        "title": string,
        "whyConsidered": string,
        "northStarFit": number,
        "currentFocusFit": number,
        "evidencePotential": number,
        "avoidanceRisk": number,
        "effortLevel": "small" | "medium" | "large",
        "decision": "recommended" | "alternative" | "rejected",
        "reason": string
      }
    ],
    "guardrailsApplied": [
      {
        "rule": string,
        "triggeredBy": string,
        "effect": string
      }
    ],
    "finalDecision": {
      "selectedTitle": string,
      "whyThisNow": string,
      "whyNotOthers": string[],
      "smallestNextAction": string,
      "doneWhen": string
    },
    "discussionPrompts": string[]
  },
  "task": {
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
  }
}

Rules:
- Understand first, then generate the task.
- Do not give vague encouragement.
- Do not say empty things like "保持动力" or "持续努力".
- Every judgment must cite evidence from the input or DecisionContextPack.
- signals must quote concrete content from rawInput or DecisionContextPack.
- candidateComparison must contain at least 2 and at most 3 items.
- whyNotOthers must contain at least 1 and at most 3 items.
- discussionPrompts must contain at most 3 Chinese prompts that help the user correct your judgment.
- If a judgment is speculative, lower confidence and say it is a guess in warning or evidence.
- If context is insufficient, missingQuestions may contain at most 3 questions.
- If clarificationFeedback is provided, prioritize it when revising inferredRealNeed and finalDecision.
- If previousNeedClarification is provided, mention what changed from the previous interpretation in decisionTrace.hypotheses or discussionPrompts.
- Do not generate big empty tasks.
- nextAction must be an action that can be started within 25 minutes.
- doneWhen must be observable.
- Prefer tasks that produce shipping, product_judgment, technical_learning, or system_update evidence.
- Watch for 泛学习, 信息刷屏, 系统打磨成瘾, and self-deceptive progress.
- decisionTrace.guardrailsApplied should summarize likely guardrails, including deterministic risk/doNot rules that may be triggered. If none are clear, return [].
- Do not suggest database, RAG, vector search, Docker, crawler, auth, dashboard, or complex agents unless explicitly requested.
- task.notes must briefly explain why this task serves the real need.
- Prefer Chinese field values for user-facing fields.`;
}

function buildUserPrompt({
  rawTask,
  project,
  currentPhaseContext,
  contextPack,
  clarificationFeedback,
  previousNeedClarification,
}: ClarifyTaskInput) {
  return `Raw vague task:
${rawTask}

Project:
${project?.trim() || "Personal SaaS OS"}

Current phase context:
${
  currentPhaseContext?.trim() ||
  "Build the simplest local V0 and use it daily. Keep scope small."
}

DecisionContextPack:
${JSON.stringify(contextPack ?? null, null, 2)}

Clarification feedback from user:
${clarificationFeedback?.trim() || "None"}

Previous needClarification:
${JSON.stringify(previousNeedClarification ?? null, null, 2)}

Please first perform need extraction, then generate the strict JSON object.`;
}

function readNeedClarification(
  value: Record<string, unknown>,
  rawOutput: string,
): NeedClarification {
  const inferredRealNeed = readRecord(value.inferredRealNeed, rawOutput);
  const possibleAvoidance = readRecord(value.possibleAvoidance, rawOutput);
  const alignment = readRecord(value.alignment, rawOutput);
  const contextUsed = readRecord(value.contextUsed, rawOutput);

  return {
    understoodInput: readString(value.understoodInput, rawOutput),
    inferredRealNeed: {
      statement: readString(inferredRealNeed.statement, rawOutput),
      confidence: readConfidence(inferredRealNeed.confidence, rawOutput),
      evidence: readStringArray(inferredRealNeed.evidence, rawOutput),
    },
    possibleAvoidance: {
      pattern: readString(possibleAvoidance.pattern, rawOutput),
      evidence: readStringArray(possibleAvoidance.evidence, rawOutput),
      warning: readString(possibleAvoidance.warning, rawOutput),
    },
    alignment: {
      northStarFit: clampScore(readNumber(alignment.northStarFit, rawOutput)),
      currentFocusFit: clampScore(readNumber(alignment.currentFocusFit, rawOutput)),
      whyThisMatters: readString(alignment.whyThisMatters, rawOutput),
    },
    contextUsed: {
      operatingContext: readStringArray(contextUsed.operatingContext, rawOutput),
      tasks: readStringArray(contextUsed.tasks, rawOutput),
      reviews: readStringArray(contextUsed.reviews, rawOutput),
      evidence: readStringArray(contextUsed.evidence, rawOutput),
      productTeardowns: readStringArray(contextUsed.productTeardowns, rawOutput),
      driftPatterns: readStringArray(contextUsed.driftPatterns, rawOutput),
    },
    missingQuestions: readStringArray(value.missingQuestions, rawOutput).slice(
      0,
      3,
    ),
    candidateTasks: readCandidateTasks(value.candidateTasks, rawOutput),
    recommendation: readString(value.recommendation, rawOutput),
  };
}

function readCandidateTasks(
  value: unknown,
  rawOutput: string,
): NeedClarification["candidateTasks"] {
  if (!Array.isArray(value)) {
    throwInvalid(rawOutput);
  }

  const candidates = value.slice(0, 3).map((candidate) => {
    const record = readRecord(candidate, rawOutput);

    if (typeof record.recommended !== "boolean") {
      throwInvalid(rawOutput);
    }

    return {
      title: readString(record.title, rawOutput),
      whyThisTask: readString(record.whyThisTask, rawOutput),
      nextAction: readString(record.nextAction, rawOutput),
      doneWhen: readString(record.doneWhen, rawOutput),
      riskFlags: readStringArray(record.riskFlags, rawOutput),
      recommended: record.recommended,
    };
  });

  if (candidates.length === 0) {
    throwInvalid(rawOutput);
  }

  return candidates;
}

function readDecisionTrace(
  value: Record<string, unknown>,
  rawOutput: string,
): AiDecisionTrace {
  const contextSummary = readRecord(value.contextSummary, rawOutput);
  const finalDecision = readRecord(value.finalDecision, rawOutput);
  const whyNotOthers = readStringArray(
    finalDecision.whyNotOthers,
    rawOutput,
  ).slice(0, 3);

  if (whyNotOthers.length === 0) {
    throwInvalid(rawOutput);
  }

  return {
    decisionQuestion: readString(value.decisionQuestion, rawOutput),
    contextSummary: {
      northStar: readString(contextSummary.northStar, rawOutput),
      currentFocus: readString(contextSummary.currentFocus, rawOutput),
      antiGoalsUsed: readStringArray(contextSummary.antiGoalsUsed, rawOutput),
      principlesUsed: readStringArray(contextSummary.principlesUsed, rawOutput),
      contextStats: readContextStats(contextSummary.contextStats, rawOutput),
    },
    signals: readDecisionSignals(value.signals, rawOutput),
    hypotheses: readHypotheses(value.hypotheses, rawOutput),
    candidateComparison: readCandidateDecisions(
      value.candidateComparison,
      rawOutput,
    ),
    guardrailsApplied: readGuardrailsApplied(
      value.guardrailsApplied,
      rawOutput,
    ),
    finalDecision: {
      selectedTitle: readString(finalDecision.selectedTitle, rawOutput),
      whyThisNow: readString(finalDecision.whyThisNow, rawOutput),
      whyNotOthers,
      smallestNextAction: readString(
        finalDecision.smallestNextAction,
        rawOutput,
      ),
      doneWhen: readString(finalDecision.doneWhen, rawOutput),
    },
    discussionPrompts: readStringArray(value.discussionPrompts, rawOutput).slice(
      0,
      3,
    ),
  };
}

function readDecisionTraceOrFallback(
  value: unknown,
  rawOutput: string,
  needClarification: NeedClarification,
  task: ClarifiedTaskDraft,
  contextPack?: DecisionContextPack,
) {
  if (!isRecord(value)) {
    return buildFallbackDecisionTrace(needClarification, task, contextPack);
  }

  try {
    return readDecisionTrace(value, rawOutput);
  } catch (error) {
    if (
      error instanceof TaskClarifierError &&
      error.code === "invalid_json"
    ) {
      return buildFallbackDecisionTrace(needClarification, task, contextPack);
    }

    throw error;
  }
}

function buildFallbackDecisionTrace(
  needClarification: NeedClarification,
  task: ClarifiedTaskDraft,
  contextPack?: DecisionContextPack,
): AiDecisionTrace {
  const operatingContext = contextPack?.operatingContext;
  const candidateComparison = needClarification.candidateTasks.map(
    (candidate): AiCandidateDecision => ({
      title: candidate.title,
      whyConsidered: candidate.whyThisTask,
      northStarFit: needClarification.alignment.northStarFit,
      currentFocusFit: needClarification.alignment.currentFocusFit,
      evidencePotential: candidate.recommended ? 80 : 55,
      avoidanceRisk: candidate.riskFlags.length > 0 ? 60 : 25,
      effortLevel: candidate.riskFlags.includes("任务过大") ? "large" : "small",
      decision: candidate.recommended ? "recommended" : "alternative",
      reason: candidate.recommended
        ? "fallback 根据 needClarification 中的 recommended=true 选择。"
        : "fallback 保留为备选，等待用户进一步修正判断。",
    }),
  );
  const whyNotOthers = candidateComparison
    .filter((candidate) => candidate.title !== task.title)
    .map((candidate) => `${candidate.title}: ${candidate.reason}`)
    .slice(0, 3);

  return {
    decisionQuestion: "基于当前输入和上下文，今天应该生成什么任务？",
    contextSummary: {
      northStar: operatingContext?.northStar || "",
      currentFocus: operatingContext?.currentFocus || "",
      antiGoalsUsed: operatingContext?.antiGoals || [],
      principlesUsed: operatingContext?.principles || [],
      contextStats: contextPack?.contextStats || {
        activeTaskCount: 0,
        recentReviewCount: 0,
        recentEvidenceCount: 0,
        recentProductTeardownCount: 0,
        recentDriftPatternCount: 0,
      },
    },
    signals: [
      {
        sourceType: "rawInput",
        label: "原始输入",
        quote:
          contextPack?.rawInput ||
          needClarification.understoodInput ||
          task.title,
        interpretation: needClarification.inferredRealNeed.statement,
        strength: confidenceToSignalStrength(
          needClarification.inferredRealNeed.confidence,
        ),
      },
    ],
    hypotheses: [
      {
        statement: needClarification.inferredRealNeed.statement,
        confidence: needClarification.inferredRealNeed.confidence,
        supportingSignals: ["原始输入"],
        uncertainty:
          "模型未返回合法 decisionTrace，本段为系统 fallback 摘要。",
      },
    ],
    candidateComparison,
    guardrailsApplied: [],
    finalDecision: {
      selectedTitle: task.title,
      whyThisNow:
        needClarification.recommendation ||
        needClarification.alignment.whyThisMatters,
      whyNotOthers:
        whyNotOthers.length > 0
          ? whyNotOthers
          : ["模型未提供有效 decisionTrace，暂无法可靠比较其他候选任务。"],
      smallestNextAction: task.nextAction,
      doneWhen: task.doneWhen,
    },
    discussionPrompts: [
      "这个理解是否准确？如果不准确，请直接说明你真正想推进的目标。",
      "这个最小动作是否太大或太偏？如果是，请给出你希望收束的方向。",
    ],
  };
}

function confidenceToSignalStrength(
  confidence: NeedConfidence,
): AiDecisionSignal["strength"] {
  if (confidence === "high") {
    return "strong";
  }

  if (confidence === "medium") {
    return "medium";
  }

  return "weak";
}

function mergeDecisionTraceGuardrails(
  trace: AiDecisionTrace,
  guardrailsApplied: AiGuardrailApplied[],
): AiDecisionTrace {
  const merged = new Map<string, AiGuardrailApplied>();

  for (const guardrail of [
    ...trace.guardrailsApplied,
    ...guardrailsApplied,
  ]) {
    merged.set(`${guardrail.rule}-${guardrail.effect}`, guardrail);
  }

  return {
    ...trace,
    guardrailsApplied: [...merged.values()],
  };
}

function readDecisionSignals(
  value: unknown,
  rawOutput: string,
): AiDecisionSignal[] {
  if (!Array.isArray(value)) {
    throwInvalid(rawOutput);
  }

  return value.slice(0, 8).map((signal) => {
    const record = readRecord(signal, rawOutput);
    const sourceId = readOptionalString(record.sourceId, rawOutput);

    return {
      sourceType: readEnum(record.sourceType, signalSourceTypes, rawOutput),
      ...(sourceId ? { sourceId } : {}),
      label: readString(record.label, rawOutput),
      quote: readString(record.quote, rawOutput),
      interpretation: readString(record.interpretation, rawOutput),
      strength: readEnum(record.strength, signalStrengths, rawOutput),
    };
  });
}

function readHypotheses(
  value: unknown,
  rawOutput: string,
): AiDecisionTrace["hypotheses"] {
  if (!Array.isArray(value)) {
    throwInvalid(rawOutput);
  }

  return value.slice(0, 5).map((hypothesis) => {
    const record = readRecord(hypothesis, rawOutput);

    return {
      statement: readString(record.statement, rawOutput),
      confidence: readConfidence(record.confidence, rawOutput),
      supportingSignals: readStringArray(record.supportingSignals, rawOutput),
      uncertainty: readString(record.uncertainty, rawOutput),
    };
  });
}

function readCandidateDecisions(
  value: unknown,
  rawOutput: string,
): AiCandidateDecision[] {
  if (!Array.isArray(value)) {
    throwInvalid(rawOutput);
  }

  const candidates = value.slice(0, 3).map((candidate) => {
    const record = readRecord(candidate, rawOutput);

    return {
      title: readString(record.title, rawOutput),
      whyConsidered: readString(record.whyConsidered, rawOutput),
      northStarFit: clampScore(readNumber(record.northStarFit, rawOutput)),
      currentFocusFit: clampScore(readNumber(record.currentFocusFit, rawOutput)),
      evidencePotential: clampScore(
        readNumber(record.evidencePotential, rawOutput),
      ),
      avoidanceRisk: clampScore(readNumber(record.avoidanceRisk, rawOutput)),
      effortLevel: readEnum(record.effortLevel, effortLevels, rawOutput),
      decision: readEnum(record.decision, candidateDecisions, rawOutput),
      reason: readString(record.reason, rawOutput),
    };
  });

  if (candidates.length < 2) {
    throwInvalid(rawOutput);
  }

  return candidates;
}

function readGuardrailsApplied(
  value: unknown,
  rawOutput: string,
): AiGuardrailApplied[] {
  if (!Array.isArray(value)) {
    throwInvalid(rawOutput);
  }

  return value.slice(0, 8).map((guardrail) => {
    const record = readRecord(guardrail, rawOutput);

    return {
      rule: readString(record.rule, rawOutput),
      triggeredBy: readString(record.triggeredBy, rawOutput),
      effect: readString(record.effect, rawOutput),
    };
  });
}

function readContextStats(
  value: unknown,
  rawOutput: string,
): DecisionContextPack["contextStats"] {
  const stats = readRecord(value, rawOutput);

  return {
    activeTaskCount: clampCount(readNumber(stats.activeTaskCount, rawOutput)),
    recentReviewCount: clampCount(readNumber(stats.recentReviewCount, rawOutput)),
    recentEvidenceCount: clampCount(
      readNumber(stats.recentEvidenceCount, rawOutput),
    ),
    recentProductTeardownCount: clampCount(
      readNumber(stats.recentProductTeardownCount, rawOutput),
    ),
    recentDriftPatternCount: clampCount(
      readNumber(stats.recentDriftPatternCount, rawOutput),
    ),
  };
}

function applyDeterministicSafetyRules(
  task: ClarifiedTaskDraft,
  rawTask: string,
): SafetyRuleResult {
  const mergedText = [
    rawTask,
    task.title,
    task.nextAction,
    task.doneWhen,
    task.notes,
  ].join(" ");
  const riskFlags = new Set(task.riskFlags);
  const doNot = new Set(task.doNot);
  const guardrailsApplied: AiGuardrailApplied[] = [];

  if (/学习|研究|了解|看看|阅读|课程/.test(mergedText)) {
    riskFlags.add("泛学习");
    guardrailsApplied.push({
      rule: "泛学习风险",
      triggeredBy: "命中了 学习/研究/了解/看看/阅读/课程",
      effect: "riskFlags 追加 泛学习",
    });
  }

  if (/网站|产品|竞品|网页|浏览|刷|搜索|Google|YouTube|Twitter|X\b/i.test(mergedText)) {
    riskFlags.add("信息刷屏");
    doNot.add("不要无限浏览");
    guardrailsApplied.push({
      rule: "信息刷屏风险",
      triggeredBy:
        "命中了 网站/产品/竞品/网页/浏览/刷/搜索/Google/YouTube/Twitter/X",
      effect: "riskFlags 追加 信息刷屏；doNot 追加 不要无限浏览",
    });
  }

  if (/完整|全部|系统|平台|重构|做完|从零|上线|发布/.test(mergedText)) {
    riskFlags.add("任务过大");
    guardrailsApplied.push({
      rule: "任务过大风险",
      triggeredBy: "命中了 完整/全部/系统/平台/重构/做完/从零/上线/发布",
      effect: "riskFlags 追加 任务过大",
    });
  }

  if (/优化系统|重构系统|整理系统|配置|框架|架构|自动化|仪表盘/.test(mergedText)) {
    riskFlags.add("系统打磨风险");
    guardrailsApplied.push({
      rule: "系统打磨风险",
      triggeredBy: "命中了 优化系统/重构系统/整理系统/配置/框架/架构/自动化/仪表盘",
      effect: "riskFlags 追加 系统打磨风险",
    });
  }

  for (const item of forbiddenSuggestions) {
    doNot.add(`不要做 ${item}`);
  }

  return {
    task: {
      ...task,
      project: task.project || "Personal SaaS OS",
      riskFlags: [...riskFlags],
      doNot: [...doNot],
    },
    guardrailsApplied: [
      ...guardrailsApplied,
      {
        rule: "V0 禁止项",
        triggeredBy: "系统固定 forbiddenSuggestions 列表",
        effect:
          "doNot 确保包含 不要做 RAG/vector search/database/Docker/crawler/auth/dashboard/向量搜索/数据库/爬虫/认证/仪表盘",
      },
    ],
  };
}

function normalizedProject(input: ClarifyTaskInput) {
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

function readNumber(value: unknown, rawOutput: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwInvalid(rawOutput);
  }

  return value;
}

function readConfidence(value: unknown, rawOutput: string): NeedConfidence {
  return readEnum(value, ["low", "medium", "high"], rawOutput);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clampCount(value: number) {
  return Math.max(0, Math.floor(value));
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

function throwInvalid(rawOutput: string): never {
  throw new TaskClarifierError(
    "invalid_json",
    "AI 返回内容不是合法 JSON，请调整任务描述后重试。",
    rawOutput,
  );
}
