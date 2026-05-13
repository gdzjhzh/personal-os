import {
  createMonthlyGoal,
  readStore,
} from "@/lib/server/store";
import type {
  CreateMonthlyGoalInput,
  MonthlyGoalStatus,
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

export async function GET() {
  const store = await readStore();

  return Response.json({ monthlyGoals: store.monthlyGoals || [] });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const input = parseMonthlyGoalBody(body);

  if (!input.ok) {
    return badRequest(input.message);
  }

  const monthlyGoal = await createMonthlyGoal(input.value);

  return Response.json({ monthlyGoal }, { status: 201 });
}

function parseMonthlyGoalBody(
  value: unknown,
): { ok: true; value: CreateMonthlyGoalInput } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "请求内容必须是对象。" };
  }

  const month = readString(value.month);
  const title = readString(value.title);
  const why = readString(value.why);
  const successMetric = readString(value.successMetric);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, message: "month 必须形如 2026-05。" };
  }

  if (!title || !why || !successMetric) {
    return { ok: false, message: "month、title、why、successMetric 为必填。" };
  }

  const status = readEnum(value.status, goalStatuses) || "active";

  return {
    ok: true,
    value: {
      month,
      title,
      why,
      successMetric,
      targetEvidence: readStringArray(value.targetEvidence),
      weeklyMilestones: readWeeklyMilestones(value.weeklyMilestones),
      constraints: readStringArray(value.constraints),
      antiGoals: readStringArray(value.antiGoals),
      status,
    },
  };
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

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
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
