"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DeepSeekReasoningEffort } from "@/lib/server/ai/deepseek";
import { buildDecisionContextPack } from "@/lib/server/ai/decisionContext";
import { clarifyTask, TaskClarifierError } from "@/lib/server/ai/taskClarifier";
import { createTask, readStore } from "@/lib/server/store";
import type {
  AiTaskClarifierState,
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
  NeedClarification,
  TaskOwner,
  TaskPriority,
  TaskQuadrant,
} from "@/lib/types";

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

export async function clarifyTaskAction(
  _prevState: AiTaskClarifierState,
  formData: FormData,
): Promise<AiTaskClarifierState> {
  const rawTask = String(formData.get("rawTask") || "").trim();
  const requestId = createAiTaskRequestId();
  const startedAt = Date.now();

  if (!rawTask) {
    return {
      status: "error",
      message: "请先输入一个模糊任务。",
    };
  }

  const project = String(formData.get("project") || "Personal SaaS OS");
  const currentPhaseContext = String(
    formData.get("currentPhaseContext") || "",
  );
  const reasoningEffort = readReasoningEffort(formData);
  const clarificationFeedback = String(
    formData.get("clarificationFeedback") || "",
  ).trim();
  const previousNeedClarification = parsePreviousNeedClarification(
    String(formData.get("previousNeedClarificationJson") || ""),
  );

  try {
    const store = await readStore();
    const contextPack = buildDecisionContextPack(rawTask, store);

    console.info("[ai.taskClarifier] action:start", {
      requestId,
      rawTaskChars: rawTask.length,
      project,
      reasoningEffort,
      hasCurrentPhaseContext: Boolean(currentPhaseContext.trim()),
      hasClarificationFeedback: Boolean(clarificationFeedback),
      hasPreviousClarification: Boolean(previousNeedClarification),
      contextStats: contextPack.contextStats,
    });

    const result = await withTimeout(
      clarifyTask({
        rawTask,
        project,
        currentPhaseContext,
        reasoningEffort,
        requestId,
        contextPack,
        clarificationFeedback,
        previousNeedClarification,
      }),
      28000,
      () =>
        new TaskClarifierError(
          "request_failed",
          "这次判断偏重，建议先用更小的问题和 AI 讨论，或直接手动新增一个最小任务。",
        ),
    );

    console.info("[ai.taskClarifier] action:success", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      selectedTitle: result.task.title,
      rawOutputChars: result.rawOutput.length,
    });

    return {
      status: "success",
      needClarification: result.needClarification,
      decisionTrace: result.decisionTrace,
      task: result.task,
      rawOutput: result.rawOutput,
      contextStats: contextPack.contextStats,
    };
  } catch (error) {
    if (isTaskClarifierError(error)) {
      console.warn("[ai.taskClarifier] action:error", {
        requestId,
        elapsedMs: Date.now() - startedAt,
        code: error.code,
        message: error.message,
        rawOutputChars: error.rawOutput?.length || 0,
      });

      return {
        status: "error",
        message: error.message,
        rawOutput: error.rawOutput,
      };
    }

    console.error("[ai.taskClarifier] action:unknown_error", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      error: describeError(error),
    });

    return {
      status: "error",
      message: "AI 请求失败，请检查网络、API Key 或模型配置。",
    };
  }
}

function parsePreviousNeedClarification(value: string): NeedClarification | undefined {
  if (!value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<NeedClarification>;

    if (
      typeof parsed.understoodInput !== "string" ||
      typeof parsed.recommendation !== "string" ||
      typeof parsed.inferredRealNeed !== "object" ||
      parsed.inferredRealNeed === null
    ) {
      return undefined;
    }

    return parsed as NeedClarification;
  } catch {
    return undefined;
  }
}

function isTaskClarifierError(error: unknown): error is TaskClarifierError {
  if (error instanceof TaskClarifierError) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };

  return (
    typeof candidate.message === "string" &&
    (candidate.code === "missing_api_key" ||
      candidate.code === "invalid_json" ||
      candidate.code === "request_failed")
  );
}

function readReasoningEffort(formData: FormData): DeepSeekReasoningEffort {
  return formData.get("reasoningEffort") === "max" ? "max" : "high";
}

function createAiTaskRequestId() {
  return `clarify_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(createError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function inferQuadrantFromPriorityAndRiskFlags(
  priority: TaskPriority,
  riskFlags: string[],
): TaskQuadrant {
  const hasLowValueRisk = riskFlags.some(
    (flag) => flag.includes("泛学习") || flag.includes("信息刷屏"),
  );

  if (hasLowValueRisk) {
    return "not_urgent_not_important";
  }

  return priority === "P0" ? "important_urgent" : "important_not_urgent";
}

export async function saveClarifiedTaskAction(formData: FormData) {
  const taskJson = String(formData.get("taskJson") || "");
  const task = parseClarifiedTaskDraft(taskJson);

  if (!task) {
    redirect("/today?view=new-task&created=ai-error");
  }

  await createTask({
    title: task.title,
    project: task.project,
    priority: task.priority,
    status: task.status,
    codexFit: task.codexFit,
    owner: task.owner,
    nextAction: task.nextAction,
    doneWhen: task.doneWhen,
    riskFlags: task.riskFlags,
    doNot: task.doNot,
    notes: task.notes,
    plannedFor: getTodayDate(),
    quadrant: inferQuadrantFromPriorityAndRiskFlags(
      task.priority,
      task.riskFlags,
    ),
  });

  revalidatePath("/today");
  redirect("/today?view=tasks&created=ai-task");
}

export async function saveGateTaskAction(formData: FormData) {
  const taskJson = String(formData.get("taskJson") || "");
  const parsedTask = parseClarifiedTaskDraft(taskJson);

  if (!parsedTask) {
    redirect("/today?view=new-task&created=ai-error");
  }

  const isForceMode = formData.get("forceMode") === "true";
  const planForToday = formData.get("planForToday") === "true";
  const task = isForceMode
    ? enforceForcedGateTask(parsedTask)
    : parsedTask;

  await createTask({
    title: task.title,
    project: task.project,
    priority: task.priority,
    status: task.status,
    codexFit: task.codexFit,
    owner: task.owner,
    nextAction: task.nextAction,
    doneWhen: task.doneWhen,
    riskFlags: task.riskFlags,
    doNot: task.doNot,
    notes: task.notes,
    plannedFor: planForToday ? getTodayDate() : undefined,
    quadrant: planForToday
      ? inferQuadrantFromPriorityAndRiskFlags(task.priority, task.riskFlags)
      : undefined,
  });

  revalidatePath("/today");
  redirect("/today?view=tasks&created=ai-task");
}

function enforceForcedGateTask(task: ClarifiedTaskDraft): ClarifiedTaskDraft {
  const riskFlags = [
    ...new Set([
      ...task.riskFlags.map((flag) => flag.trim()).filter(Boolean),
      task.riskFlags.length > 0 ? "" : "信息不足仍强制执行",
    ]),
  ].filter(Boolean);
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

function parseClarifiedTaskDraft(value: string): ClarifiedTaskDraft | null {
  try {
    const parsed = JSON.parse(value) as Partial<ClarifiedTaskDraft>;

    if (
      typeof parsed.title !== "string" ||
      typeof parsed.project !== "string" ||
      !isAllowed(parsed.priority, priorities) ||
      !isAllowed(parsed.status, statuses) ||
      !isAllowed(parsed.codexFit, codexFits) ||
      !isAllowed(parsed.owner, owners) ||
      typeof parsed.nextAction !== "string" ||
      typeof parsed.doneWhen !== "string" ||
      !isStringArray(parsed.riskFlags) ||
      !isStringArray(parsed.doNot) ||
      typeof parsed.notes !== "string"
    ) {
      return null;
    }

    return {
      title: parsed.title,
      project: parsed.project,
      priority: parsed.priority,
      status: parsed.status,
      codexFit: parsed.codexFit,
      owner: parsed.owner,
      nextAction: parsed.nextAction,
      doneWhen: parsed.doneWhen,
      riskFlags: parsed.riskFlags,
      doNot: parsed.doNot,
      notes: parsed.notes,
    };
  } catch {
    return null;
  }
}

function isAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getTodayDate() {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
