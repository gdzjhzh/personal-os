"use client";

import { useCallback, useRef, useState } from "react";

import {
  TaskGateDialog,
  type TaskGateInitialPayload,
} from "@/components/task-gate-dialog";
import type { DeepSeekModelInfo } from "@/lib/server/ai/deepseek";
import type { AssistantStreamEvent, AssistantStreamIntent } from "@/lib/types";

type CoachQuickAction = {
  label: string;
  mode: AssistantStreamIntent;
  prompt: string;
  requiresInput?: boolean;
};

type SseFrame = {
  event: string;
  data: string;
};

const quickActions: CoachQuickAction[] = [
  {
    label: "今天怎么安排",
    mode: "plan_today",
    prompt: "今天先做什么？请结合本月目标、当前任务和最近复盘给我一个今日 P0。",
  },
  {
    label: "帮我复盘今天",
    mode: "daily_review",
    prompt: "帮我复盘今天：我推进了什么、学到了什么、明天最小 P0 是什么？",
  },
  {
    label: "拆解这个任务",
    mode: "task_breakdown",
    prompt: "帮我拆解当前最重要的任务，给出最小可交付版本、行动步骤和 doneWhen。",
  },
  {
    label: "回顾最近学到的知识",
    mode: "knowledge_recall",
    prompt: "我最近学到了什么？哪些 insight 可以服务当前月目标或当前任务？",
  },
  {
    label: "判断是否进入任务系统",
    mode: "task_gate",
    prompt: "",
    requiresInput: true,
  },
];

export function PersonalCoach({
  modelInfo,
}: {
  modelInfo: DeepSeekModelInfo;
}) {
  const [input, setInput] = useState("");
  const [statusLine, setStatusLine] = useState("等待你的问题。");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeIntent, setActiveIntent] =
    useState<AssistantStreamIntent>("quick_answer");
  const [taskGatePayload, setTaskGatePayload] =
    useState<TaskGateInitialPayload | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const handleStreamEvent = useCallback((frame: SseFrame, rawInput: string) => {
    if (!frame.data) {
      return;
    }

    let event: AssistantStreamEvent;

    try {
      event = JSON.parse(frame.data) as AssistantStreamEvent;
    } catch {
      setError("超级助手返回了无法解析的事件。请重试，或把问题缩短后再发送。");
      return;
    }

    if (event.type === "status") {
      setStatusLine(event.message);
    }

    if (event.type === "delta" || event.type === "content") {
      setAnswer((current) => `${current}${event.text}`);
    }

    if (event.type === "result") {
      setAnswer(event.text);
      setActiveIntent(event.intent);
      setStatusLine(event.fallbackUsed ? "已返回本地兜底建议。" : "超级助手已完成。");
    }

    if (event.type === "route") {
      setStatusLine(event.message);
      setTaskGatePayload({
        requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        rawTask: rawInput,
        project: "Personal SaaS OS",
        currentPhaseContext:
          "Personal OS Coach 判断这是任务准入问题，交给 task gate 子模块处理。",
      });
    }

    if (event.type === "error") {
      setError(event.message);
    }
  }, []);

  const runAssistant = useCallback(
    async ({
      mode,
      rawInput,
    }: {
      mode?: AssistantStreamIntent;
      rawInput: string;
    }) => {
      const trimmed = rawInput.trim();

      if (!trimmed) {
        setError("先输入一个问题、想法或任务，再交给超级助手。");
        return;
      }

      requestSeqRef.current += 1;
      const requestSeq = requestSeqRef.current;
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setAnswer("");
      setError("");
      setActiveIntent(mode || "quick_answer");
      setStatusLine("已发送，正在连接 Personal OS Coach…");

      try {
        const response = await fetch("/api/ai/assistant/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawInput: trimmed,
            mode,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error("empty_body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (requestSeqRef.current !== requestSeq) {
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const frames = splitSseFrames(buffer);
          buffer = frames.remainder;

          for (const frame of frames.complete) {
            handleStreamEvent(parseSseFrame(frame), trimmed);
          }
        }

        buffer += decoder.decode();

        if (buffer.trim() && requestSeqRef.current === requestSeq) {
          handleStreamEvent(parseSseFrame(buffer), trimmed);
        }
      } catch (streamError) {
        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        if (controller.signal.aborted) {
          setStatusLine("已停止本次请求，输入没有丢失。");
        } else {
          setError(
            streamError instanceof Error && streamError.message.startsWith("HTTP")
              ? "超级助手接口暂时不可用。你可以重试，或先用快捷按钮生成本地兜底建议。"
              : "超级助手请求失败。请保留当前输入，稍后重试或缩小问题。",
          );
        }
      } finally {
        if (requestSeqRef.current === requestSeq) {
          setIsStreaming(false);
        }
      }
    },
    [handleStreamEvent],
  );

  function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAssistant({ rawInput: input });
  }

  function runQuickAction(action: CoachQuickAction) {
    const rawInput = input.trim() || action.prompt;

    if (action.requiresInput && !input.trim()) {
      setError("请先写下要判断的想法，再进入任务准入。");
      return;
    }

    void runAssistant({
      rawInput,
      mode: action.mode,
    });
  }

  function stopRequest() {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    setIsStreaming(false);
    setStatusLine("已停止本次请求，输入没有丢失。");
  }

  return (
    <section className="grid gap-4 border border-emerald-900/70 bg-black/80 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid gap-1">
          <p className="font-mono text-xs text-emerald-400">
            Personal OS Coach
          </p>
          <h2 className="text-base font-semibold text-zinc-100">
            问超级助手
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-zinc-500">
            用来做今日计划、任务拆解、复盘、知识回顾和普通问答；只有明确要新增任务或判断是否进入任务系统时，才切到任务准入。
          </p>
        </div>
        <div className="w-fit border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-400">
          <div className="font-mono text-zinc-300">{modelInfo.model}</div>
          <div>
            API Key：
            <span
              className={
                modelInfo.apiKeyConfigured
                  ? "text-emerald-300"
                  : "text-amber-300"
              }
            >
              {modelInfo.apiKeyConfigured ? "已配置" : "未配置"}
            </span>
          </div>
        </div>
      </div>

      <form className="grid gap-3" onSubmit={submitQuestion}>
        <label className="grid gap-1.5 text-sm text-zinc-500">
          你想让超级助手帮你处理什么
          <textarea
            className="min-h-28 resize-y border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            placeholder="例如：今天先做什么 / 帮我复盘 / 解释一下 RAG / 把这个目标拆成下一步"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              className={
                action.mode === "task_gate"
                  ? dangerButtonClassName
                  : secondaryButtonClassName
              }
              key={action.label}
              type="button"
              onClick={() => runQuickAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={primaryButtonClassName}
            disabled={isStreaming}
            type="submit"
          >
            {isStreaming ? "生成中…" : "问超级助手"}
          </button>
          {isStreaming ? (
            <button
              className={secondaryButtonClassName}
              type="button"
              onClick={stopRequest}
            >
              停止
            </button>
          ) : null}
          <span className="font-mono text-xs text-zinc-500">
            intent: {activeIntent}
          </span>
        </div>
      </form>

      <div
        aria-live="polite"
        className="grid gap-2 border border-zinc-800 bg-black px-3 py-2 text-sm"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="leading-6 text-zinc-300">{statusLine}</p>
          <span
            className={`w-fit border px-2 py-1 font-mono text-xs ${
              isStreaming
                ? "border-emerald-800 text-emerald-300"
                : "border-zinc-800 text-zinc-400"
            }`}
          >
            {isStreaming ? "streaming" : "idle"}
          </span>
        </div>
        {error ? (
          <p className="border border-amber-900 bg-amber-950/25 px-3 py-2 leading-6 text-amber-100">
            {error}
          </p>
        ) : null}
      </div>

      {answer ? (
        <article className="whitespace-pre-wrap border border-zinc-800 bg-zinc-950/70 p-4 text-sm leading-7 text-zinc-100">
          {answer}
        </article>
      ) : null}

      {taskGatePayload ? (
        <TaskGateDialog
          initialPayload={taskGatePayload}
          key={taskGatePayload.requestKey}
          onClose={() => setTaskGatePayload(null)}
        />
      ) : null}
    </section>
  );
}

function splitSseFrames(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const complete: string[] = [];
  let searchFrom = 0;
  let separatorIndex = normalized.indexOf("\n\n", searchFrom);

  while (separatorIndex !== -1) {
    complete.push(normalized.slice(searchFrom, separatorIndex));
    searchFrom = separatorIndex + 2;
    separatorIndex = normalized.indexOf("\n\n", searchFrom);
  }

  return {
    complete,
    remainder: normalized.slice(searchFrom),
  };
}

function parseSseFrame(frame: string): SseFrame {
  const lines = frame.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  return {
    event: eventLine ? eventLine.slice(6).trim() : "message",
    data: dataLines.join("\n").trim(),
  };
}

const primaryButtonClassName =
  "min-h-10 border border-emerald-600 bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName =
  "min-h-10 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300";
const dangerButtonClassName =
  "min-h-10 border border-amber-800 bg-amber-950/25 px-3 py-2 text-sm font-semibold text-amber-100 hover:border-amber-600";
