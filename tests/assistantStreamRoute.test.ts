import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantStreamEvent, Store } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
}));

vi.mock("@/lib/server/store", () => ({
  readStore: mocks.readStore,
}));

vi.mock("@/lib/server/ai/deepseek", () => {
  class MissingDeepSeekApiKeyError extends Error {}
  class DeepSeekRequestError extends Error {}
  class DeepSeekTimeoutError extends DeepSeekRequestError {}
  class DeepSeekAbortError extends DeepSeekRequestError {}

  return {
    createDeepSeekRequestId: () => "assistant-test",
    MissingDeepSeekApiKeyError,
    DeepSeekRequestError,
    DeepSeekTimeoutError,
    DeepSeekAbortError,
    streamDeepSeekChatCompletion: async function* () {
      yield { type: "content", text: "ok" };
    },
  };
});

import { POST } from "@/app/api/ai/assistant/stream/route";

describe("assistant stream route", () => {
  beforeEach(() => {
    mocks.readStore.mockResolvedValue(createStore());
  });

  it("routes explicit task-gate intent to the task gate stream", async () => {
    const events = await postAssistant({
      rawInput: "这个想法要不要做成任务",
    });
    const route = events.find(
      (event): event is Extract<AssistantStreamEvent, { type: "route" }> =>
        event.type === "route",
    );

    expect(route?.intent).toBe("task_gate");
    expect(route?.target).toBe("/api/ai/task-gate/stream");
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });
});

async function postAssistant(body: Record<string, unknown>) {
  const response = await POST(
    new Request("http://local.test/api/ai/assistant/stream", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();

  return parseSseEvents(text);
}

function parseSseEvents(text: string): AssistantStreamEvent[] {
  return text
    .trim()
    .split(/\n\n+/)
    .map((frame) => {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      return dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    })
    .filter((event): event is AssistantStreamEvent => Boolean(event));
}

function createStore(): Store {
  return {
    tasks: [],
    reviews: [],
    productTeardowns: [],
    aiDailyReviews: [],
    aiWeeklyReviews: [],
    codexRuns: [],
    evidence: [],
    operatingContext: {
      northStar: "成为独立 SaaS 产品创建者",
      currentFocus: "完成 Personal OS V0",
      activeConstraints: [],
      antiGoals: [],
      principles: [],
      updatedAt: "2026-05-13T00:00:00.000Z",
    },
    monthlyGoals: [],
    learningLogs: [],
    knowledgeCards: [],
  };
}
