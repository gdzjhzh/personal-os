import {
  classifyAssistantIntent,
  type AssistantIntent,
} from "@/lib/server/ai/assistantIntent";
import { buildAssistantFallback } from "@/lib/server/ai/assistantFallback";
import {
  buildCoachContextPack,
  type CoachContextPack,
} from "@/lib/server/ai/coachContext";
import {
  createDeepSeekRequestId,
  DeepSeekAbortError,
  DeepSeekRequestError,
  DeepSeekTimeoutError,
  MissingDeepSeekApiKeyError,
  streamDeepSeekChatCompletion,
} from "@/lib/server/ai/deepseek";
import { eventStream } from "@/lib/server/ai/eventStream";
import {
  buildPersonalCoachMessages,
  type PersonalCoachMode,
} from "@/lib/server/ai/personalCoach";
import { readStore } from "@/lib/server/store";
import type { AssistantStreamEvent, Store } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssistantStreamRequest = {
  rawInput?: unknown;
  message?: unknown;
  dialogMessages?: unknown;
  mode?: unknown;
  todayCapacity?: unknown;
};

const personalCoachModes: PersonalCoachMode[] = [
  "quick_answer",
  "plan_today",
  "daily_review",
  "task_breakdown",
  "knowledge_recall",
  "schedule",
];

export async function POST(request: Request) {
  let body: AssistantStreamRequest;

  try {
    body = (await request.json()) as AssistantStreamRequest;
  } catch {
    return eventStream<AssistantStreamEvent>((send) => {
      send("error", {
        type: "error",
        message: "请求内容不是合法 JSON，无法开始超级助手对话。",
        code: "invalid_request",
      });
      send("done", { type: "done", ok: false });
    });
  }

  const rawInput =
    stringOrEmpty(body.rawInput) || stringOrEmpty(body.message);

  return eventStream<AssistantStreamEvent>((send, close, streamSignal) => {
    const requestId = `assistant_${createDeepSeekRequestId()}`;
    const deepSeekAbort = new AbortController();
    const startedAt = Date.now();
    let contextPack: CoachContextPack | undefined;
    let resolvedIntent: AssistantIntent = "quick_answer";
    let fallbackUsed = false;
    let finalText = "";

    const abortDeepSeek = () => deepSeekAbort.abort();
    request.signal.addEventListener("abort", abortDeepSeek, { once: true });
    streamSignal.addEventListener("abort", abortDeepSeek, { once: true });

    send("status", {
      type: "status",
      message: "已收到，正在判断这次应该由超级助手还是任务准入处理…",
    });

    void (async () => {
      try {
        const store = await readStore();
        const classified = classifyAssistantIntent(rawInput);
        resolvedIntent = resolveIntentOverride(body.mode, classified.intent);

        console.info("[ai.assistant] stream:start", {
          requestId,
          intent: resolvedIntent,
          confidence: classified.confidence,
          rawInputChars: rawInput.length,
        });

        if (resolvedIntent === "task_gate") {
          send("route", {
            type: "route",
            intent: "task_gate",
            target: "/api/ai/task-gate/stream",
            message: "这更像任务准入问题，接下来交给“判断是否生成任务”流程。",
          });
          send("done", { type: "done", ok: true });
          return;
        }

        contextPack = buildCoachContextPack(rawInput, store);

        send("status", {
          type: "status",
          message: statusMessage(resolvedIntent),
        });

        const config = modeConfig(resolvedIntent);
        const messages = buildPersonalCoachMessages({
          rawInput,
          intent: resolvedIntent,
          contextPack,
          dialogMessages: readDialogMessages(body.dialogMessages),
          todayCapacity: stringOrEmpty(body.todayCapacity),
        });

        for await (const chunk of streamDeepSeekChatCompletion({
          messages,
          reasoningEffort: null,
          requestId,
          maxTokens: config.maxTokens,
          deadlineMs: config.deadlineMs,
          signal: deepSeekAbort.signal,
        })) {
          if (chunk.type !== "content") {
            continue;
          }

          finalText += chunk.text;
          send("delta", { type: "delta", text: chunk.text });
        }

        if (!finalText.trim()) {
          throw new DeepSeekRequestError("DeepSeek returned empty assistant text");
        }

        send("result", {
          type: "result",
          text: finalText,
          intent: resolvedIntent,
          contextStats: contextPack.contextStats,
          fallbackUsed,
        });
        send("done", { type: "done", ok: true });

        console.info("[ai.assistant] stream:success", {
          requestId,
          intent: resolvedIntent,
          elapsedMs: Date.now() - startedAt,
          fallbackUsed,
          contextStats: contextPack.contextStats,
        });
      } catch (error) {
        if (error instanceof DeepSeekAbortError) {
          send("error", {
            type: "error",
            code: "aborted",
            message: "已停止本次超级助手请求，输入没有丢失。",
          });
          send("done", { type: "done", ok: false });
          return;
        }

        contextPack =
          contextPack || buildCoachContextPack(rawInput, createEmptyStore());

        if (error instanceof DeepSeekTimeoutError && hasUsefulPartial(finalText)) {
          const partialText = finalizePartialText(finalText);
          send("status", {
            type: "status",
            message: "模型还没完全收尾，已保留已经流式生成的内容。",
          });
          send("result", {
            type: "result",
            text: partialText,
            intent: toCoachMode(resolvedIntent),
            contextStats: contextPack.contextStats,
            fallbackUsed: false,
          });
          send("done", { type: "done", ok: true });

          console.warn("[ai.assistant] stream:partial_timeout", {
            requestId,
            intent: resolvedIntent,
            elapsedMs: Date.now() - startedAt,
            fallbackUsed: false,
            partialChars: partialText.length,
            error: describeError(error),
            contextStats: contextPack.contextStats,
          });
          return;
        }

        const fallbackReason = fallbackReasonFromError(error);
        fallbackUsed = true;
        const fallback = buildAssistantFallback({
          intent: toCoachMode(resolvedIntent),
          rawInput,
          contextPack,
          reason: fallbackReason,
        });

        send("status", {
          type: "status",
          message: fallbackStatusMessage(fallbackReason),
        });
        send("content", { type: "content", text: fallback });
        send("result", {
          type: "result",
          text: fallback,
          intent: toCoachMode(resolvedIntent),
          contextStats: contextPack.contextStats,
          fallbackUsed,
        });
        send("done", { type: "done", ok: true });

        console.warn("[ai.assistant] stream:fallback", {
          requestId,
          intent: resolvedIntent,
          elapsedMs: Date.now() - startedAt,
          fallbackUsed,
          reason: fallbackReason,
          error: describeError(error),
          contextStats: contextPack.contextStats,
        });
      } finally {
        request.signal.removeEventListener("abort", abortDeepSeek);
        streamSignal.removeEventListener("abort", abortDeepSeek);
        close();
      }
    })();
  });
}

function resolveIntentOverride(value: unknown, fallback: AssistantIntent) {
  const mode = stringOrEmpty(value) as AssistantIntent;

  if (mode === "task_gate" || personalCoachModes.includes(mode as PersonalCoachMode)) {
    return mode;
  }

  return fallback;
}

function toCoachMode(intent: AssistantIntent): PersonalCoachMode {
  return intent === "task_gate" ? "quick_answer" : intent;
}

function modeConfig(intent: PersonalCoachMode) {
  if (intent === "quick_answer") {
    return { maxTokens: 800, deadlineMs: 8000 };
  }

  if (intent === "daily_review" || intent === "task_breakdown") {
    return { maxTokens: 1600, deadlineMs: 16000 };
  }

  return { maxTokens: 1400, deadlineMs: 16000 };
}

function statusMessage(intent: PersonalCoachMode) {
  if (intent === "quick_answer") {
    return "正在快速回答，不走任务准入，也不强制 JSON…";
  }

  if (intent === "plan_today") {
    return "正在结合你的目标、任务和复盘生成今日计划…";
  }

  if (intent === "daily_review") {
    return "正在结合今天任务、复盘和学习记录生成复盘建议…";
  }

  if (intent === "task_breakdown") {
    return "正在把目标拆成可执行动作和完成证据…";
  }

  if (intent === "knowledge_recall") {
    return "正在从本地学习、证据和知识片段中回忆相关内容…";
  }

  return "正在生成时间块安排和复盘节点…";
}

function fallbackStatusMessage(reason: ReturnType<typeof fallbackReasonFromError>) {
  if (reason === "missing_api_key") {
    return "当前未配置 AI Key，先给出本地规则版建议。";
  }

  if (reason === "timeout") {
    return "模型响应超时，先返回可用的本地兜底结果。";
  }

  return "AI 请求暂时不可用，先返回可用的本地兜底结果。";
}

function hasUsefulPartial(text: string): boolean {
  return text.trim().length >= 80;
}

function finalizePartialText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  return `${trimmed}\n\n（模型响应超时，已保留当前流式内容。你可以先按上面的建议执行，或继续追问补全。）`;
}

function fallbackReasonFromError(
  error: unknown,
): "timeout" | "missing_api_key" | "request_error" | "parse_error" {
  if (error instanceof MissingDeepSeekApiKeyError) {
    return "missing_api_key";
  }

  if (error instanceof DeepSeekTimeoutError) {
    return "timeout";
  }

  return "request_error";
}

function readDialogMessages(value: unknown) {
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
    .filter((item): item is { role: "user" | "assistant"; content: string } =>
      Boolean(item),
    )
    .slice(-8);
}

function createEmptyStore(): Store {
  const now = new Date().toISOString();

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
      updatedAt: now,
    },
    monthlyGoals: [],
    learningLogs: [],
    knowledgeCards: [],
  };
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
