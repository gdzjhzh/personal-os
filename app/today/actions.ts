"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clarifyTask, TaskClarifierError } from "@/lib/server/ai/taskClarifier";
import { createTask } from "@/lib/server/store";
import type {
  AiTaskClarifierState,
  ClarifiedTaskDraft,
  ClarifiedTaskStatus,
  CodexFit,
  TaskOwner,
  TaskPriority,
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
    const result = await clarifyTask({
      rawTask,
      project: String(formData.get("project") || "Personal SaaS OS"),
      currentPhaseContext: String(formData.get("currentPhaseContext") || ""),
    });

    return {
      status: "success",
      task: result.task,
      rawOutput: result.rawOutput,
    };
  } catch (error) {
    if (error instanceof TaskClarifierError) {
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

export async function saveClarifiedTaskAction(formData: FormData) {
  const taskJson = String(formData.get("taskJson") || "");
  const task = parseClarifiedTaskDraft(taskJson);

  if (!task) {
    redirect("/today?created=ai-error");
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
  });

  revalidatePath("/today");
  redirect("/today?created=ai-task");
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
