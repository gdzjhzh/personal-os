import { buildDecisionContextPack } from "@/lib/server/ai/decisionContext";
import {
  retrieveRelevantKnowledgeSnippets,
  type CoachKnowledgeSnippet,
} from "@/lib/server/ai/knowledgeRetrieval";
import type {
  AiDailyReview,
  DailyReview,
  Evidence,
  LearningLog,
  MonthlyGoal,
  Store,
  WeeklyMilestone,
} from "@/lib/types";

export type CoachMonthlyGoal = MonthlyGoal;
export type CoachWeeklyMilestone = WeeklyMilestone;

export type CoachActiveTask = {
  id: string;
  code: string;
  title: string;
  project: string;
  priority: string;
  status: string;
  nextAction: string;
  doneWhen: string;
  riskFlags: string[];
  updatedAt: string;
  plannedFor?: string;
};

export type CoachRecentReview = Pick<
  DailyReview,
  | "date"
  | "plannedP0"
  | "actualOutput"
  | "fakeProgress"
  | "driftFlags"
  | "tomorrowP0"
  | "notes"
  | "createdAt"
>;

export type CoachAiDailyReview = Pick<
  AiDailyReview,
  | "id"
  | "date"
  | "summary"
  | "realOutput"
  | "fakeProgress"
  | "growthSignals"
  | "driftWarnings"
  | "productThinkingProgress"
  | "executionProgress"
  | "technicalProgress"
  | "nextDaySuggestion"
  | "createdAt"
>;

export type CoachLearningLog = LearningLog;

export type CoachEvidence = Pick<
  Evidence,
  "id" | "date" | "type" | "title" | "description" | "taskId" | "createdAt"
>;

export type CoachContextPack = {
  rawInput: string;
  generatedAt: string;
  today: string;
  operatingContext: {
    northStar: string;
    currentFocus: string;
    activeConstraints: string[];
    antiGoals: string[];
    principles: string[];
    updatedAt?: string;
  };
  monthlyGoals: CoachMonthlyGoal[];
  currentMonthGoal: CoachMonthlyGoal | null;
  currentWeekMilestone: CoachWeeklyMilestone | null;
  activeTasks: CoachActiveTask[];
  recentReviews: CoachRecentReview[];
  recentAiDailyReviews: CoachAiDailyReview[];
  recentLearningLogs: CoachLearningLog[];
  relevantKnowledgeSnippets: CoachKnowledgeSnippet[];
  recentEvidence: CoachEvidence[];
  contextStats: {
    activeTaskCount: number;
    monthlyGoalCount: number;
    recentReviewCount: number;
    recentAiDailyReviewCount: number;
    recentLearningLogCount: number;
    relevantKnowledgeSnippetCount: number;
    recentEvidenceCount: number;
  };
};

export function buildCoachContextPack(
  rawInput: string,
  store: Store,
): CoachContextPack {
  const decisionContext = buildDecisionContextPack(rawInput, store);
  const today = getTodayDate();
  const monthlyGoals = normalizeMonthlyGoals(store.monthlyGoals || []);
  const currentMonthGoal = pickCurrentMonthlyGoal(monthlyGoals);
  const currentWeekMilestone = pickCurrentWeekMilestone(currentMonthGoal);
  const recentReviews = recentItems(store.reviews || [], 7).map((review) => ({
    date: trim(review.date),
    plannedP0: trim(review.plannedP0),
    actualOutput: truncate(trim(review.actualOutput), 400),
    fakeProgress: truncate(trim(review.fakeProgress), 300),
    driftFlags: trimArray(review.driftFlags),
    tomorrowP0: truncate(trim(review.tomorrowP0), 240),
    notes: truncate(trim(review.notes), 400),
    createdAt: trim(review.createdAt),
  }));
  const recentAiDailyReviews = recentItems(store.aiDailyReviews || [], 7).map(
    (review) => ({
      id: trim(review.id),
      date: trim(review.date),
      summary: truncate(trim(review.summary), 360),
      realOutput: truncate(trim(review.realOutput), 360),
      fakeProgress: truncate(trim(review.fakeProgress), 280),
      growthSignals: trimArray(review.growthSignals),
      driftWarnings: trimArray(review.driftWarnings),
      productThinkingProgress: truncate(
        trim(review.productThinkingProgress),
        260,
      ),
      executionProgress: truncate(trim(review.executionProgress), 260),
      technicalProgress: truncate(trim(review.technicalProgress), 260),
      nextDaySuggestion: truncate(trim(review.nextDaySuggestion), 260),
      createdAt: trim(review.createdAt),
    }),
  );
  const recentLearningLogs = recentItems(store.learningLogs || [], 8).map(
    (log) => ({
      ...log,
      title: truncate(trim(log.title), 160),
      summary: truncate(trim(log.summary), 360),
      insight: truncate(trim(log.insight), 260),
      source: trim(log.source) || undefined,
      tags: trimArray(log.tags),
    }),
  );
  const recentEvidence = recentItems(store.evidence || [], 10).map((item) => ({
    id: trim(item.id),
    date: trim(item.date),
    type: item.type,
    title: truncate(trim(item.title), 160),
    description: truncate(trim(item.description), 400),
    taskId: trim(item.taskId) || undefined,
    createdAt: trim(item.createdAt),
  }));
  const relevantKnowledgeSnippets = retrieveRelevantKnowledgeSnippets({
    store,
    query: rawInput,
    limit: 8,
  });

  return {
    rawInput: trim(rawInput),
    generatedAt: new Date().toISOString(),
    today,
    operatingContext: decisionContext.operatingContext,
    monthlyGoals,
    currentMonthGoal,
    currentWeekMilestone,
    activeTasks: decisionContext.activeTasks,
    recentReviews,
    recentAiDailyReviews,
    recentLearningLogs,
    relevantKnowledgeSnippets,
    recentEvidence,
    contextStats: {
      activeTaskCount: decisionContext.activeTasks.length,
      monthlyGoalCount: monthlyGoals.length,
      recentReviewCount: recentReviews.length,
      recentAiDailyReviewCount: recentAiDailyReviews.length,
      recentLearningLogCount: recentLearningLogs.length,
      relevantKnowledgeSnippetCount: relevantKnowledgeSnippets.length,
      recentEvidenceCount: recentEvidence.length,
    },
  };
}

function normalizeMonthlyGoals(goals: MonthlyGoal[]) {
  return [...goals]
    .map((goal) => ({
      ...goal,
      title: truncate(trim(goal.title), 160),
      why: truncate(trim(goal.why), 360),
      successMetric: truncate(trim(goal.successMetric), 240),
      targetEvidence: trimArray(goal.targetEvidence),
      weeklyMilestones: Array.isArray(goal.weeklyMilestones)
        ? goal.weeklyMilestones.map((milestone) => ({
            ...milestone,
            outcome: truncate(trim(milestone.outcome), 240),
            mustShip: truncate(trim(milestone.mustShip), 240),
            evidence: trimArray(milestone.evidence),
          }))
        : [],
      constraints: trimArray(goal.constraints),
      antiGoals: trimArray(goal.antiGoals),
    }))
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") {
        return -1;
      }

      if (a.status !== "active" && b.status === "active") {
        return 1;
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 8);
}

function pickCurrentMonthlyGoal(goals: MonthlyGoal[]) {
  const currentMonth = getCurrentMonth();
  const current = goals.find(
    (goal) => goal.month === currentMonth && goal.status === "active",
  );

  if (current) {
    return current;
  }

  return goals.find((goal) => goal.status === "active") || null;
}

function pickCurrentWeekMilestone(goal: MonthlyGoal | null) {
  if (!goal || !Array.isArray(goal.weeklyMilestones)) {
    return null;
  }

  const currentWeek = getIsoWeekLabel(new Date());
  const exact = goal.weeklyMilestones.find(
    (milestone) =>
      milestone.week === currentWeek &&
      (milestone.status === "active" || milestone.status === "planned"),
  );

  if (exact) {
    return exact;
  }

  return (
    goal.weeklyMilestones.find((milestone) => milestone.status === "active") ||
    goal.weeklyMilestones.find((milestone) => milestone.status === "planned") ||
    null
  );
}

function recentItems<T extends { createdAt: string; date?: string }>(
  items: T[],
  limit: number,
) {
  return [...items]
    .sort((a, b) => {
      const dateDiff = trim(b.date).localeCompare(trim(a.date));

      if (dateDiff !== 0) {
        return dateDiff;
      }

      return trim(b.createdAt).localeCompare(trim(a.createdAt));
    })
    .slice(0, limit);
}

function getTodayDate() {
  return formatDatePart(new Date(), "day");
}

function getCurrentMonth() {
  return formatDatePart(new Date(), "month");
}

function formatDatePart(date: Date, granularity: "day" | "month") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    ...(granularity === "day" ? { day: "2-digit" } : {}),
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";

  return granularity === "day" ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function getIsoWeekLabel(date: Date) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;

  copy.setUTCDate(copy.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function trim(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function trimArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function truncate(value: string, max = 400) {
  const text = trim(value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1)}…`;
}
