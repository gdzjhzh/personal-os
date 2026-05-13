import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantStreamEvent, Store } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  streamImpl: vi.fn(),
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
    streamDeepSeekChatCompletion: (...args: unknown[]) =>
      mocks.streamImpl(...args),
  };
});

import { DeepSeekTimeoutError } from "@/lib/server/ai/deepseek";
import { POST } from "@/app/api/ai/assistant/stream/route";

describe("assistant stream route", () => {
  beforeEach(() => {
    mocks.readStore.mockResolvedValue(createStore());
    mocks.streamImpl.mockImplementation(async function* () {
      yield { type: "content", text: "ok" };
    });
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

  it("keeps streamed text when the model times out after useful deltas", async () => {
    const partial =
      "## 今天的 P0\n先完成当前最小闭环，并把完成证据写回 Personal OS。\n\n## 具体动作\n1. 确认目标和约束。\n2. 完成一个可检查产出。\n3. 记录 doneWhen 和复盘问题。";

    mocks.streamImpl.mockImplementation(async function* () {
      yield { type: "content", text: partial };
      throw new DeepSeekTimeoutError(16000);
    });

    const events = await postAssistant({
      rawInput: "今天先做什么",
      mode: "plan_today",
    });
    const delta = events.find(
      (event): event is Extract<AssistantStreamEvent, { type: "delta" }> =>
        event.type === "delta",
    );
    const result = events.find(
      (event): event is Extract<AssistantStreamEvent, { type: "result" }> =>
        event.type === "result",
    );

    expect(delta?.text).toBe(partial);
    expect(result?.text).toContain(partial);
    expect(result?.text).not.toContain("本地兜底");
    expect(result?.fallbackUsed).toBe(false);
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
