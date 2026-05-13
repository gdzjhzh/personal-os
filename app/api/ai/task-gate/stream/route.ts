import {
  createDeepSeekRequestId,
  DeepSeekAbortError,
  DeepSeekRequestError,
  DeepSeekTimeoutError,
  MissingDeepSeekApiKeyError,
  streamDeepSeekChatCompletion,
} from "@/lib/server/ai/deepseek";
import { buildDecisionContextPack } from "@/lib/server/ai/decisionContext";
import { eventStream } from "@/lib/server/ai/eventStream";
import {
  buildFallbackVerdict,
  buildForceTaskMessages,
  buildTaskGateMessages,
  parseTaskGateVerdict,
  TaskGatekeeperError,
  type TaskGatePromptInput,
} from "@/lib/server/ai/taskGatekeeper";
import { readStore } from "@/lib/server/store";
import type {
  TaskGateDialogMessage,
  TaskGateStreamEvent,
  TaskGateVerdict,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskGateStreamRequest = {
  rawTask?: unknown;
  project?: unknown;
  currentPhaseContext?: unknown;
  dialogMessages?: unknown;
  force?: unknown;
  previousVerdict?: unknown;
};

export async function POST(request: Request) {
  let body: TaskGateStreamRequest;

  try {
    body = (await request.json()) as TaskGateStreamRequest;
  } catch {
    return eventStream<TaskGateStreamEvent>((send) => {
      send("error", {
        type: "error",
        message: "请求内容不是合法 JSON，无法开始 AI 任务准入。",
        code: "invalid_request",
      });
      send("done", { type: "done", ok: false });
    });
  }

  const rawTask = stringOrEmpty(body.rawTask);

  if (!rawTask) {
    return eventStream<TaskGateStreamEvent>((send) => {
      send("error", {
        type: "error",
        message: "请先输入一个想法，再和 AI 讨论是否值得生成任务。",
        code: "empty_input",
      });
      send("done", { type: "done", ok: false });
    });
  }

  return eventStream<TaskGateStreamEvent>((send, close, streamSignal) => {
    const requestId = `task_gate_${createDeepSeekRequestId()}`;
    const deepSeekAbort = new AbortController();
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let heavyStatusTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let promptInput: TaskGatePromptInput | null = null;

    const abortDeepSeek = () => deepSeekAbort.abort();
    request.signal.addEventListener("abort", abortDeepSeek, { once: true });
    streamSignal.addEventListener("abort", abortDeepSeek, { once: true });

    void (async () => {
      try {
        const store = await readStore();
        const contextPack = buildDecisionContextPack(rawTask, store);
        promptInput = {
          rawTask,
          project: stringOrEmpty(body.project) || "Personal SaaS OS",
          currentPhaseContext: stringOrEmpty(body.currentPhaseContext),
          contextPack,
          dialogMessages: readDialogMessages(body.dialogMessages),
          force: body.force === true,
          previousVerdict: isRecord(body.previousVerdict)
            ? (body.previousVerdict as TaskGateVerdict)
            : undefined,
        };
        const messages = promptInput.force
          ? buildForceTaskMessages(promptInput)
          : buildTaskGateMessages(promptInput);
        let finalContent = "";
        let reasoningChars = 0;
        let lastThinkingAt = 0;
        let lastThinkingChars = 0;
        let lastDraftingAt = 0;
        let lastDraftingChars = 0;

        console.info("[ai.taskGate] stream:start", {
          requestId,
          rawTaskChars: rawTask.length,
          force: promptInput.force,
          dialogMessageCount: promptInput.dialogMessages?.length || 0,
          contextStats: contextPack.contextStats,
        });

        send("status", {
          type: "status",
          message:
            "正在结合你的愿景、当前任务和近期复盘判断这个想法是否值得进入任务系统…",
        });

        heartbeatTimer = setInterval(() => {
          send("heartbeat", {
            type: "heartbeat",
            message: "请求仍在进行，正在等待模型输出…",
            elapsedMs: Date.now() - startedAt,
          });
        }, 3000);

        heavyStatusTimer = setTimeout(() => {
          send("status", {
            type: "status",
            message:
              "这次判断偏重，你可以继续等待，也可以关闭弹窗保留输入。",
          });
        }, 12000);

        for await (const chunk of streamDeepSeekChatCompletion({
          messages,
          reasoningEffort: "high",
          requestId,
          responseFormat: "json_object",
          maxTokens: promptInput.force ? 1800 : 2200,
          deadlineMs: promptInput.force ? 18000 : 22000,
          signal: deepSeekAbort.signal,
        })) {
          if (chunk.type === "reasoning") {
            reasoningChars += chunk.text.length;

            if (
              reasoningChars - lastThinkingChars >= 200 ||
              Date.now() - lastThinkingAt >= 1000
            ) {
              lastThinkingAt = Date.now();
              lastThinkingChars = reasoningChars;
              send("thinking", {
                type: "thinking",
                message: "模型仍在分析是否值得生成任务…",
                reasoningChars,
              });
            }
          }

          if (chunk.type === "content") {
            finalContent += chunk.text;

            if (
              finalContent.length - lastDraftingChars >= 120 ||
              Date.now() - lastDraftingAt >= 500
            ) {
              lastDraftingAt = Date.now();
              lastDraftingChars = finalContent.length;
              send("drafting", {
                type: "drafting",
                message: "正在形成最终判断…",
                receivedChars: finalContent.length,
              });
            }
          }
        }

        const verdict = parseTaskGateVerdictWithFallback({
          finalContent,
          promptInput,
          requestId,
          startedAt,
          send,
        });

        if (!verdict) {
          return;
        }

        send("result", {
          type: "result",
          verdict,
        });
        send("done", { type: "done", ok: true });

        console.info("[ai.taskGate] stream:success", {
          requestId,
          elapsedMs: Date.now() - startedAt,
          force: promptInput.force,
          verdict: verdict.verdict,
          contentChars: finalContent.length,
          reasoningChars,
        });
      } catch (error) {
        if (promptInput && shouldReturnFallback(error)) {
          sendFallbackVerdict({
            promptInput,
            requestId,
            startedAt,
            send,
            statusMessage: fallbackStatusMessage(error),
            error,
          });
          return;
        }

        const event = toTaskGateErrorEvent(error);

        if (!(error instanceof DeepSeekAbortError)) {
          console.warn("[ai.taskGate] stream:error", {
            requestId,
            elapsedMs: Date.now() - startedAt,
            error: describeError(error),
          });
        }

        send("error", event);
        send("done", { type: "done", ok: false });
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }

        if (heavyStatusTimer) {
          clearTimeout(heavyStatusTimer);
        }

        request.signal.removeEventListener("abort", abortDeepSeek);
        streamSignal.removeEventListener("abort", abortDeepSeek);
        close();
      }
    })();
  });
}

function parseTaskGateVerdictWithFallback({
  finalContent,
  promptInput,
  requestId,
  send,
  startedAt,
}: {
  finalContent: string;
  promptInput: TaskGatePromptInput;
  requestId: string;
  startedAt: number;
  send: <T extends TaskGateStreamEvent["type"]>(
    event: T,
    data: Extract<TaskGateStreamEvent, { type: T }>,
  ) => void;
}) {
  try {
    return parseTaskGateVerdict(finalContent, promptInput);
  } catch (error) {
    if (error instanceof TaskGatekeeperError) {
      sendFallbackVerdict({
        promptInput,
        requestId,
        startedAt,
        send,
        statusMessage: "AI 输出格式不稳定，先给出保守判断。",
        error,
      });
      return null;
    }

    throw error;
  }
}

function shouldReturnFallback(
  error: unknown,
) {
  return (
    error instanceof DeepSeekTimeoutError ||
    error instanceof MissingDeepSeekApiKeyError ||
    error instanceof TaskGatekeeperError
  );
}

function sendFallbackVerdict({
  error,
  promptInput,
  requestId,
  send,
  startedAt,
  statusMessage,
}: {
  error: unknown;
  promptInput: TaskGatePromptInput;
  requestId: string;
  startedAt: number;
  statusMessage: string;
  send: <T extends TaskGateStreamEvent["type"]>(
    event: T,
    data: Extract<TaskGateStreamEvent, { type: T }>,
  ) => void;
}) {
  const verdict = buildFallbackVerdict(promptInput);

  send("status", {
    type: "status",
    message: statusMessage,
  });
  send("result", {
    type: "result",
    verdict,
  });
  send("done", { type: "done", ok: true });

  console.warn("[ai.taskGate] stream:fallback", {
    requestId,
    elapsedMs: Date.now() - startedAt,
    force: promptInput.force,
    verdict: verdict.verdict,
    fallbackUsed: true,
    error: describeError(error),
  });
}

function fallbackStatusMessage(error: unknown) {
  if (error instanceof MissingDeepSeekApiKeyError) {
    return "当前未配置 AI Key，先给出保守的任务准入判断。";
  }

  if (error instanceof DeepSeekTimeoutError) {
    return "AI 任务准入响应超时，先给出保守判断，避免页面空白。";
  }

  if (error instanceof TaskGatekeeperError) {
    return "AI 输出格式不稳定，先给出保守判断。";
  }

  return "AI 任务准入暂时不可用，先给出保守判断。";
}

function toTaskGateErrorEvent(
  error: unknown,
): Extract<TaskGateStreamEvent, { type: "error" }> {
  if (error instanceof MissingDeepSeekApiKeyError) {
    return {
      type: "error",
      code: "missing_api_key",
      message:
        "未配置 DEEPSEEK_API_KEY，无法使用 AI 任务准入。你仍然可以手动新增任务。",
    };
  }

  if (error instanceof DeepSeekAbortError) {
    return {
      type: "error",
      code: "aborted",
      message: "已停止本次 AI 判断，输入未丢失。",
    };
  }

  if (error instanceof TaskGatekeeperError) {
    return {
      type: "error",
      code: error.code,
      message:
        error.code === "invalid_json"
          ? "AI 返回了无法解析的判断结果。输入已保留，可以重试或改为手动新增。"
          : error.message,
    };
  }

  if (error instanceof DeepSeekRequestError) {
    if (error.status === 401 || error.status === 403) {
      return {
        type: "error",
        code: "auth_failed",
        message:
          "DeepSeek 拒绝了本次请求。请确认 API Key 有效；你仍然可以手动新增任务。",
      };
    }

    if (error.status === 402) {
      return {
        type: "error",
        code: "insufficient_quota",
        message:
          "DeepSeek 额度不可用，无法完成本次 AI 任务准入。你仍然可以手动新增任务。",
      };
    }

    return {
      type: "error",
      code: "request_failed",
      message:
        "AI 任务准入请求失败。输入已保留，可以重试、继续补充一句，或手动新增最小任务。",
    };
  }

  return {
    type: "error",
    code: "unknown",
    message:
      "AI 任务准入暂时不可用。输入已保留，可以重试或改为手动新增。",
  };
}

function readDialogMessages(value: unknown): TaskGateDialogMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const role = item.role === "assistant" ? "assistant" : "user";
      const content = stringOrEmpty(item.content);

      return content ? { role, content } : null;
    })
    .filter((item): item is TaskGateDialogMessage => Boolean(item))
    .slice(-8);
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}
