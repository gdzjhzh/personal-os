"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { DeepSeekReasoningEffort } from "@/lib/server/ai/deepseek";
import { clarifyTask, TaskClarifierError } from "@/lib/server/ai/taskClarifier";
import {
  createCodexRun,
  createEvidence,
  createTask,
  updateCodexRun,
  updateOperatingContext,
} from "@/lib/server/store";
import type {
  AiTaskClarifierState,
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
  CodexRunStatus,
  EvidenceType,
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
const codexRunStatuses: CodexRunStatus[] = [
  "queued",
  "running",
  "shipped",
  "blocked",
];
const evidenceTypes: EvidenceType[] = [
  "shipping",
  "product_judgment",
  "technical_learning",
  "system_update",
];

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
    const result = await clarifyTask({
      rawTask,
      project: String(formData.get("project") || "Personal SaaS OS"),
      currentPhaseContext: String(formData.get("currentPhaseContext") || ""),
      reasoningEffort: readReasoningEffort(formData),
    });

    return {
      status: "success",
      task: result.task,
      rawOutput: result.rawOutput,
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

export async function createCodexRunAction(formData: FormData) {
  const title = getFormValue(formData, "title").trim();

  if (!title) {
    return;
  }

  await createCodexRun({
    date: getFormValue(formData, "date") || getTodayDate(),
    taskId: getFormValue(formData, "taskId"),
    title,
    prompt: getFormValue(formData, "prompt"),
    expectedOutput: getFormValue(formData, "expectedOutput"),
    actualOutput: getFormValue(formData, "actualOutput"),
    status: parseCodexRunStatus(getFormValue(formData, "status")),
  });

  revalidatePath("/today");
  redirect("/today?created=codex-run");
}

export async function updateCodexRunStatusAction(formData: FormData) {
  const id = getFormValue(formData, "id");

  if (!id) {
    return;
  }

  await updateCodexRun(id, {
    status: parseCodexRunStatus(getFormValue(formData, "status")),
    actualOutput: getFormValue(formData, "actualOutput"),
  });

  revalidatePath("/today");
  redirect("/today?created=codex-run-updated");
}

export async function createEvidenceAction(formData: FormData) {
  const title = getFormValue(formData, "title").trim();

  if (!title) {
    return;
  }

  await createEvidence({
    date: getFormValue(formData, "date") || getTodayDate(),
    type: parseEvidenceType(getFormValue(formData, "type")),
    title,
    description: getFormValue(formData, "description"),
    artifactUrl: getFormValue(formData, "artifactUrl"),
    taskId: getFormValue(formData, "taskId"),
    codexRunId: getFormValue(formData, "codexRunId"),
  });

  revalidatePath("/today");
  redirect("/today?created=evidence");
}

export async function updateOperatingContextAction(formData: FormData) {
  await updateOperatingContext({
    northStar: getFormValue(formData, "northStar"),
    currentFocus: getFormValue(formData, "currentFocus"),
    activeConstraints: parseList(getFormValue(formData, "activeConstraints")),
    antiGoals: parseList(getFormValue(formData, "antiGoals")),
    principles: parseList(getFormValue(formData, "principles")),
  });

  revalidatePath("/today");
  redirect("/today?context=saved");
}

function parseCodexRunStatus(value: string): CodexRunStatus {
  const status = value as CodexRunStatus;

  return codexRunStatuses.includes(status) ? status : "queued";
}

function parseEvidenceType(value: string): EvidenceType {
  const type = value as EvidenceType;

  return evidenceTypes.includes(type) ? type : "shipping";
}

function parseList(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) || "");
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
