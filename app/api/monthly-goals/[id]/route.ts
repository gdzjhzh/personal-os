import {
  archiveMonthlyGoal,
  updateMonthlyGoal,
} from "@/lib/server/store";
import type {
  MonthlyGoalStatus,
  UpdateMonthlyGoalPatch,
  WeeklyMilestoneStatus,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const goalStatuses: MonthlyGoalStatus[] = [
  "active",
  "done",
  "paused",
  "archived",
];
const milestoneStatuses: WeeklyMilestoneStatus[] = [
  "planned",
  "active",
  "done",
  "skipped",
];

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJson(request);
  const patch = parsePatch(body);

  if (!patch.ok) {
    return Response.json({ error: patch.message }, { status: 400 });
  }

  try {
    const monthlyGoal = await updateMonthlyGoal(id, patch.value);
    return Response.json({ monthlyGoal });
  } catch {
    return Response.json({ error: "月目标不存在。" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const monthlyGoal = await archiveMonthlyGoal(id);
    return Response.json({ monthlyGoal });
  } catch {
    return Response.json({ error: "月目标不存在。" }, { status: 404 });
  }
}

function parsePatch(
  value: unknown,
): { ok: true; value: UpdateMonthlyGoalPatch } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "请求内容必须是对象。" };
  }

  const patch: UpdateMonthlyGoalPatch = {};

  if ("month" in value) {
    const month = readString(value.month);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { ok: false, message: "month 必须形如 2026-05。" };
    }

    patch.month = month;
  }

  for (const key of ["title", "why", "successMetric"] as const) {
    if (key in value) {
      const text = readString(value[key]);

      if (!text) {
        return { ok: false, message: `${key} 不能为空。` };
      }

      patch[key] = text;
    }
  }

  if ("targetEvidence" in value) {
    patch.targetEvidence = readStringArray(value.targetEvidence);
  }

  if ("constraints" in value) {
    patch.constraints = readStringArray(value.constraints);
  }

  if ("antiGoals" in value) {
    patch.antiGoals = readStringArray(value.antiGoals);
  }

  if ("weeklyMilestones" in value) {
    patch.weeklyMilestones = readWeeklyMilestones(value.weeklyMilestones);
  }

  if ("status" in value) {
    const status = readEnum(value.status, goalStatuses);

    if (!status) {
      return { ok: false, message: "status 不合法。" };
    }

    patch.status = status;
  }

  return { ok: true, value: patch };
}

function readWeeklyMilestones(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      id: readString(item.id) || crypto.randomUUID(),
      week: readString(item.week),
      outcome: readString(item.outcome),
      mustShip: readString(item.mustShip),
      evidence: readStringArray(item.evidence),
      status: readEnum(item.status, milestoneStatuses) || "planned",
    }))
    .filter((item) => item.week && item.outcome);
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null;
}
