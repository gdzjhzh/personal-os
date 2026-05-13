import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { streamDeepSeekChatCompletion } from "@/lib/server/ai/deepseek";

const originalApiKey = process.env.DEEPSEEK_API_KEY;

describe("streamDeepSeekChatCompletion deadline modes", () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalApiKey;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not abort an active content stream after the first content chunk", async () => {
    const source = createSseSource();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(source.stream, { status: 200 })),
    );

    const chunks = streamDeepSeekChatCompletion({
      messages: [{ role: "user", content: "今天先做什么" }],
      deadlineMs: 10,
      deadlineMode: "until_first_content",
    });

    const first = chunks.next();
    await Promise.resolve();
    source.sendJson({ choices: [{ delta: { content: "第一段" } }] });
    await expect(first).resolves.toEqual({
      done: false,
      value: { type: "content", text: "第一段" },
    });

    await vi.advanceTimersByTimeAsync(30);

    const second = chunks.next();
    await Promise.resolve();
    source.sendJson({ choices: [{ delta: { content: "第二段" } }] });
    await expect(second).resolves.toEqual({
      done: false,
      value: { type: "content", text: "第二段" },
    });

    const done = chunks.next();
    await Promise.resolve();
    source.sendDone();
    source.close();
    await expect(done).resolves.toEqual({ done: true, value: undefined });
  });
});

function createSseSource() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
  });

  return {
    stream,
    sendJson(value: unknown) {
      controller?.enqueue(
        encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
      );
    },
    sendDone() {
      controller?.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
    close() {
      controller?.close();
    },
  };
}
