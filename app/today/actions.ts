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

  if (!rawTask) {
    return {
      status: "error",
      message: "请先输入一个模糊任务。",
    };
  }

  try {
    const store = await readStore();
    const contextPack = buildDecisionContextPack(rawTask, store);
    const project = String(formData.get("project") || "Personal SaaS OS");
    const currentPhaseContext = String(
      formData.get("currentPhaseContext") || "",
    );
    const reasoningEffort = readReasoningEffort(formData);
    const result = await clarifyTask({
      rawTask,
      project,
      currentPhaseContext,
      reasoningEffort,
      contextPack,
      clarificationFeedback: String(
        formData.get("clarificationFeedback") || "",
      ).trim(),
      previousNeedClarification: parsePreviousNeedClarification(
        String(formData.get("previousNeedClarificationJson") || ""),
      ),
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
      return {
        status: "error",
        message: error.message,
        rawOutput: error.rawOutput,
      };
    }

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
