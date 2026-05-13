import { describe, expect, it } from "vitest";

import { buildAssistantFallback } from "@/lib/server/ai/assistantFallback";
import type { CoachContextPack } from "@/lib/server/ai/coachContext";
import type { PersonalCoachMode } from "@/lib/server/ai/personalCoach";

const modes: PersonalCoachMode[] = [
  "quick_answer",
  "plan_today",
  "daily_review",
  "task_breakdown",
  "knowledge_recall",
  "schedule",
];

describe("buildAssistantFallback", () => {
  it.each(modes)("returns non-empty text for %s", (intent) => {
    const text = buildAssistantFallback({
      intent,
      rawInput: "今天先做什么",
      contextPack: createContext(),
      reason: "timeout",
    });

    expect(text.trim().length).toBeGreaterThan(20);
  });

  it("plan_today fallback contains P0 and doneWhen", () => {
    const text = buildAssistantFallback({
      intent: "plan_today",
      rawInput: "今天先做什么",
      contextPack: createContext(),
      reason: "timeout",
    });

    expect(text).toContain("P0");
    expect(text).toContain("doneWhen");
  });

  it("daily_review fallback contains a LearningLog draft", () => {
    const text = buildAssistantFallback({
      intent: "daily_review",
      rawInput: "帮我复盘今天",
      contextPack: createContext(),
      reason: "missing_api_key",
    });

    expect(text).toContain("LearningLog");
    expect(text).toContain("草稿");
  });
});

function createContext(): CoachContextPack {
  return {
    rawInput: "今天先做什么",
    generatedAt: "2026-05-13T00:00:00.000Z",
    today: "2026-05-13",
    operatingContext: {
      northStar: "成为独立 SaaS 产品创建者",
      currentFocus: "完成 Personal OS Coach V0",
      activeConstraints: [],
      antiGoals: [],
      principles: [],
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    monthlyGoals: [],
    currentMonthGoal: null,
    currentWeekMilestone: null,
    activeTasks: [
      {
        id: "task-1",
        code: "T001",
        title: "实现超级助手入口",
        project: "Personal OS",
        priority: "P0",
        status: "active",
        nextAction: "接入 assistant stream",
        doneWhen: "页面可见且可返回兜底",
        riskFlags: [],
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ],
    recentReviews: [],
    recentAiDailyReviews: [],
    recentLearningLogs: [],
    relevantKnowledgeSnippets: [],
    recentEvidence: [],
    contextStats: {
      activeTaskCount: 1,
      monthlyGoalCount: 0,
      recentReviewCount: 0,
      recentAiDailyReviewCount: 0,
      recentLearningLogCount: 0,
      relevantKnowledgeSnippetCount: 0,
      recentEvidenceCount: 0,
    },
  };
}
