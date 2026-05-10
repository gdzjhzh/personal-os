import type {
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
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
};

type ClarifyTaskSuccess = {
  task: ClarifiedTaskDraft;
  rawOutput: string;
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

    return {
      task: parseClarifiedTask(rawOutput, input),
      rawOutput,
    };
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

      throw new TaskClarifierError(
        "request_failed",
        "AI 请求失败，请检查网络、API Key 或模型配置。",
      );
    }

    throw new TaskClarifierError(
      "request_failed",
      "AI 请求失败，请检查网络、API Key 或模型配置。",
    );
  }
}

export function parseClarifiedTask(
  rawOutput: string,
  input: ClarifyTaskInput = { rawTask: "" },
) {
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

  const task: ClarifiedTaskDraft = {
    title: readString(parsed.title, rawOutput),
    project: readString(parsed.project, rawOutput) || normalizedProject(input),
    priority: readEnum(parsed.priority, priorities, rawOutput),
    status: readEnum(parsed.status, statuses, rawOutput),
    codexFit: readEnum(parsed.codexFit, codexFits, rawOutput),
    owner: readEnum(parsed.owner, owners, rawOutput),
    nextAction: readString(parsed.nextAction, rawOutput),
    doneWhen: readString(parsed.doneWhen, rawOutput),
    riskFlags: readStringArray(parsed.riskFlags, rawOutput),
    doNot: readStringArray(parsed.doNot, rawOutput),
    notes: readString(parsed.notes, rawOutput),
  };

  return applyDeterministicSafetyRules(task, input.rawTask);
}

function buildSystemPrompt() {
  return `You are an AI Task Clarifier for Personal SaaS OS.

The user wants to become an independent SaaS product creator. Current phase: make Personal SaaS OS a daily-used task planning and review system. The system should reduce drifting, vague learning, information browsing, and self-deception. Tasks must be converted into concrete next actions and observable outputs.

Return ONLY strict JSON. Do not include markdown, comments, code fences, or explanations.

The JSON must match this exact structure:
{
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

Rules:
- The task must become concrete.
- nextAction must be a 25-minute action.
- doneWhen must be observable.
- If the task is vague learning, add riskFlags: ["泛学习"].
- If the task involves browsing products or websites, add riskFlags: ["信息刷屏"].
- If the task is too large, add riskFlags: ["任务过大"].
- If it is suitable for Codex, codexFit should be high or medium.
- If it requires human judgment, owner should be human or mixed.
- Never suggest RAG, vector search, database, Docker, crawler, auth, or dashboard unless explicitly asked.
- Prefer Chinese field values for title, nextAction, doneWhen, riskFlags, doNot, and notes.`;
}

function buildUserPrompt({
  rawTask,
  project,
  currentPhaseContext,
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

Clarify this into the strict JSON task object.`;
}

function applyDeterministicSafetyRules(
  task: ClarifiedTaskDraft,
  rawTask: string,
) {
  const mergedText = [
    rawTask,
    task.title,
    task.nextAction,
    task.doneWhen,
    task.notes,
  ].join(" ");
  const riskFlags = new Set(task.riskFlags);
  const doNot = new Set(task.doNot);

  if (/学习|研究|了解|看看|阅读|课程/.test(mergedText)) {
    riskFlags.add("泛学习");
  }

  if (/网站|产品|竞品|网页|浏览|刷|搜索|Google|YouTube|Twitter|X\b/i.test(mergedText)) {
    riskFlags.add("信息刷屏");
  }

  if (/完整|全部|系统|平台|重构|做完|从零|上线|发布/.test(mergedText)) {
    riskFlags.add("任务过大");
  }

  for (const item of forbiddenSuggestions) {
    doNot.add(`不要做 ${item}`);
  }

  return {
    ...task,
    project: task.project || "Personal SaaS OS",
    riskFlags: [...riskFlags],
    doNot: [...doNot],
  };
}

function normalizedProject(input: ClarifyTaskInput) {
  return input.project?.trim() || "Personal SaaS OS";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, rawOutput: string) {
  if (typeof value !== "string") {
    throwInvalid(rawOutput);
  }

  return value.trim();
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

function throwInvalid(rawOutput: string): never {
  throw new TaskClarifierError(
    "invalid_json",
    "AI 返回内容不是合法 JSON，请调整任务描述后重试。",
    rawOutput,
  );
}
