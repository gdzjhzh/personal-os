import { describe, expect, it } from "vitest";

import { retrieveRelevantKnowledgeSnippets } from "@/lib/server/ai/knowledgeRetrieval";
import type { Store } from "@/lib/types";

describe("retrieveRelevantKnowledgeSnippets", () => {
  it("ranks title and tag matches ahead of body-only matches", () => {
    const store = createStore({
      knowledgeCards: [
        {
          id: "body-only",
          title: "普通知识卡",
          body: "这里提到 RAG，但是标题和标签没有命中。",
          tags: [],
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "title-hit",
          title: "RAG 取舍",
          body: "关于检索增强生成的判断。",
          tags: ["AI"],
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const snippets = retrieveRelevantKnowledgeSnippets({
      store,
      query: "解释一下 RAG",
    });

    expect(snippets[0].id).toBe("title-hit");
  });

  it("falls back to recent records when there is no keyword hit", () => {
    const store = createStore({
      learningLogs: [
        {
          id: "recent-learning",
          date: "2026-05-12",
          title: "最近学习",
          summary: "今天记下一个执行系统 insight。",
          insight: "复盘要绑定下一步动作。",
          tags: ["复盘"],
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
    });

    const snippets = retrieveRelevantKnowledgeSnippets({
      store,
      query: "完全不相关的关键词 xyz",
    });

    expect(snippets).toHaveLength(1);
    expect(snippets[0].id).toBe("recent-learning");
    expect(snippets[0].relevanceReason).toContain("最近记录");
  });

  it("respects limit", () => {
    const store = createStore({
      knowledgeCards: Array.from({ length: 3 }, (_, index) => ({
        id: `card-${index}`,
        title: `RAG ${index}`,
        body: "检索增强生成",
        tags: ["RAG"],
        createdAt: `2026-05-0${index + 1}T00:00:00.000Z`,
        updatedAt: `2026-05-0${index + 1}T00:00:00.000Z`,
      })),
    });

    const snippets = retrieveRelevantKnowledgeSnippets({
      store,
      query: "RAG",
      limit: 2,
    });

    expect(snippets).toHaveLength(2);
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
      northStar: "",
      currentFocus: "",
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
