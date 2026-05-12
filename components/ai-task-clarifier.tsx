"use client";

import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useFormStatus } from "react-dom";

import {
  clarifyTaskAction,
  saveClarifiedTaskAction,
} from "@/app/today/actions";
import type {
  AiDecisionTrace,
  AiTaskClarifierState,
  ClarifiedTaskDraft,
  NeedClarification,
} from "@/lib/types";
import type {
  DeepSeekModelInfo,
  DeepSeekReasoningEffort,
} from "@/lib/server/ai/deepseek";

const initialState: AiTaskClarifierState = { status: "idle" };
const modelLevelStorageKey = "personal-os.ai-task.model-level";
const modelLevelChangeEvent = "personal-os.ai-task.model-level-change";
const currentPhaseContext =
  "make Personal SaaS OS a daily-used task planning and review system";

export function AiTaskClarifier({
  modelInfo,
}: {
  modelInfo: DeepSeekModelInfo;
}) {
  const [state, formAction, isPending] = useActionState(
    clarifyTaskAction,
    initialState,
  );
  const [rawTask, setRawTask] = useState("");
  const [project, setProject] = useState("Personal SaaS OS");
  const modelLevel = useStoredModelLevel(
    modelInfo.defaultReasoningEffort,
  );

  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold text-zinc-100">
          AI 澄清真实需求并生成任务
        </h2>
        <p className="text-sm text-zinc-500">
          先结合愿景、近期任务、复盘、证据和产品拆解判断真实需求，再生成可执行任务。
        </p>
      </div>

      <form action={formAction} className="grid gap-3">
        <input
          type="hidden"
          name="currentPhaseContext"
          value={currentPhaseContext}
        />
        <input type="hidden" name="reasoningEffort" value={modelLevel} />
        <label className="grid gap-1 text-sm text-zinc-500">
          待整理任务
          <textarea
            className="min-h-28 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            name="rawTask"
            placeholder="例如：研究几个 SaaS 产品，拆出今天能推进的一步"
            required
            value={rawTask}
            onChange={(event) => setRawTask(event.target.value)}
          />
        </label>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <label className="grid gap-1 text-sm text-zinc-500">
            项目
            <input
              className="border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
              name="project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button
              className="border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isPending}
            >
              {isPending ? "澄清中..." : "澄清并生成任务"}
            </button>
          </div>
        </div>
      </form>

      {isPending ? <PendingClarifierStatus /> : null}

      {state.status === "error" ? (
        <div className="grid gap-2 border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">
          <p>{state.message}</p>
          {state.rawOutput ? (
            <textarea
              className="min-h-40 w-full border border-red-900 bg-black p-2 font-mono text-sm text-red-100"
              readOnly
              value={state.rawOutput}
            />
          ) : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div className="grid gap-3">
          <NeedClarificationPreview
            contextStats={state.contextStats}
            need={state.needClarification}
          />
          <DecisionTracePreview
            contextStats={state.contextStats}
            trace={state.decisionTrace}
          />
          <ClarificationFeedbackForm
            currentPhaseContext={currentPhaseContext}
            formAction={formAction}
            isPending={isPending}
            modelLevel={modelLevel}
            needClarification={state.needClarification}
            project={project}
            rawTask={rawTask}
          />
          <ClarifiedPreview task={state.task} rawOutput={state.rawOutput} />
        </div>
      ) : null}

      <AiModelSettings
        modelInfo={modelInfo}
        modelLevel={modelLevel}
        onModelLevelChange={saveStoredModelLevel}
      />
    </section>
  );
}

type ClarifierContextStats = Extract<
  AiTaskClarifierState,
  { status: "success" }
>["contextStats"];

function PendingClarifierStatus() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="border border-amber-900 bg-amber-950/25 px-3 py-2 text-sm leading-6 text-amber-100">
      正在请求 DeepSeek，已等待 {seconds} 秒。网络连接会自动重试，超过约 25 秒会返回明确错误。
    </div>
  );
}

function NeedClarificationPreview({
  need,
  contextStats,
}: {
  need: NeedClarification;
  contextStats?: ClarifierContextStats;
}) {
  return (
    <div className="grid gap-4 border border-emerald-900/70 bg-emerald-950/10 p-3">
      <div className="grid gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <p className="text-sm text-zinc-500">需求澄清</p>
            <h3 className="text-base font-semibold text-zinc-100">
              我理解你真正想推进的是
            </h3>
          </div>
          <span className="w-fit border border-emerald-700 bg-black px-2 py-1 font-mono text-xs text-emerald-300">
            confidence: {confidenceLabel(need.inferredRealNeed.confidence)}
          </span>
        </div>
        <p className="break-words text-sm leading-6 text-zinc-200">
          {need.inferredRealNeed.statement || "无"}
        </p>
        <KeyList label="证据" items={need.inferredRealNeed.evidence} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <NeedBlock title="你可能在逃避的是">
          <div className="grid gap-2 text-sm">
            <div className="font-semibold text-amber-200">
              {need.possibleAvoidance.pattern || "无明显模式"}
            </div>
            <p className="break-words leading-6 text-zinc-300">
              {need.possibleAvoidance.warning || "无"}
            </p>
            <KeyList label="依据" items={need.possibleAvoidance.evidence} />
          </div>
        </NeedBlock>

        <NeedBlock title="和长期愿景的关系">
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <ScoreBadge
                label="northStarFit"
                value={need.alignment.northStarFit}
              />
              <ScoreBadge
                label="currentFocusFit"
                value={need.alignment.currentFocusFit}
              />
            </div>
            <p className="break-words text-sm leading-6 text-zinc-300">
              {need.alignment.whyThisMatters || "无"}
            </p>
          </div>
        </NeedBlock>
      </div>

      <NeedBlock title="本次用到的上下文">
        <div className="grid gap-3">
          {contextStats ? (
            <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
              <ContextStat label="活跃任务" value={contextStats.activeTaskCount} />
              <ContextStat
                label="近期复盘"
                value={contextStats.recentReviewCount}
              />
              <ContextStat
                label="近期证据"
                value={contextStats.recentEvidenceCount}
              />
              <ContextStat
                label="产品拆解"
                value={contextStats.recentProductTeardownCount}
              />
              <ContextStat
                label="漂移模式"
                value={contextStats.recentDriftPatternCount}
              />
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <KeyList
              label="愿景 / 原则"
              items={need.contextUsed.operatingContext}
            />
            <KeyList label="任务" items={need.contextUsed.tasks} />
            <KeyList label="复盘" items={need.contextUsed.reviews} />
            <KeyList label="证据" items={need.contextUsed.evidence} />
            <KeyList
              label="产品拆解"
              items={need.contextUsed.productTeardowns}
            />
            <KeyList
              label="漂移模式"
              items={need.contextUsed.driftPatterns}
            />
          </div>
        </div>
      </NeedBlock>

      <NeedBlock title="候选任务">
        <div className="grid gap-2">
          {need.candidateTasks.length > 0 ? (
            need.candidateTasks.map((candidate) => (
              <CandidateTaskPreview
                candidate={candidate}
                key={`${candidate.title}-${candidate.nextAction}`}
              />
            ))
          ) : (
            <p className="text-sm text-zinc-500">无</p>
          )}
        </div>
      </NeedBlock>

      <div className="grid gap-3 md:grid-cols-2">
        <NeedBlock title="仍需确认的问题">
          <KeyList items={need.missingQuestions} />
        </NeedBlock>
        <NeedBlock title="AI 推荐">
          <p className="break-words text-sm leading-6 text-zinc-300">
            {need.recommendation || "无"}
          </p>
        </NeedBlock>
      </div>
    </div>
  );
}

function DecisionTracePreview({
  contextStats,
  trace,
}: {
  contextStats?: ClarifierContextStats;
  trace: AiDecisionTrace;
}) {
  const displayContextStats =
    contextStats ?? trace.contextSummary.contextStats;

  return (
    <div className="grid gap-4 border border-zinc-800 bg-black p-3">
      <div className="grid gap-1">
        <p className="text-sm text-zinc-500">AI 决策逻辑</p>
        <h3 className="break-words text-base font-semibold text-zinc-100">
          {trace.decisionQuestion || "本次应该生成什么任务？"}
        </h3>
      </div>

      <NeedBlock title="使用的上下文">
        <div className="grid gap-3 text-sm">
          <div className="grid gap-2 md:grid-cols-2">
            <PreviewItem
              label="North Star"
              value={trace.contextSummary.northStar || "无"}
            />
            <PreviewItem
              label="Current Focus"
              value={trace.contextSummary.currentFocus || "无"}
            />
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
            <ContextStat
              label="活跃任务"
              value={displayContextStats.activeTaskCount}
            />
            <ContextStat
              label="近期复盘"
              value={displayContextStats.recentReviewCount}
            />
            <ContextStat
              label="近期证据"
              value={displayContextStats.recentEvidenceCount}
            />
            <ContextStat
              label="产品拆解"
              value={displayContextStats.recentProductTeardownCount}
            />
            <ContextStat
              label="漂移模式"
              value={displayContextStats.recentDriftPatternCount}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <KeyList
              label="使用的反目标"
              items={trace.contextSummary.antiGoalsUsed}
            />
            <KeyList
              label="使用的原则"
              items={trace.contextSummary.principlesUsed}
            />
          </div>
        </div>
      </NeedBlock>

      <NeedBlock title="关键证据 / 信号">
        {trace.signals.length > 0 ? (
          <div className="grid gap-2">
            {trace.signals.map((signal) => (
              <article
                className="grid gap-2 border border-zinc-800 bg-zinc-950/70 p-3 text-sm"
                key={`${signal.sourceType}-${signal.sourceId || signal.label}-${signal.quote}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="border border-zinc-700 px-2 py-0.5 font-mono text-xs text-zinc-300">
                    {signal.sourceType}
                  </span>
                  <span className="font-semibold text-zinc-100">
                    {signal.label}
                  </span>
                  <span className="text-xs text-zinc-500">
                    强度：{strengthLabel(signal.strength)}
                  </span>
                </div>
                <blockquote className="border-l border-emerald-900 pl-2 leading-6 text-zinc-300">
                  {signal.quote || "无引用"}
                </blockquote>
                <p className="break-words leading-6 text-zinc-400">
                  {signal.interpretation || "无解释"}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">无</p>
        )}
      </NeedBlock>

      <NeedBlock title="候选任务对比">
        <div className="grid gap-2">
          {trace.candidateComparison.map((candidate) => (
            <article
              className="grid gap-2 border border-zinc-800 bg-zinc-950/70 p-3 text-sm"
              key={`${candidate.title}-${candidate.decision}`}
            >
              <div className="flex flex-wrap items-start gap-2">
                <DecisionBadge decision={candidate.decision} />
                <h4 className="min-w-0 flex-1 break-words font-semibold text-zinc-100">
                  {candidate.title}
                </h4>
              </div>
              <p className="break-words leading-6 text-zinc-400">
                {candidate.whyConsidered}
              </p>
              <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                <ScoreBadge label="愿景匹配" value={candidate.northStarFit} />
                <ScoreBadge
                  label="当前阶段"
                  value={candidate.currentFocusFit}
                />
                <ScoreBadge
                  label="证据潜力"
                  value={candidate.evidencePotential}
                />
                <ScoreBadge
                  label="逃避风险"
                  value={candidate.avoidanceRisk}
                />
              </div>
              <div className="text-xs text-zinc-500">
                effort: {effortLabel(candidate.effortLevel)}
              </div>
              <p className="break-words leading-6 text-zinc-300">
                {candidate.reason}
              </p>
            </article>
          ))}
        </div>
      </NeedBlock>

      <NeedBlock title="规则介入">
        {trace.guardrailsApplied.length > 0 ? (
          <div className="grid gap-2">
            {trace.guardrailsApplied.map((guardrail) => (
              <div
                className="grid gap-1 border border-zinc-800 bg-zinc-950/70 p-3 text-sm"
                key={`${guardrail.rule}-${guardrail.triggeredBy}`}
              >
                <div className="font-semibold text-zinc-100">
                  {guardrail.rule}
                </div>
                <div className="text-zinc-400">
                  触发：{guardrail.triggeredBy || "无"}
                </div>
                <div className="text-zinc-300">
                  影响：{guardrail.effect || "无"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">无明确规则介入。</p>
        )}
      </NeedBlock>

      <div className="grid gap-3 md:grid-cols-2">
        <NeedBlock title="最终选择">
          <div className="grid gap-2 text-sm">
            <div className="font-semibold text-emerald-200">
              {trace.finalDecision.selectedTitle || "无"}
            </div>
            <p className="break-words leading-6 text-zinc-300">
              {trace.finalDecision.whyThisNow || "无"}
            </p>
            <KeyList
              label="为什么不是其他任务"
              items={trace.finalDecision.whyNotOthers}
            />
            <div className="border-t border-zinc-900 pt-2 text-zinc-300">
              最小动作：{trace.finalDecision.smallestNextAction || "无"}
            </div>
            <div className="text-zinc-300">
              完成标准：{trace.finalDecision.doneWhen || "无"}
            </div>
          </div>
        </NeedBlock>

        <NeedBlock title="可讨论的问题">
          <KeyList items={trace.discussionPrompts} />
        </NeedBlock>
      </div>
    </div>
  );
}

function NeedBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2 border border-zinc-800 bg-black/70 p-3">
      <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
      {children}
    </section>
  );
}

function KeyList({ label, items = [] }: { label?: string; items?: string[] }) {
  return (
    <div className="grid gap-1 text-sm">
      {label ? <div className="text-xs text-zinc-500">{label}</div> : null}
      {items.length > 0 ? (
        <ul className="grid gap-1 text-zinc-300">
          {items.map((item) => (
            <li className="border-l border-zinc-800 pl-2 leading-6" key={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500">无</p>
      )}
    </div>
  );
}

function ScoreBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className="border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-zinc-200">
      {label}: {value}/100
    </span>
  );
}

function ContextStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="border border-zinc-800 bg-zinc-950 px-2 py-1">
      {label} {value}
    </span>
  );
}

function CandidateTaskPreview({
  candidate,
}: {
  candidate: NeedClarification["candidateTasks"][number];
}) {
  return (
    <article className="grid gap-2 border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
      <div className="flex flex-wrap items-start gap-2">
        {candidate.recommended ? (
          <span className="border border-emerald-700 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            推荐
          </span>
        ) : null}
        <h5 className="min-w-0 flex-1 break-words font-semibold text-zinc-100">
          {candidate.title}
        </h5>
      </div>
      <p className="break-words leading-6 text-zinc-400">
        {candidate.whyThisTask}
      </p>
      <div className="grid gap-1 text-zinc-300">
        <div>下一步：{candidate.nextAction || "无"}</div>
        <div>完成标准：{candidate.doneWhen || "无"}</div>
        <div>风险：{candidate.riskFlags.join("，") || "无"}</div>
      </div>
    </article>
  );
}

function confidenceLabel(value: NeedClarification["inferredRealNeed"]["confidence"]) {
  if (value === "high") {
    return "高";
  }

  if (value === "medium") {
    return "中";
  }

  return "低";
}

function strengthLabel(value: AiDecisionTrace["signals"][number]["strength"]) {
  if (value === "strong") {
    return "强";
  }

  if (value === "medium") {
    return "中";
  }

  return "弱";
}

function effortLabel(
  value: AiDecisionTrace["candidateComparison"][number]["effortLevel"],
) {
  if (value === "large") {
    return "大";
  }

  if (value === "medium") {
    return "中";
  }

  return "小";
}

function DecisionBadge({
  decision,
}: {
  decision: AiDecisionTrace["candidateComparison"][number]["decision"];
}) {
  const label =
    decision === "recommended"
      ? "推荐"
      : decision === "alternative"
        ? "备选"
        : "排除";
  const className =
    decision === "recommended"
      ? "border-emerald-700 bg-emerald-500/10 text-emerald-300"
      : decision === "alternative"
        ? "border-zinc-700 bg-black text-zinc-300"
        : "border-amber-900 bg-amber-950/30 text-amber-200";

  return (
    <span className={`border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function AiModelSettings({
  modelInfo,
  modelLevel,
  onModelLevelChange,
}: {
  modelInfo: DeepSeekModelInfo;
  modelLevel: DeepSeekReasoningEffort;
  onModelLevelChange: (level: DeepSeekReasoningEffort) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function updateLevel(level: DeepSeekReasoningEffort) {
    onModelLevelChange(level);
  }

  return (
    <div className="grid gap-3 border border-zinc-900 bg-zinc-950/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold text-zinc-100">AI 设置</h3>
          <p className="text-xs leading-5 text-zinc-500">
            当前模型 {modelInfo.model}，整理等级 {modelLevel}
          </p>
        </div>
        <button
          className="w-fit border border-zinc-700 bg-black px-3 py-2 text-sm font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300"
          type="button"
          onClick={() => setIsOpen(true)}
        >
          查看 / 调整
        </button>
      </div>

      {isOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6"
          role="dialog"
        >
          <div className="grid max-h-[calc(100vh-3rem)] w-full max-w-xl gap-4 overflow-y-auto border border-zinc-700 bg-[#080908] p-4 shadow-2xl shadow-black">
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-1">
                <h3 className="text-lg font-semibold text-zinc-50">AI 设置</h3>
                <p className="text-sm leading-6 text-zinc-500">
                  只影响 AI 任务梳理。API Key 状态只显示是否已配置，不显示具体内容。
                </p>
              </div>
              <button
                aria-label="关闭 AI 设置"
                className="border border-zinc-800 px-2 py-1 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
            </div>

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <SettingsItem label="供应商" value={modelInfo.provider} />
              <SettingsItem label="模型" value={modelInfo.model} />
              <SettingsItem label="接口" value={modelInfo.endpointHost} />
              <SettingsItem
                label="Thinking"
                value={modelInfo.thinkingEnabled ? "已启用" : "未启用"}
              />
              <SettingsItem
                label="API Key"
                value={modelInfo.apiKeyConfigured ? "已配置" : "未配置"}
              />
              <SettingsItem
                label="环境默认等级"
                value={modelInfo.defaultReasoningEffort}
              />
            </dl>

            <div className="grid gap-2">
              <div className="text-sm font-semibold text-zinc-100">
                模型等级
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ModelLevelButton
                  active={modelLevel === "high"}
                  description="日常任务整理，速度和质量更均衡。"
                  level="high"
                  onSelect={updateLevel}
                />
                <ModelLevelButton
                  active={modelLevel === "max"}
                  description="更强推理，适合模糊、复杂或高风险任务。"
                  level="max"
                  onSelect={updateLevel}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                className="border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useStoredModelLevel(defaultLevel: DeepSeekReasoningEffort) {
  return useSyncExternalStore(
    subscribeToModelLevel,
    () => readStoredModelLevel(defaultLevel),
    () => defaultLevel,
  );
}

function subscribeToModelLevel(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(modelLevelChangeEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(modelLevelChangeEvent, onStoreChange);
  };
}

function readStoredModelLevel(defaultLevel: DeepSeekReasoningEffort) {
  if (typeof window === "undefined") {
    return defaultLevel;
  }

  const saved = window.localStorage.getItem(modelLevelStorageKey);

  return saved === "high" || saved === "max" ? saved : defaultLevel;
}

function saveStoredModelLevel(level: DeepSeekReasoningEffort) {
  window.localStorage.setItem(modelLevelStorageKey, level);
  window.dispatchEvent(new Event(modelLevelChangeEvent));
}

function SettingsItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border border-zinc-900 bg-black px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words font-mono text-sm text-zinc-200">{value}</dd>
    </div>
  );
}

function ModelLevelButton({
  active,
  description,
  level,
  onSelect,
}: {
  active: boolean;
  description: string;
  level: DeepSeekReasoningEffort;
  onSelect: (level: DeepSeekReasoningEffort) => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`grid gap-1 border px-3 py-3 text-left ${
        active
          ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
          : "border-zinc-800 bg-black text-zinc-300 hover:border-zinc-600"
      }`}
      type="button"
      onClick={() => onSelect(level)}
    >
      <span className="font-mono text-base font-semibold">{level}</span>
      <span className="text-xs leading-5 text-zinc-500">{description}</span>
    </button>
  );
}

function ClarifiedPreview({
  task,
  rawOutput,
}: {
  task: ClarifiedTaskDraft;
  rawOutput: string;
}) {
  return (
    <div className="grid gap-3 border border-zinc-800 bg-black p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-zinc-500">任务预览</p>
          <h3 className="text-base font-semibold text-zinc-100">{task.title}</h3>
        </div>
        <form action={saveClarifiedTaskAction} className="grid gap-2">
          <input type="hidden" name="taskJson" value={JSON.stringify(task)} />
          <p className="max-w-xs text-xs leading-5 text-zinc-500">
            写入后会进入今日任务，并按优先级和风险自动放入四象限。
          </p>
          <SaveButton />
        </form>
      </div>

      <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <PreviewItem label="项目" value={task.project} />
        <PreviewItem label="优先级" value={task.priority} />
        <PreviewItem label="状态" value={task.status} />
        <PreviewItem label="Codex 适配度" value={task.codexFit} />
        <PreviewItem label="负责人" value={task.owner} />
        <PreviewItem label="风险" value={task.riskFlags.join(", ") || "无"} />
        <PreviewItem label="25 分钟动作" value={task.nextAction} wide />
        <PreviewItem label="完成标准" value={task.doneWhen} wide />
        <PreviewItem label="Do Not" value={task.doNot.join("；") || "无"} wide />
        <PreviewItem label="备注" value={task.notes || "无"} wide />
      </dl>

      <details className="text-sm text-zinc-500">
        <summary className="cursor-pointer text-zinc-400">查看原始输出</summary>
        <textarea
          className="mt-2 min-h-56 w-full border border-zinc-800 bg-zinc-950 p-2 font-mono text-sm text-zinc-300"
          readOnly
          value={rawOutput}
        />
      </details>
    </div>
  );
}

function ClarificationFeedbackForm({
  currentPhaseContext,
  formAction,
  isPending,
  modelLevel,
  needClarification,
  project,
  rawTask,
}: {
  currentPhaseContext: string;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  modelLevel: DeepSeekReasoningEffort;
  needClarification: NeedClarification;
  project: string;
  rawTask: string;
}) {
  return (
    <form
      action={formAction}
      className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3"
    >
      <input type="hidden" name="rawTask" value={rawTask} />
      <input type="hidden" name="project" value={project} />
      <input
        type="hidden"
        name="currentPhaseContext"
        value={currentPhaseContext}
      />
      <input type="hidden" name="reasoningEffort" value={modelLevel} />
      <input
        type="hidden"
        name="previousNeedClarificationJson"
        value={JSON.stringify(needClarification)}
      />
      <div className="grid gap-1">
        <h3 className="text-base font-semibold text-zinc-100">
          我想修正 AI 的理解
        </h3>
        <p className="text-sm leading-6 text-zinc-500">
          这段反馈只用于本次重新澄清，不会写入任务或持久化。
        </p>
      </div>
      <label className="grid gap-1 text-sm text-zinc-500">
        补充反馈
        <textarea
          className="min-h-28 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
          name="clarificationFeedback"
          placeholder="例如：我不是想继续打磨系统，我真正想解决的是 AI 不知道如何结合我的长期愿景和近期复盘来生成任务。"
          required
        />
      </label>
      <div>
        <FeedbackSubmitButton disabled={isPending} />
      </div>
    </form>
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
    <div className={`grid gap-1 ${wide ? "md:col-span-2 xl:col-span-3" : ""}`}>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200">{value}</dd>
    </div>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={pending}
    >
      {pending ? "写入中..." : "写入任务"}
    </button>
  );
}

function FeedbackSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      className="border border-zinc-700 bg-black px-3 py-2 text-base font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
      disabled={isDisabled}
    >
      {isDisabled ? "重新澄清中..." : "带着我的反馈重新澄清"}
    </button>
  );
}
