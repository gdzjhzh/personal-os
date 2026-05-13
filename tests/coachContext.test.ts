import { describe, expect, it } from "vitest";

import { buildCoachContextPack } from "@/lib/server/ai/coachContext";
import type { Store } from "@/lib/types";

describe("buildCoachContextPack", () => {
  it("handles old stores without monthlyGoals, learningLogs, or knowledgeCards", () => {
    const oldStore = createStore() as Partial<Store>;

    delete oldStore.monthlyGoals;
    delete oldStore.learningLogs;
    delete oldStore.knowledgeCards;

    const context = buildCoachContextPack("今天先做什么", oldStore as Store);

    expect(context.monthlyGoals).toEqual([]);
    expect(context.recentLearningLogs).toEqual([]);
    expect(context.relevantKnowledgeSnippets).toEqual([]);
    expect(context.contextStats.monthlyGoalCount).toBe(0);
  });

  it("recognizes the active goal for the current month", () => {
    const month = currentMonth();
    const store = createStore({
      monthlyGoals: [
        {
          id: "goal-current",
          month,
          title: "完成 Personal OS Coach V0",
          why: "用于每日执行",
          successMetric: "每天可用",
          targetEvidence: ["可运行"],
          weeklyMilestones: [],
          constraints: [],
          antiGoals: [],
          status: "active",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const context = buildCoachContextPack("今日计划", store);

    expect(context.currentMonthGoal?.id).toBe("goal-current");
  });
});

function createStore(patch: Partial<Store> = {}): Store {
  return {
    tasks: [],
    reviews: [],
    productTeardowns: [],
    aiDailyReviews: [],
    aiWeeklyReviews: [],
    codexRuns: [],
    evidence: [],
    operatingContext: {
      northStar: "长期愿景",
      currentFocus: "当前重点",
      activeConstraints: [],
      antiGoals: [],
      principles: [],
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    monthlyGoals: [],
    learningLogs: [],
    knowledgeCards: [],
    ...patch,
  };
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";

  return `${year}-${month}`;
}
