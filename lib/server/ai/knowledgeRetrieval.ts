import type {
  AiDailyReview,
  DailyReview,
  MonthlyGoal,
  ProductTeardown,
  Store,
  Task,
} from "@/lib/types";

export type CoachKnowledgeSnippet = {
  sourceType:
    | "knowledgeCard"
    | "learningLog"
    | "evidence"
    | "review"
    | "aiDailyReview"
    | "productTeardown";
  id: string;
  title: string;
  quote?: string;
  summary: string;
  relevanceReason: string;
  relatedTaskId?: string;
  relatedGoalId?: string;
};

type Candidate = Omit<CoachKnowledgeSnippet, "relevanceReason"> & {
  body: string;
  tags: string[];
  createdAt: string;
  date?: string;
};

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "why",
  "how",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "我",
  "你",
  "他",
  "她",
  "它",
  "我们",
  "这个",
  "那个",
  "什么",
  "一下",
  "帮我",
  "今天",
  "最近",
  "如何",
  "怎么",
]);

export function retrieveRelevantKnowledgeSnippets(params: {
  store: Store;
  query: string;
  limit?: number;
}): CoachKnowledgeSnippet[] {
  const limit = clampLimit(params.limit);
  const store = params.store;
  const queryTokens = tokenize(params.query);
  const activeTaskIds = new Set(
    (store.tasks || [])
      .filter((task) => isActiveTask(task))
      .map((task) => task.id),
  );
  const currentGoal = pickCurrentMonthlyGoal(store.monthlyGoals || []);
  const candidates = buildCandidates(store);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, queryTokens, activeTaskIds, currentGoal),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return getTime(b.candidate) - getTime(a.candidate);
    });

  if (scored.length > 0) {
    return scored.slice(0, limit).map(({ candidate, score }) =>
      stripCandidate(candidate, buildReason(candidate, score, queryTokens)),
    );
  }

  return candidates
    .sort((a, b) => getTime(b) - getTime(a))
    .slice(0, limit)
    .map((candidate) =>
      stripCandidate(candidate, "最近记录，非强关键词命中，可作为弱相关上下文。"),
    );
}

function buildCandidates(store: Store): Candidate[] {
  const candidates: Candidate[] = [];

  for (const card of store.knowledgeCards || []) {
    candidates.push({
      sourceType: "knowledgeCard",
      id: card.id,
      title: truncate(card.title, 120),
      quote: truncate(card.body, 220),
      summary: truncate(card.body, 360),
      body: card.body,
      tags: card.tags,
      relatedTaskId: card.relatedTaskId,
      relatedGoalId: card.relatedGoalId,
      createdAt: card.updatedAt || card.createdAt,
    });
  }

  for (const log of store.learningLogs || []) {
    candidates.push({
      sourceType: "learningLog",
      id: log.id,
      title: truncate(log.title, 120),
      quote: truncate(log.insight || log.summary, 220),
      summary: truncate([log.summary, log.insight].filter(Boolean).join("；"), 360),
      body: [log.summary, log.insight, log.source].filter(Boolean).join(" "),
      tags: log.tags,
      relatedTaskId: log.relatedTaskId,
      relatedGoalId: log.relatedGoalId,
      createdAt: log.updatedAt || log.createdAt,
      date: log.date,
    });
  }

  for (const item of store.evidence || []) {
    candidates.push({
      sourceType: "evidence",
      id: item.id,
      title: truncate(item.title, 120),
      quote: truncate(item.description, 220),
      summary: truncate(item.description, 360),
      body: [item.type, item.title, item.description, item.artifactUrl]
        .filter(Boolean)
        .join(" "),
      tags: [item.type],
      relatedTaskId: item.taskId,
      createdAt: item.updatedAt || item.createdAt,
      date: item.date,
    });
  }

  for (const review of store.reviews || []) {
    candidates.push(reviewCandidate(review));
  }

  for (const review of store.aiDailyReviews || []) {
    candidates.push(aiDailyReviewCandidate(review));
  }

  for (const teardown of store.productTeardowns || []) {
    candidates.push(productTeardownCandidate(teardown));
  }

  return candidates.filter((candidate) => candidate.title || candidate.summary);
}

function reviewCandidate(review: DailyReview): Candidate {
  const summary = [
    review.actualOutput ? `真实产出：${review.actualOutput}` : "",
    review.tomorrowP0 ? `明日 P0：${review.tomorrowP0}` : "",
    review.notes,
  ]
    .filter(Boolean)
    .join("；");

  return {
    sourceType: "review",
    id: `${review.date}-${review.createdAt}`,
    title: `${review.date} 手动复盘`,
    quote: truncate(review.actualOutput || review.notes, 220),
    summary: truncate(summary, 360),
    body: [
      review.plannedP0,
      review.actualOutput,
      review.fakeProgress,
      review.tomorrowP0,
      review.notes,
      ...(review.driftFlags || []),
    ]
      .filter(Boolean)
      .join(" "),
    tags: review.driftFlags || [],
    createdAt: review.createdAt,
    date: review.date,
  };
}

function aiDailyReviewCandidate(review: AiDailyReview): Candidate {
  const summary = [
    review.summary,
    review.realOutput ? `真实产出：${review.realOutput}` : "",
    review.nextDaySuggestion ? `明日建议：${review.nextDaySuggestion}` : "",
  ]
    .filter(Boolean)
    .join("；");

  return {
    sourceType: "aiDailyReview",
    id: review.id,
    title: `${review.date} AI 日复盘`,
    quote: truncate(review.summary || review.realOutput, 220),
    summary: truncate(summary, 360),
    body: [
      review.summary,
      review.realOutput,
      review.fakeProgress,
      review.productThinkingProgress,
      review.executionProgress,
      review.technicalProgress,
      review.nextDaySuggestion,
      ...(review.growthSignals || []),
      ...(review.driftWarnings || []),
    ]
      .filter(Boolean)
      .join(" "),
    tags: [...(review.growthSignals || []), ...(review.driftWarnings || [])],
    createdAt: review.createdAt,
    date: review.date,
  };
}

function productTeardownCandidate(teardown: ProductTeardown): Candidate {
  const summary = [
    teardown.problem ? `问题：${teardown.problem}` : "",
    teardown.whatILearned ? `学到：${teardown.whatILearned}` : "",
    teardown.alternativeApproach ? `可借鉴：${teardown.alternativeApproach}` : "",
  ]
    .filter(Boolean)
    .join("；");

  return {
    sourceType: "productTeardown",
    id: teardown.id,
    title: `${teardown.productName} 产品拆解`,
    quote: truncate(teardown.whatILearned || teardown.problem, 220),
    summary: truncate(summary, 360),
    body: [
      teardown.productName,
      teardown.problem,
      teardown.targetUser,
      teardown.whyUsersNeedIt,
      teardown.revenueSignal,
      teardown.whatILearned,
      teardown.hardPart,
      teardown.alternativeApproach,
      teardown.canIBuildIt,
      teardown.coldStartStrategy,
      teardown.notes,
    ]
      .filter(Boolean)
      .join(" "),
    tags: [teardown.source],
    createdAt: teardown.updatedAt || teardown.createdAt,
    date: teardown.date,
  };
}

function scoreCandidate(
  candidate: Candidate,
  queryTokens: Set<string>,
  activeTaskIds: Set<string>,
  currentGoal: MonthlyGoal | null,
) {
  const keywordScore =
    fieldScore(candidate.title, queryTokens, 8) +
    fieldScore(candidate.tags.join(" "), queryTokens, 8) +
    fieldScore(candidate.body, queryTokens, 3);
  let score = keywordScore;

  if (queryTokens.size === 0) {
    score += 0.1;
  }

  if (candidate.relatedTaskId && activeTaskIds.has(candidate.relatedTaskId)) {
    score += 6;
  }

  if (
    currentGoal &&
    (candidate.relatedGoalId === currentGoal.id ||
      textIncludes(candidate.body, currentGoal.title))
  ) {
    score += 6;
  }

  if ((score > 0 || queryTokens.size === 0) && isWithinDays(candidate.createdAt || candidate.date, 30)) {
    score += 1.5;
  }

  return score;
}

function fieldScore(text: string, queryTokens: Set<string>, weight: number) {
  if (!text || queryTokens.size === 0) {
    return 0;
  }

  const fieldTokens = tokenize(text);
  let hits = 0;

  for (const token of queryTokens) {
    if (fieldTokens.has(token) || text.toLowerCase().includes(token)) {
      hits += 1;
    }
  }

  return hits * weight;
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    addToken(tokens, match[0]);
  }

  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const value = match[0];

    addToken(tokens, value);

    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= value.length - size; index += 1) {
        addToken(tokens, value.slice(index, index + size));
      }
    }
  }

  return tokens;
}

function addToken(tokens: Set<string>, token: string) {
  const normalized = token.trim().toLowerCase();

  if (!normalized || stopWords.has(normalized) || normalized.length < 2) {
    return;
  }

  tokens.add(normalized);
}

function buildReason(candidate: Candidate, score: number, queryTokens: Set<string>) {
  const matchedTokens = [...queryTokens]
    .filter((token) =>
      [candidate.title, candidate.tags.join(" "), candidate.body]
        .join(" ")
        .toLowerCase()
        .includes(token),
    )
    .slice(0, 4);

  if (matchedTokens.length === 0) {
    return `与当前上下文弱相关，按最近性补充；相关分 ${score.toFixed(1)}。`;
  }

  return `命中关键词：${matchedTokens.join("、")}；相关分 ${score.toFixed(1)}。`;
}

function stripCandidate(
  candidate: Candidate,
  relevanceReason: string,
): CoachKnowledgeSnippet {
  return {
    sourceType: candidate.sourceType,
    id: candidate.id,
    title: candidate.title,
    quote: candidate.quote,
    summary: candidate.summary,
    relevanceReason,
    relatedTaskId: candidate.relatedTaskId,
    relatedGoalId: candidate.relatedGoalId,
  };
}

function pickCurrentMonthlyGoal(goals: MonthlyGoal[]) {
  const currentMonth = getCurrentMonth();
  const current = goals.find(
    (goal) => goal.month === currentMonth && goal.status === "active",
  );

  if (current) {
    return current;
  }

  return [...goals]
    .filter((goal) => goal.status === "active")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function isActiveTask(task: Task) {
  return [
    "inbox",
    "active",
    "codex_ready",
    "codex_running",
    "review",
    "waiting",
    "frozen",
  ].includes(task.status);
}

function getTime(candidate: Pick<Candidate, "createdAt" | "date">) {
  const date = new Date(candidate.createdAt || candidate.date || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isWithinDays(value: string | undefined, days: number) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function textIncludes(text: string, value: string) {
  return Boolean(value && text.toLowerCase().includes(value.toLowerCase()));
}

function clampLimit(limit?: number) {
  if (!limit || !Number.isFinite(limit)) {
    return 8;
  }

  return Math.max(1, Math.min(20, Math.floor(limit)));
}

function truncate(value: string | undefined, max = 400) {
  const text = (value || "").trim();

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1)}…`;
}
