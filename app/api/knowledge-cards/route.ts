import {
  createKnowledgeCard,
  readStore,
} from "@/lib/server/store";
import type { CreateKnowledgeCardInput, KnowledgeCard } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  const limit = readLimit(searchParams.get("limit"), 20);
  const store = await readStore();
  const cards = store.knowledgeCards || [];
  const knowledgeCards = query
    ? rankCards(cards, query).slice(0, limit)
    : [...cards]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);

  return Response.json({ knowledgeCards });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const input = parseKnowledgeCardBody(body);

  if (!input.ok) {
    return Response.json({ error: input.message }, { status: 400 });
  }

  const knowledgeCard = await createKnowledgeCard(input.value);

  return Response.json({ knowledgeCard }, { status: 201 });
}

function parseKnowledgeCardBody(
  value: unknown,
): { ok: true; value: CreateKnowledgeCardInput } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "请求内容必须是对象。" };
  }

  const title = readString(value.title);
  const body = readString(value.body);

  if (!title || !body) {
    return { ok: false, message: "title、body 为必填。" };
  }

  return {
    ok: true,
    value: {
      title,
      body,
      tags: readStringArray(value.tags),
      source: readString(value.source) || undefined,
      relatedTaskId: readString(value.relatedTaskId) || undefined,
      relatedGoalId: readString(value.relatedGoalId) || undefined,
    },
  };
}

function rankCards(cards: KnowledgeCard[], query: string) {
  const tokens = tokenize(query);

  return [...cards]
    .map((card) => ({
      card,
      score:
        scoreText(card.title, tokens, 8) +
        scoreText(card.tags.join(" "), tokens, 8) +
        scoreText(card.body, tokens, 3),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return b.card.updatedAt.localeCompare(a.card.updatedAt);
    })
    .map((item) => item.card);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[\s,，。；;、]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function scoreText(text: string, tokens: string[], weight: number) {
  const normalized = text.toLowerCase();
  return tokens.filter((token) => normalized.includes(token)).length * weight;
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
