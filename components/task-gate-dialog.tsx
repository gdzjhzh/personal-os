"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveGateTaskAction } from "@/app/today/actions";
import type {
  ClarifiedTaskDraft,
  TaskGateContextSnapshot,
  TaskGateDialogMessage,
  TaskGateEvidence,
  TaskGateOption,
  TaskGateStreamEvent,
  TaskGateVerdict,
} from "@/lib/types";

export type TaskGateInitialPayload = {
  requestKey: string;
  rawTask: string;
  project: string;
  currentPhaseContext: string;
};

type TaskGateRequestPayload = {
  rawTask: string;
  project: string;
  currentPhaseContext: string;
  dialogMessages?: TaskGateDialogMessage[];
  force?: boolean;
  previousVerdict?: TaskGateVerdict;
};

type SseFrame = {
  event: string;
  data: string;
};

export function TaskGateDialog({
  initialPayload,
  onClose,
}: {
  initialPayload: TaskGateInitialPayload;
  onClose: () => void;
}) {
  const [statusLine, setStatusLine] = useState("正在连接 AI…");
  const [heartbeatLine, setHeartbeatLine] = useState("");
  const [reasoningChars, setReasoningChars] = useState(0);
  const [receivedChars, setReceivedChars] = useState(0);
  const [result, setResult] = useState<TaskGateVerdict | null>(null);
  const [error, setError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [dialogMessages, setDialogMessages] = useState<TaskGateDialogMessage[]>(
    [],
  );
  const [showSupplement, setShowSupplement] = useState(false);
  const [supplement, setSupplement] = useState("");
  const [lastRequestWasForce, setLastRequestWasForce] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  const basePayload = useMemo(
    () => ({
      rawTask: initialPayload.rawTask,
      project: initialPayload.project,
      currentPhaseContext: initialPayload.currentPhaseContext,
    }),
    [
      initialPayload.currentPhaseContext,
      initialPayload.project,
      initialPayload.rawTask,
    ],
  );

  const runStream = useCallback(async (payload: TaskGateRequestPayload) => {
    requestSeqRef.current += 1;
    const requestSeq = requestSeqRef.current;
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setStatusLine("正在连接 AI…");
    setHeartbeatLine("");
    setReasoningChars(0);
    setReceivedChars(0);
    setResult(null);
    setError("");
    setLastRequestWasForce(Boolean(payload.force));

    try {
      const response = await fetch("/api/ai/task-gate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
          handleStreamEvent(parseSseFrame(frame));
        }
      }

      buffer += decoder.decode();

      if (buffer.trim() && requestSeqRef.current === requestSeq) {
        handleStreamEvent(parseSseFrame(buffer));
      }
    } catch (streamError) {
      if (requestSeqRef.current !== requestSeq) {
        return;
      }

      if (controller.signal.aborted) {
        setError("已停止本次 AI 判断，输入未丢失。");
      } else {
        setError(
          streamError instanceof Error && streamError.message.startsWith("HTTP")
            ? "AI 任务准入接口暂时不可用。输入已保留，可以重试或手动新增。"
            : "AI 任务准入请求失败。输入已保留，可以重试或手动新增。",
        );
      }
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setIsStreaming(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runStream(basePayload);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      requestSeqRef.current += 1;
      abortRef.current?.abort();
    };
  }, [basePayload, initialPayload.requestKey, runStream]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  function handleStreamEvent(frame: SseFrame) {
    if (!frame.data) {
      return;
    }

    let event: TaskGateStreamEvent;

    try {
      event = JSON.parse(frame.data) as TaskGateStreamEvent;
    } catch {
      setError("AI 返回了无法解析的流式事件。输入已保留，可以重试或手动新增。");
      return;
    }

    if (event.type === "status") {
      setStatusLine(event.message);
    }

    if (event.type === "heartbeat") {
      setHeartbeatLine(`${event.message} ${Math.round(event.elapsedMs / 1000)} 秒`);
    }

    if (event.type === "thinking") {
      setStatusLine(
        `模型仍在分析是否值得生成任务，已收到 ${event.reasoningChars} 字符思考信号。`,
      );
      setReasoningChars(event.reasoningChars);
    }

    if (event.type === "drafting") {
      setStatusLine(event.message);
      setReceivedChars(event.receivedChars);
    }

    if (event.type === "result") {
      setResult(event.verdict);
      setStatusLine("判断完成。");
      setDialogMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          content: `${event.verdict.summary} ${event.verdict.reason}`.trim(),
        },
      ]);
    }

    if (event.type === "error") {
      setError(event.message);
    }
  }

  function closeDialog() {
    requestSeqRef.current += 1;
    abortRef.current?.abort();
    onClose();
  }

  function continueWithOption(option: TaskGateOption) {
    if (!result) {
      return;
    }

    if (option.intent === "dismiss") {
      closeDialog();
      return;
    }

    if (option.intent === "continue") {
      setShowSupplement(true);
      return;
    }

    const userMessage: TaskGateDialogMessage = {
      role: "user",
      content: option.value || option.label,
    };
    const nextMessages = [...dialogMessages, userMessage];

    setDialogMessages(nextMessages);
    setShowSupplement(false);
    setSupplement("");
    void runStream({
      ...basePayload,
      dialogMessages: nextMessages,
      previousVerdict: result,
      force: option.intent === "force",
    });
  }

  function forceGenerate() {
    if (!result) {
      return;
    }

    const userMessage: TaskGateDialogMessage = {
      role: "user",
      content: "我明确要强制生成一个最小任务草稿。",
    };
    const nextMessages = [...dialogMessages, userMessage];

    setDialogMessages(nextMessages);
    setShowSupplement(false);
    setSupplement("");
    void runStream({
      ...basePayload,
      dialogMessages: nextMessages,
      previousVerdict: result,
      force: true,
    });
  }

  function submitSupplement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = supplement.trim();

    if (!text) {
      return;
    }

    const nextMessages = [
      ...dialogMessages,
      {
        role: "user" as const,
        content: text,
      },
    ];

    setDialogMessages(nextMessages);
    setShowSupplement(false);
    setSupplement("");
    void runStream({
      ...basePayload,
      dialogMessages: nextMessages,
      previousVerdict: result || undefined,
      force: lastRequestWasForce,
    });
  }

  const contextSnapshot = result?.contextSnapshot;
  const isForceResult = lastRequestWasForce && Boolean(result?.taskDraft);

  return (
    <div
      aria-labelledby="task-gate-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid bg-black/75 px-3 py-4"
      role="dialog"
    >
      <div className="mx-auto grid max-h-[calc(100vh-2rem)] w-full max-w-6xl grid-rows-[auto_1fr] overflow-hidden border border-zinc-700 bg-[#080908] shadow-2xl shadow-black">
        <header className="grid gap-3 border-b border-zinc-800 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <p className="font-mono text-xs text-emerald-400">
                Task Gatekeeper
              </p>
              <h3
                className="text-lg font-semibold text-zinc-50"
                id="task-gate-dialog-title"
              >
                AI 任务准入对话
              </h3>
            </div>
            <button
              aria-label="关闭任务准入弹窗"
              className="min-h-9 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600 hover:text-zinc-50"
              type="button"
              onClick={closeDialog}
            >
              关闭
            </button>
          </div>
          <StreamStatus
            heartbeatLine={heartbeatLine}
            isStreaming={isStreaming}
            reasoningChars={reasoningChars}
            receivedChars={receivedChars}
            statusLine={statusLine}
          />
        </header>

        <div className="grid min-h-0 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="grid content-start gap-4 p-4">
            <OriginalIdea rawTask={initialPayload.rawTask} />

            {dialogMessages.length > 0 ? (
              <DialogHistory messages={dialogMessages} />
            ) : null}

            {error ? (
              <div className="border border-red-900 bg-red-950/30 p-3 text-sm leading-6 text-red-200">
                {error}
              </div>
            ) : null}

            {!result && !error ? (
              <div className="grid gap-2 border border-zinc-800 bg-black p-4 text-sm text-zinc-400">
                <div className="h-2 w-32 animate-pulse bg-zinc-800" />
                <p>
                  AI 正在先判断是否应该进入任务系统。这里不会展示完整模型推理，只展示可审计摘要和结果。
                </p>
              </div>
            ) : null}

            {result ? (
              <VerdictCard
                isForceResult={isForceResult}
                onClose={closeDialog}
                onForce={forceGenerate}
                onOption={continueWithOption}
                verdict={result}
              />
            ) : null}

            {showSupplement ? (
              <form
                className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3"
                onSubmit={submitSupplement}
              >
                <label className="grid gap-1.5 text-sm text-zinc-500">
                  补充一句
                  <textarea
                    className="min-h-24 border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
                    placeholder="例如：我不是想开新方向，我只是想验证小程序是否适合作为当前产品入口。"
                    value={supplement}
                    onChange={(event) => setSupplement(event.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className={primaryButtonClassName} type="submit">
                    继续判断
                  </button>
                  <button
                    className={secondaryButtonClassName}
                    type="button"
                    onClick={() => setShowSupplement(false)}
                  >
                    取消补充
                  </button>
                </div>
              </form>
            ) : null}
          </main>

          <ContextSummary snapshot={contextSnapshot} />
        </div>
      </div>
    </div>
  );
}

function StreamStatus({
  heartbeatLine,
  isStreaming,
  reasoningChars,
  receivedChars,
  statusLine,
}: {
  heartbeatLine: string;
  isStreaming: boolean;
  reasoningChars: number;
  receivedChars: number;
  statusLine: string;
}) {
  return (
    <div
      aria-live="polite"
      className="grid gap-2 border border-zinc-800 bg-black px-3 py-2 text-sm"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="leading-6 text-zinc-200">{statusLine}</div>
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
      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
        {heartbeatLine ? <span>{heartbeatLine}</span> : null}
        <span>thinking signal {reasoningChars}</span>
        <span>final JSON {receivedChars}</span>
      </div>
    </div>
  );
}

function OriginalIdea({ rawTask }: { rawTask: string }) {
  return (
    <section className="grid gap-2 border border-zinc-800 bg-black p-3">
      <div className="text-xs text-zinc-500">你的输入</div>
      <p className="break-words text-base leading-7 text-zinc-100">
        {rawTask}
      </p>
    </section>
  );
}

function DialogHistory({ messages }: { messages: TaskGateDialogMessage[] }) {
  return (
    <section className="grid gap-2">
      <div className="text-xs text-zinc-500">本次对话</div>
      <div className="grid gap-2">
        {messages.slice(-6).map((message, index) => (
          <div
            className={`grid gap-1 border p-3 text-sm ${
              message.role === "user"
                ? "border-zinc-700 bg-zinc-950 text-zinc-200"
                : "border-emerald-900/70 bg-emerald-950/10 text-zinc-300"
            }`}
            key={`${message.role}-${index}-${message.content}`}
          >
            <div className="text-xs text-zinc-500">
              {message.role === "user" ? "你" : "AI"}
            </div>
            <p className="break-words leading-6">{message.content}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function VerdictCard({
  isForceResult,
  onClose,
  onForce,
  onOption,
  verdict,
}: {
  isForceResult: boolean;
  onClose: () => void;
  onForce: () => void;
  onOption: (option: TaskGateOption) => void;
  verdict: TaskGateVerdict;
}) {
  const title = isForceResult
    ? "强制生成的任务草稿"
    : verdict.verdict === "reject"
      ? "暂不建议生成任务"
      : verdict.verdict === "ask"
        ? "需要先确认一个问题"
        : "建议生成任务";

  return (
    <section className="grid gap-4 border border-zinc-800 bg-black p-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={verdict.verdict} force={isForceResult} />
          <h4 className="text-lg font-semibold text-zinc-50">{title}</h4>
        </div>
        {isForceResult ? (
          <p className="border border-amber-900 bg-amber-950/25 px-3 py-2 text-sm leading-6 text-amber-100">
            这是你强制生成的任务，不代表系统推荐。默认放入任务池 inbox，并标记风险。
          </p>
        ) : null}
        <p className="break-words text-base leading-7 text-zinc-100">
          {verdict.summary}
        </p>
        <p className="break-words text-sm leading-6 text-zinc-400">
          {verdict.reason}
        </p>
      </div>

      {verdict.blockingQuestion ? (
        <div className="border border-amber-900 bg-amber-950/20 p-3">
          <div className="text-xs text-amber-300">阻塞问题</div>
          <p className="mt-1 break-words text-base leading-7 text-zinc-100">
            {verdict.blockingQuestion}
          </p>
        </div>
      ) : null}

      <EvidenceList evidence={verdict.evidence} />

      {verdict.forceDraftSuggestion && !verdict.taskDraft ? (
        <ForceSuggestion suggestion={verdict.forceDraftSuggestion} />
      ) : null}

      {verdict.taskDraft ? (
        <TaskDraftPreview
          forceMode={isForceResult}
          task={verdict.taskDraft}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {verdict.taskDraft ? null : (
          <button
            className={secondaryButtonClassName}
            type="button"
            onClick={onClose}
          >
            暂不生成
          </button>
        )}

        {verdict.options
          .filter((option) => {
            if (verdict.taskDraft && option.value === "save") {
              return false;
            }

            return true;
          })
          .map((option) => (
            <button
              className={optionClassName(option)}
              key={`${option.intent}-${option.value}-${option.label}`}
              type="button"
              onClick={() => onOption(option)}
            >
              {option.label}
            </button>
          ))}

        {!verdict.taskDraft &&
        !verdict.options.some((option) => option.intent === "force") ? (
          <button
            className={dangerButtonClassName}
            type="button"
            onClick={onForce}
          >
            强制生成
          </button>
        ) : null}
      </div>
    </section>
  );
}

function VerdictBadge({
  force,
  verdict,
}: {
  force: boolean;
  verdict: TaskGateVerdict["verdict"];
}) {
  const label = force
    ? "force"
    : verdict === "reject"
      ? "reject"
      : verdict === "ask"
        ? "ask"
        : "recommend";
  const className = force
    ? "border-amber-700 bg-amber-950/30 text-amber-200"
    : verdict === "recommend"
      ? "border-emerald-700 bg-emerald-500/10 text-emerald-300"
      : verdict === "reject"
        ? "border-red-900 bg-red-950/25 text-red-200"
        : "border-amber-900 bg-amber-950/25 text-amber-200";

  return (
    <span className={`border px-2 py-0.5 font-mono text-xs ${className}`}>
      {label}
    </span>
  );
}

function EvidenceList({ evidence }: { evidence: TaskGateEvidence[] }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs text-zinc-500">可审计依据</div>
      {evidence.length > 0 ? (
        <div className="grid gap-2">
          {evidence.slice(0, 5).map((item) => (
            <article
              className="grid gap-2 border border-zinc-800 bg-zinc-950/70 p-3 text-sm"
              key={`${item.sourceType}-${item.label}-${item.quote}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="border border-zinc-700 px-2 py-0.5 font-mono text-xs text-zinc-300">
                  {item.sourceType}
                </span>
                <span className="font-semibold text-zinc-100">
                  {item.label}
                </span>
              </div>
              <blockquote className="border-l border-zinc-700 pl-2 leading-6 text-zinc-300">
                {item.quote}
              </blockquote>
              <p className="break-words leading-6 text-zinc-400">
                {item.interpretation}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">暂无依据。</p>
      )}
    </div>
  );
}

function ForceSuggestion({
  suggestion,
}: {
  suggestion: NonNullable<TaskGateVerdict["forceDraftSuggestion"]>;
}) {
  return (
    <div className="grid gap-2 border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
      <div className="text-xs text-zinc-500">如果你强制执行，最多只能缩成</div>
      <div className="font-semibold text-zinc-100">{suggestion.title}</div>
      <div className="text-zinc-300">下一步：{suggestion.nextAction}</div>
      <div className="text-zinc-300">完成标准：{suggestion.doneWhen}</div>
      {suggestion.riskFlags.length > 0 ? (
        <div className="text-amber-200">
          风险：{suggestion.riskFlags.join("、")}
        </div>
      ) : null}
    </div>
  );
}

function TaskDraftPreview({
  forceMode,
  task,
}: {
  forceMode: boolean;
  task: ClarifiedTaskDraft;
}) {
  return (
    <div className="grid gap-4 border border-emerald-900/70 bg-emerald-950/10 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="grid min-w-0 gap-1">
          <div className="text-xs text-emerald-300">任务草稿</div>
          <h5 className="break-words text-base font-semibold text-zinc-50">
            {task.title}
          </h5>
        </div>
        <SaveGateTaskForm forceMode={forceMode} task={task} />
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <PreviewItem label="项目" value={task.project} />
        <PreviewItem label="优先级" value={task.priority} />
        <PreviewItem label="状态" value={task.status} />
        <PreviewItem label="Codex 适配" value={task.codexFit} />
        <PreviewItem label="负责人" value={task.owner} />
        <PreviewItem label="风险" value={task.riskFlags.join("、") || "无"} />
        <PreviewItem label="下一步" value={task.nextAction} wide />
        <PreviewItem label="完成标准" value={task.doneWhen} wide />
        <PreviewItem label="Do Not" value={task.doNot.join("、") || "无"} wide />
        <PreviewItem label="备注" value={task.notes || "无"} wide />
      </dl>
    </div>
  );
}

function SaveGateTaskForm({
  forceMode,
  task,
}: {
  forceMode: boolean;
  task: ClarifiedTaskDraft;
}) {
  const [planForToday, setPlanForToday] = useState(!forceMode);

  return (
    <form action={saveGateTaskAction} className="grid gap-2 md:w-64">
      <input type="hidden" name="taskJson" value={JSON.stringify(task)} />
      <input type="hidden" name="forceMode" value={forceMode ? "true" : "false"} />
      <input
        type="hidden"
        name="planForToday"
        value={planForToday ? "true" : "false"}
      />
      <label className="flex items-start gap-2 text-xs leading-5 text-zinc-400">
        <input
          checked={planForToday}
          className="mt-0.5 h-4 w-4 accent-emerald-500"
          type="checkbox"
          onChange={(event) => setPlanForToday(event.target.checked)}
        />
        {forceMode
          ? "同时加入今日四象限"
          : "写入后加入今日四象限"}
      </label>
      <SaveButton />
      {forceMode && !planForToday ? (
        <p className="text-xs leading-5 text-zinc-500">
          强制任务默认只进入任务池，不污染今日 P0。
        </p>
      ) : null}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className={primaryButtonClassName}
      disabled={pending}
      type="submit"
    >
      {pending ? "写入中…" : "写入任务"}
    </button>
  );
}

function PreviewItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`grid gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words leading-6 text-zinc-200">{value}</dd>
    </div>
  );
}

function ContextSummary({
  snapshot,
}: {
  snapshot?: TaskGateContextSnapshot;
}) {
  return (
    <aside className="grid content-start gap-3 border-t border-zinc-800 bg-black/70 p-4 lg:border-l lg:border-t-0">
      <div className="grid gap-1">
        <h4 className="text-sm font-semibold text-zinc-100">上下文摘要</h4>
        <p className="text-xs leading-5 text-zinc-500">
          结果返回后显示本次判断使用的上下文，不展示完整模型推理。
        </p>
      </div>

      {snapshot ? (
        <div className="grid gap-3 text-sm">
          <ContextItem label="当前愿景" value={snapshot.northStar} />
          <ContextItem label="当前重点" value={snapshot.currentFocus} />
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
            <ContextStat label="活跃任务" value={snapshot.activeTaskCount} />
            <ContextStat label="近期复盘" value={snapshot.recentReviewCount} />
            <ContextStat label="近期证据" value={snapshot.recentEvidenceCount} />
            <ContextStat
              label="产品拆解"
              value={snapshot.recentProductTeardownCount}
            />
            <ContextStat
              label="漂移模式"
              value={snapshot.recentDriftPatternCount}
            />
          </div>
          <div className="grid gap-2">
            <div className="text-xs text-zinc-500">漂移模式</div>
            {snapshot.driftPatterns.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {snapshot.driftPatterns.map((pattern) => (
                  <span
                    className="border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
                    key={pattern}
                  >
                    {pattern}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">暂无明显模式。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 text-sm text-zinc-500">
          <div className="h-8 animate-pulse bg-zinc-900" />
          <div className="h-8 animate-pulse bg-zinc-900" />
          <div className="h-20 animate-pulse bg-zinc-900" />
        </div>
      )}
    </aside>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="break-words leading-6 text-zinc-300">{value || "未设置"}</div>
    </div>
  );
}

function ContextStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-zinc-800 bg-zinc-950 px-2 py-2">
      <div className="text-zinc-500">{label}</div>
      <div className="font-mono text-base text-zinc-100">{value}</div>
    </div>
  );
}

function optionClassName(option: TaskGateOption) {
  if (option.intent === "force") {
    return dangerButtonClassName;
  }

  if (option.intent === "dismiss") {
    return secondaryButtonClassName;
  }

  if (option.intent === "revise_smaller") {
    return "min-h-10 border border-amber-800 bg-amber-950/25 px-3 py-2 text-sm font-semibold text-amber-100 hover:border-amber-600";
  }

  return secondaryButtonClassName;
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
  "min-h-10 border border-red-900 bg-red-950/30 px-3 py-2 text-sm font-semibold text-red-200 hover:border-red-700 hover:text-red-100";
