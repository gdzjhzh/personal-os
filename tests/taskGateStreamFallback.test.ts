import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Store, TaskGateStreamEvent } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  streamImpl: vi.fn(),
}));

vi.mock("@/lib/server/store", () => ({
  readStore: mocks.readStore,
}));

vi.mock("@/lib/server/ai/deepseek", () => {
  class MissingDeepSeekApiKeyError extends Error {
    constructor() {
      super("Missing DEEPSEEK_API_KEY");
      this.name = "MissingDeepSeekApiKeyError";
    }
  }

  class DeepSeekRequestError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.name = "DeepSeekRequestError";
      this.status = status;
    }
  }

  class DeepSeekTimeoutError extends DeepSeekRequestError {
    constructor(deadlineMs: number) {
      super("DeepSeek request timed out", undefined);
      this.name = "DeepSeekTimeoutError";
      this.message = `DeepSeek request timed out ${deadlineMs}`;
    }
  }

  class DeepSeekAbortError extends DeepSeekRequestError {
    constructor() {
      super("DeepSeek request aborted");
      this.name = "DeepSeekAbortError";
    }
  }

  return {
    createDeepSeekRequestId: () => "test-request",
    MissingDeepSeekApiKeyError,
    DeepSeekRequestError,
    DeepSeekTimeoutError,
    DeepSeekAbortError,
    streamDeepSeekChatCompletion: (...args: unknown[]) =>
      mocks.streamImpl(...args),
  };
});

import {
  DeepSeekTimeoutError,
  MissingDeepSeekApiKeyError,
} from "@/lib/server/ai/deepseek";
import { POST } from "@/app/api/ai/task-gate/stream/route";

describe("task gate stream fallback", () => {
  beforeEach(() => {
    mocks.readStore.mockResolvedValue(createStore());
    mocks.streamImpl.mockReset();
  });

  it("returns result and done ok true on timeout for ordinary long input", async () => {
    mocks.streamImpl.mockImplementation(async function* () {
      throw new DeepSeekTimeoutError(1);
    });

    const events = await postTaskGate({
      rawTask: "我想研究一个新的 SaaS 产品方向并整理资料",
    });

    expect(events.some((event) => event.type === "result")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("returns force fallback on timeout in force mode", async () => {
    mocks.streamImpl.mockImplementation(async function* () {
      throw new DeepSeekTimeoutError(1);
    });

    const events = await postTaskGate({
      rawTask: "强制把这个想法变成任务",
      force: true,
    });
    const result = events.find(
      (event): event is Extract<TaskGateStreamEvent, { type: "result" }> =>
        event.type === "result",
    );

    expect(result?.verdict.verdict).toBe("recommend");
    expect(result?.verdict.taskDraft?.priority).toBe("P2");
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("returns fallback result on parse failure", async () => {
    mocks.streamImpl.mockImplementation(async function* () {
      yield { type: "content", text: "not valid json" };
    });

    const events = await postTaskGate({
      rawTask: "帮我判断这个任务要不要做",
    });

    expect(events.some((event) => event.type === "result")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("returns fallback result when API key is missing", async () => {
    mocks.streamImpl.mockImplementation(async function* () {
      throw new MissingDeepSeekApiKeyError();
    });

    const events = await postTaskGate({
      rawTask: "帮我判断这个任务要不要做",
    });

    expect(events.some((event) => event.type === "result")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });
});

async function postTaskGate(body: Record<string, unknown>) {
  const response = await POST(
    new Request("http://local.test/api/ai/task-gate/stream", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();

  return parseSseEvents(text);
}

function parseSseEvents(text: string): TaskGateStreamEvent[] {
  return text
    .trim()
    .split(/\n\n+/)
    .map((frame) => {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      return dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    })
    .filter((event): event is TaskGateStreamEvent => Boolean(event));
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
