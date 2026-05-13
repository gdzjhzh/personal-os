import {
  createLearningLog,
  readStore,
} from "@/lib/server/store";
import type { CreateLearningLogInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = readLimit(searchParams.get("limit"), 20);
  const store = await readStore();
  const learningLogs = [...(store.learningLogs || [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return Response.json({ learningLogs });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const input = parseLearningLogBody(body);

  if (!input.ok) {
    return Response.json({ error: input.message }, { status: 400 });
  }

  const learningLog = await createLearningLog(input.value);

  return Response.json({ learningLog }, { status: 201 });
}

function parseLearningLogBody(
  value: unknown,
): { ok: true; value: CreateLearningLogInput } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "请求内容必须是对象。" };
  }

  const date = readString(value.date);
  const title = readString(value.title);
  const summary = readString(value.summary);
  const insight = readString(value.insight);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "date 必须形如 2026-05-13。" };
  }

  if (!title || !summary || !insight) {
    return { ok: false, message: "date、title、summary、insight 为必填。" };
  }

  return {
    ok: true,
    value: {
      date,
      title,
      summary,
      insight,
      source: readString(value.source) || undefined,
      relatedTaskId: readString(value.relatedTaskId) || undefined,
      relatedGoalId: readString(value.relatedGoalId) || undefined,
      tags: readStringArray(value.tags),
    },
  };
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function readLimit(value: string | null, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
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
