import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AiTaskClarifier } from "@/components/ai-task-clarifier";
import { CodexPacketPanel } from "@/components/codex-packet-panel";
import { ExportToast } from "@/components/export-toast";
import { GrowthLoopPanel } from "@/components/growth-loop-panel";
import {
  DeepSeekRequestError,
  MissingDeepSeekApiKeyError,
} from "@/lib/server/ai/deepseek";
import {
  AiDailyReviewInvalidJsonError,
  generateAiDailyReview,
} from "@/lib/server/ai/dailyReviewCoach";
import {
  AiWeeklyReviewInvalidJsonError,
  generateAiWeeklyReview,
} from "@/lib/server/ai/weeklyReviewCoach";
import { generateCodexPacket } from "@/lib/server/codexPacket";
import {
  DO_NOT_DO_LIST,
  chooseTodayP0,
  minimumActionFromP0,
  scheduleAdvice,
} from "@/lib/server/scoring";
import {
  TASK_STATUSES,
  createAiDailyReview,
  createAiWeeklyReview,
  createReview,
  createTask,
  exportDailyMarkdown,
  readStore,
  updateTask,
} from "@/lib/server/store";
import type {
  AiDailyReview,
  AiWeeklyReview,
  CodexFit,
  ProductTeardown,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TodayPageProps = {
  searchParams?: Promise<{
    exported?: string;
    review?: string;
    created?: string;
    aiReview?: string;
    aiReviewError?: string;
    context?: string;
  }>;
};

const priorities: TaskPriority[] = ["P0", "P1", "P2"];
const codexFits: CodexFit[] = ["high", "medium", "low", "none"];

const statusLabels: Record<TaskStatus, string> = {
  inbox: "收件箱",
  active: "推进中",
  codex_ready: "Codex 就绪",
  codex_running: "Codex 执行中",
  review: "待复核",
  waiting: "等待中",
  frozen: "冻结",
  done: "完成",
  dropped: "放弃",
};

const codexFitLabels: Record<CodexFit, string> = {
  high: "高",
  medium: "中",
  low: "低",
  none: "无",
};

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const params = await searchParams;
  const today = getTodayDate();
  const { weekStart, weekEnd } = getCurrentWeekRange(today);
  const store = await readStore();
  const tasks = [...store.tasks].sort((a, b) => a.code.localeCompare(b.code));
  const p0Decision = chooseTodayP0(tasks);
  const p0 = p0Decision.task;
  const aiReviewErrorMessage = getAiReviewErrorMessage(params?.aiReviewError);
  const latestReview = [...store.reviews]
    .reverse()
    .find((review) => review.date === today);
  const latestAiDailyReview = latestByCreatedAt(
    store.aiDailyReviews.filter((review) => review.date === today),
  );
  const latestAiWeeklyReview = latestByCreatedAt(
    store.aiWeeklyReviews.filter(
      (review) =>
        review.weekStart === weekStart && review.weekEnd === weekEnd,
    ),
  );
  const activeTasks = tasks.filter((task) =>
    ["inbox", "active", "codex_ready", "codex_running"].includes(task.status),
  );
  const codexReadyTasks = tasks.filter((task) =>
    ["codex_ready", "codex_running"].includes(task.status),
  );
  const waitingReviewTasks = tasks.filter((task) =>
    ["waiting", "review", "frozen"].includes(task.status),
  );
  const todayTeardowns = store.productTeardowns.filter(
    (teardown) => teardown.date === today,
  );
  const todayCodexRuns = store.codexRuns.filter((run) => run.date === today);
  const todayEvidence = store.evidence.filter((item) => item.date === today);
  const packets = tasks.map((task) => ({
    id: task.id,
    label: `${task.code} ${task.title}`,
    packet: generateCodexPacket(task),
  }));

  return (
    <main className="min-h-screen bg-[#080908] px-3 py-4 font-sans text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-[1480px] gap-4">
        <header className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs text-emerald-400">
              Personal SaaS OS
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-50 sm:text-3xl">
              今日任务跟踪
            </h1>
          </div>
          <div className="text-sm leading-6 text-zinc-500 md:text-right">
            <div>日期：{today} · 本地优先</div>
            <div>
              任务：{tasks.length} · 推进：{activeTasks.length} · 等待/复核：
              {waitingReviewTasks.length}
            </div>
          </div>
        </header>

        {params?.exported ? (
          <ExportToast filePath={decodeURIComponent(params.exported)} />
        ) : null}
        {params?.review === "saved" ? <Notice>每日复盘已保存。</Notice> : null}
        {params?.created === "task" ? <Notice>新任务已写入 SSOT。</Notice> : null}
        {params?.created === "product-teardown" ? (
          <Notice>产品拆解已保存。</Notice>
        ) : null}
        {params?.created === "ai-task" ? (
          <Notice>AI 整理后的任务已写入 SSOT。</Notice>
        ) : null}
        {params?.created === "ai-error" ? (
          <Notice>AI 整理后的任务写入失败，请重新生成预览。</Notice>
        ) : null}
        {params?.created === "codex-run" ? (
          <Notice>CodexRun 已记录。</Notice>
        ) : null}
        {params?.created === "codex-run-updated" ? (
          <Notice>CodexRun 状态已更新。</Notice>
        ) : null}
        {params?.created === "evidence" ? (
          <Notice>Evidence 已记录。</Notice>
        ) : null}
        {params?.context === "saved" ? (
          <Notice>OperatingContext 已保存。</Notice>
        ) : null}
        {params?.aiReview === "daily-saved" ? (
          <Notice>AI 每日复盘已生成并保存。</Notice>
        ) : null}
        {params?.aiReview === "weekly-saved" ? (
          <Notice>AI 每周复盘已生成并保存。</Notice>
        ) : null}
        {aiReviewErrorMessage ? <Notice>{aiReviewErrorMessage}</Notice> : null}

        <section className="grid gap-3 border border-emerald-900/60 bg-zinc-950/80 p-4">
          <SectionTitle eyebrow="01" title="今日 P0" />
          {p0 ? (
            <div className="grid gap-2 text-base">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{p0.priority}</Badge>
                <span className="font-mono text-emerald-300">{p0.code}</span>
                <span className="text-lg font-semibold text-zinc-50">{p0.title}</span>
              </div>
              <KeyValue label="当前可推进动作" value={p0.nextAction || "未填写"} />
              <KeyValue label="完成标准" value={p0.doneWhen || "未填写"} />
              <KeyValue label="为什么是 P0" value={p0Decision.reasons.join("；")} />
              <KeyValue label="安排建议" value={scheduleAdvice(p0Decision)} />
            </div>
          ) : (
            <p className="text-base text-zinc-400">
              当前没有 active 或 codex_ready 任务。先补齐一个可推进任务。
            </p>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
            <SectionTitle eyebrow="02" title="25 分钟最小动作" />
            <p className="text-base text-emerald-300">{minimumActionFromP0(p0)}</p>
          </section>

          <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
            <SectionTitle eyebrow="03" title="今日不做" />
            <ul className="grid gap-1 text-sm text-zinc-300 sm:grid-cols-2">
              {DO_NOT_DO_LIST.map((item) => (
                <li key={item} className="border-l border-zinc-700 pl-2">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3">
          <SectionTitle eyebrow="04" title="当前任务 SSOT" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
              <thead className="text-zinc-500">
                <tr className="border-y border-zinc-800">
                  <Th>优先级</Th>
                  <Th>任务</Th>
                  <Th>状态</Th>
                  <Th>Codex 适配度</Th>
                  <Th>当前可推进动作</Th>
                  <Th>完成标准</Th>
                  <Th>风险</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {activeTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <QueueSection
            eyebrow="05"
            title="Codex 队列"
            tasks={codexReadyTasks}
          />
          <QueueSection
            eyebrow="06"
            title="等待 / 复核"
            tasks={waitingReviewTasks}
          />
        </div>

        <ProductTeardownSummary productTeardowns={todayTeardowns} />

        <GrowthLoopPanel
          today={today}
          tasks={tasks}
          codexRuns={todayCodexRuns}
          evidence={todayEvidence}
          operatingContext={store.operatingContext}
        />

        <AiTaskClarifier />

        <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
          <SectionTitle eyebrow="10" title="新增任务" />
          <form action={createTaskAction} className="grid gap-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <Field label="任务标题">
                <input
                  className={inputClassName}
                  name="title"
                  required
                  placeholder="必须是具体任务"
                />
              </Field>
              <Field label="项目">
                <input
                  className={inputClassName}
                  name="project"
                  defaultValue="Personal SaaS OS"
                />
              </Field>
              <Field label="优先级">
                <select className={inputClassName} name="priority" defaultValue="P2">
                  {priorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </Field>
              <Field label="状态">
                <select className={inputClassName} name="status" defaultValue="inbox">
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Codex 适配度">
                <select
                  className={inputClassName}
                  name="codexFit"
                  defaultValue="medium"
                >
                  {codexFits.map((fit) => (
                    <option key={fit} value={fit}>
                      {codexFitLabels[fit]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="当前可推进动作">
                <input className={inputClassName} name="nextAction" />
              </Field>
              <Field label="完成标准">
                <input className={inputClassName} name="doneWhen" />
              </Field>
              <Field label="风险标签">
                <input
                  className={inputClassName}
                  name="riskFlags"
                  placeholder="逗号分隔，如 泛学习,任务过大"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button className={primaryButtonClassName} type="submit">
                写入 SSOT
              </button>
            </div>
          </form>
        </section>

        <section
          id="codex-packet-generator"
          className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3"
        >
          <SectionTitle eyebrow="11" title="Codex 任务包" />
          <CodexPacketPanel packets={packets} />
        </section>

        <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
          <SectionTitle eyebrow="12" title="晚间复盘" />
          <form action={createReviewAction} className="grid gap-3">
            <input type="hidden" name="date" value={today} />
            <input type="hidden" name="plannedP0" value={p0?.id || ""} />
            <div className="grid gap-2 lg:grid-cols-2">
              <Field label="今日真实产出">
                <textarea
                  className={textareaClassName}
                  name="actualOutput"
                  defaultValue={latestReview?.actualOutput}
                />
              </Field>
              <Field label="今日伪忙碌">
                <textarea
                  className={textareaClassName}
                  name="fakeProgress"
                  defaultValue={latestReview?.fakeProgress}
                />
              </Field>
              <Field label="偏离标签">
                <input
                  className={inputClassName}
                  name="driftFlags"
                  defaultValue={latestReview?.driftFlags.join(", ")}
                  placeholder="逗号分隔"
                />
              </Field>
              <Field label="明日 P0">
                <input
                  className={inputClassName}
                  name="tomorrowP0"
                  defaultValue={latestReview?.tomorrowP0}
                />
              </Field>
              <Field label="系统更新">
                <textarea
                  className={textareaClassName}
                  name="systemUpdate"
                  defaultValue={latestReview?.systemUpdate}
                  placeholder="今天的使用结果要求系统明天改变什么"
                />
              </Field>
              <Field label="备注">
                <textarea
                  className={textareaClassName}
                  name="notes"
                  defaultValue={latestReview?.notes}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button className={primaryButtonClassName} type="submit">
                保存复盘
              </button>
            </div>
          </form>
        </section>

        <AiReviewCoachSection
          dailyReview={latestAiDailyReview}
          weeklyReview={latestAiWeeklyReview}
          weekStart={weekStart}
          weekEnd={weekEnd}
        />

        <section className="grid gap-3 border border-emerald-900/70 bg-emerald-950/15 p-3">
          <SectionTitle eyebrow="14" title="导出 Markdown" />
          <p className="text-sm text-zinc-400">
            若设置 OBSIDIAN_VAULT_PATH，将写入 00-Daily；否则写入本项目 exports。
          </p>
          <form action={exportMarkdownAction}>
            <input type="hidden" name="date" value={today} />
            <button className={primaryButtonClassName} type="submit">
              导出今日 Markdown
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function TaskRow({ task }: { task: Task }) {
  const rowStatuses: TaskStatus[] = [
    "active",
    "codex_ready",
    "review",
    "waiting",
    "frozen",
    "done",
  ];

  return (
    <tr className="border-b border-zinc-900 align-top text-zinc-300">
      <Td>
        <Badge>{task.priority}</Badge>
      </Td>
      <Td>
        <div className="grid gap-1">
          <span className="font-mono text-emerald-300">{task.code}</span>
          <span className="font-semibold text-zinc-100">{task.title}</span>
          <span className="text-zinc-500">{task.project}</span>
        </div>
      </Td>
      <Td>{statusLabels[task.status]}</Td>
      <Td>{codexFitLabels[task.codexFit]}</Td>
      <Td className="max-w-72">{task.nextAction || "未填写"}</Td>
      <Td className="max-w-72">{task.doneWhen || "未填写"}</Td>
      <Td>{task.riskFlags.join(", ") || "无"}</Td>
      <Td>
        <div className="flex min-w-[26rem] flex-wrap gap-1.5">
          {rowStatuses.map((status) => (
            <form key={status} action={updateTaskStatusAction}>
              <input type="hidden" name="id" value={task.id} />
              <button
                className={`border px-2.5 py-1.5 text-xs ${
                  task.status === status
                    ? "border-emerald-700 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-800 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                }`}
                name="status"
                type="submit"
                value={status}
              >
                {statusLabels[status]}
              </button>
            </form>
          ))}
          <a
            className="border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
            href="#codex-packet-generator"
          >
            生成 Codex 包
          </a>
        </div>
      </Td>
    </tr>
  );
}

function QueueSection({
  eyebrow,
  title,
  tasks,
}: {
  eyebrow: string;
  title: string;
  tasks: Task[];
}) {
  return (
    <section className="grid gap-3 border border-zinc-800 bg-black p-3">
      <SectionTitle eyebrow={eyebrow} title={title} />
      {tasks.length > 0 ? (
        <div className="grid gap-2">
          {tasks.map((task) => (
            <div
              className="grid gap-1 border border-zinc-900 bg-zinc-950 p-2 text-sm"
              key={task.id}
            >
              <div className="flex flex-wrap gap-2">
                <span className="font-mono text-emerald-300">{task.code}</span>
                <span className="text-zinc-100">{task.title}</span>
                <span className="text-zinc-500">[{statusLabels[task.status]}]</span>
              </div>
              <div className="text-zinc-400">{task.nextAction || "未填写"}</div>
              {task.waitingFor ? (
                <div className="text-zinc-500">等待：{task.waitingFor}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-base text-zinc-500">暂无任务。</p>
      )}
    </section>
  );
}

function ProductTeardownSummary({
  productTeardowns,
}: {
  productTeardowns: ProductTeardown[];
}) {
  const progress = Math.min(productTeardowns.length, 3);

  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid gap-1">
          <SectionTitle eyebrow="07" title="今日 3 个产品拆解" />
          <p
            className={`text-sm ${
              progress < 3 ? "text-amber-200" : "text-emerald-300"
            }`}
          >
            {progress < 3
              ? "今天还没有完成 3 个产品拆解。不要刷信息，只记录 3 个。"
              : "今天已完成 3 个产品拆解。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>今日进度：{progress}/3</Badge>
          <a
            className="inline-flex min-h-10 items-center border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500 hover:text-black"
            href="/today/product-teardowns"
          >
            打开拆解页
          </a>
        </div>
      </div>

      {productTeardowns.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-sm">
          {productTeardowns.map((teardown) => (
            <span
              className="border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-300"
              key={teardown.id}
            >
              {teardown.productName}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">今天还没有产品拆解记录。</p>
      )}
    </section>
  );
}

function AiReviewCoachSection({
  dailyReview,
  weeklyReview,
  weekStart,
  weekEnd,
}: {
  dailyReview?: AiDailyReview;
  weeklyReview?: AiWeeklyReview;
  weekStart: string;
  weekEnd: string;
}) {
  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionTitle eyebrow="13" title="AI 复盘教练" />
        <div className="flex flex-wrap gap-2">
          <form action={generateTodayAiDailyReviewAction}>
            <button className={primaryButtonClassName} type="submit">
              生成今日 AI 复盘
            </button>
          </form>
          <form action={generateCurrentWeekAiWeeklyReviewAction}>
            <button className={secondaryButtonClassName} type="submit">
              生成本周 AI 复盘
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <AiDailyReviewCard review={dailyReview} />
        <AiWeeklyReviewCard
          review={weeklyReview}
          weekStart={weekStart}
          weekEnd={weekEnd}
        />
      </div>
    </section>
  );
}

function AiDailyReviewCard({ review }: { review?: AiDailyReview }) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3 text-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-zinc-100">
          今日 AI 每日复盘
        </h3>
        {review ? (
          <span className="font-mono text-xs text-zinc-500">
            {formatCreatedAt(review.createdAt)}
          </span>
        ) : null}
      </div>

      {review ? (
        <div className="grid gap-3">
          <ReviewDetail label="今日总结" value={review.summary} />
          <ReviewDetail label="真实产出" value={review.realOutput} />
          <ReviewDetail label="伪忙碌" value={review.fakeProgress} />
          <ReviewList label="成长信号" items={review.growthSignals} />
          <ReviewList label="偏离警告" items={review.driftWarnings} />
          <ReviewDetail
            label="产品判断力进展"
            value={review.productThinkingProgress}
          />
          <ReviewDetail label="执行力进展" value={review.executionProgress} />
          <ReviewDetail label="技术交付进展" value={review.technicalProgress} />
          <ReviewDetail label="明日建议" value={review.nextDaySuggestion} />
          <DailyScoreGrid review={review} />
        </div>
      ) : (
        <p className="text-zinc-500">今天还未生成 AI 每日复盘。</p>
      )}
    </article>
  );
}

function AiWeeklyReviewCard({
  review,
  weekStart,
  weekEnd,
}: {
  review?: AiWeeklyReview;
  weekStart: string;
  weekEnd: string;
}) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3 text-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-zinc-100">
          本周 AI 每周复盘
        </h3>
        <span className="font-mono text-xs text-zinc-500">
          {weekStart} - {weekEnd}
        </span>
      </div>

      {review ? (
        <div className="grid gap-3">
          <ReviewDetail label="本周总结" value={review.summary} />
          <ReviewList label="主要成长" items={review.mainGrowth} />
          <ReviewList label="重复偏离" items={review.repeatedDrifts} />
          <ReviewDetail
            label="产品判断力成长"
            value={review.productThinkingGrowth}
          />
          <ReviewDetail label="执行力成长" value={review.executionGrowth} />
          <ReviewDetail label="技术交付成长" value={review.technicalGrowth} />
          <ReviewDetail label="最强一天" value={review.strongestDay} />
          <ReviewDetail label="最弱一天" value={review.weakestDay} />
          <ReviewDetail label="下周唯一重点" value={review.nextWeekFocus} />
          <div className="grid gap-2 md:grid-cols-3">
            <ReviewList label="Stop" items={review.stopDoing} />
            <ReviewList label="Keep" items={review.keepDoing} />
            <ReviewList label="Start" items={review.startDoing} />
          </div>
        </div>
      ) : (
        <p className="text-zinc-500">本周还未生成 AI 每周复盘。</p>
      )}
    </article>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="break-words leading-6 text-zinc-300">
        {value || "未填写"}
      </div>
    </div>
  );
}

function ReviewList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-zinc-500">{label}</div>
      {items.length > 0 ? (
        <ul className="grid gap-1 text-zinc-300">
          {items.map((item) => (
            <li key={item} className="border-l border-zinc-800 pl-2 leading-6">
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

function DailyScoreGrid({ review }: { review: AiDailyReview }) {
  const scores = [
    ["执行", review.score.execution],
    ["产品判断", review.score.productThinking],
    ["技术交付", review.score.technicalShipping],
    ["抗偏离", review.score.antiDrift],
    ["复盘质量", review.score.reviewQuality],
  ] as const;

  return (
    <div className="grid gap-2">
      <div className="text-xs text-zinc-500">五个评分</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {scores.map(([label, score]) => (
          <div
            className="border border-zinc-800 bg-black px-2 py-2"
            key={label}
          >
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="font-mono text-lg font-semibold text-emerald-300">
              {score}/5
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-emerald-400">{eyebrow}</span>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="leading-7 text-zinc-300">{value}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-3 ${className}`}>{children}</td>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex border border-emerald-700 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300">
      {children}
    </span>
  );
}

async function updateTaskStatusAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "") as TaskStatus;

  if (!id || !TASK_STATUSES.includes(status)) {
    return;
  }

  await updateTask(id, { status });
  revalidatePath("/today");
}

async function createTaskAction(formData: FormData) {
  "use server";

  const title = String(formData.get("title") || "").trim();

  if (!title) {
    return;
  }

  await createTask({
    title,
    project: String(formData.get("project") || "Personal SaaS OS"),
    priority: String(formData.get("priority") || "P2") as TaskPriority,
    status: String(formData.get("status") || "inbox") as TaskStatus,
    codexFit: String(formData.get("codexFit") || "medium") as CodexFit,
    owner: "mixed",
    nextAction: String(formData.get("nextAction") || ""),
    doneWhen: String(formData.get("doneWhen") || ""),
    riskFlags: parseList(String(formData.get("riskFlags") || "")),
  });

  revalidatePath("/today");
  redirect("/today?created=task");
}

async function createReviewAction(formData: FormData) {
  "use server";

  await createReview({
    date: String(formData.get("date") || getTodayDate()),
    plannedP0: String(formData.get("plannedP0") || "") || undefined,
    actualOutput: String(formData.get("actualOutput") || ""),
    fakeProgress: String(formData.get("fakeProgress") || ""),
    driftFlags: parseList(String(formData.get("driftFlags") || "")),
    tomorrowP0: String(formData.get("tomorrowP0") || ""),
    systemUpdate: String(formData.get("systemUpdate") || ""),
    notes: String(formData.get("notes") || ""),
  });

  revalidatePath("/today");
  redirect("/today?review=saved");
}

async function generateTodayAiDailyReviewAction() {
  "use server";

  const today = getTodayDate();
  const store = await readStore();
  const currentTasks = store.tasks.filter((task) =>
    ["active", "codex_ready", "codex_running", "waiting", "review"].includes(
      task.status,
    ),
  );
  const touchedTasks = store.tasks.filter((task) =>
    taskTouchesDate(task, today),
  );
  const completedTasks = store.tasks.filter((task) =>
    taskCompletedOnDate(task, today),
  );
  const dailyReview = latestByCreatedAt(
    store.reviews.filter((review) => review.date === today),
  );
  const productTeardowns = store.productTeardowns.filter(
    (teardown) => teardown.date === today,
  );

  try {
    const review = await generateAiDailyReview({
      date: today,
      tasks: uniqueTasks([...touchedTasks, ...currentTasks]),
      completedTasks,
      currentTasks,
      dailyReview,
      productTeardowns,
      p0Decision: chooseTodayP0(store.tasks),
    });

    await createAiDailyReview({
      ...review,
      date: today,
    });
  } catch (error) {
    redirectAiReviewError(error);
  }

  revalidatePath("/today");
  redirect("/today?aiReview=daily-saved");
}

async function generateCurrentWeekAiWeeklyReviewAction() {
  "use server";

  const today = getTodayDate();
  const { weekStart, weekEnd } = getCurrentWeekRange(today);
  const store = await readStore();

  try {
    const review = await generateAiWeeklyReview({
      weekStart,
      weekEnd,
      tasks: store.tasks.filter((task) =>
        taskTouchesDateRange(task, weekStart, weekEnd),
      ),
      dailyReviews: store.reviews.filter((review) =>
        isDateInRange(review.date, weekStart, weekEnd),
      ),
      productTeardowns: store.productTeardowns.filter((teardown) =>
        isDateInRange(teardown.date, weekStart, weekEnd),
      ),
      aiDailyReviews: store.aiDailyReviews.filter((review) =>
        isDateInRange(review.date, weekStart, weekEnd),
      ),
    });

    await createAiWeeklyReview({
      ...review,
      weekStart,
      weekEnd,
    });
  } catch (error) {
    redirectAiReviewError(error);
  }

  revalidatePath("/today");
  redirect("/today?aiReview=weekly-saved");
}

async function exportMarkdownAction(formData: FormData) {
  "use server";

  const date = String(formData.get("date") || getTodayDate());
  const filePath = await exportDailyMarkdown(date);

  revalidatePath("/today");
  redirect(`/today?exported=${encodeURIComponent(filePath)}`);
}

function parseList(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAiReviewErrorMessage(error?: string) {
  if (error === "missing-key") {
    return "未配置 DEEPSEEK_API_KEY，无法生成 AI 复盘。";
  }

  if (error === "invalid-json") {
    return "AI 复盘返回内容不是合法 JSON，请重试。";
  }

  if (error === "request-failed") {
    return "AI 复盘生成失败，请检查网络、API Key 或模型配置。";
  }

  return "";
}

function redirectAiReviewError(error: unknown): never {
  if (error instanceof MissingDeepSeekApiKeyError) {
    redirect("/today?aiReviewError=missing-key");
  }

  if (
    error instanceof AiDailyReviewInvalidJsonError ||
    error instanceof AiWeeklyReviewInvalidJsonError
  ) {
    redirect("/today?aiReviewError=invalid-json");
  }

  if (error instanceof DeepSeekRequestError) {
    redirect("/today?aiReviewError=request-failed");
  }

  redirect("/today?aiReviewError=request-failed");
}

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function uniqueTasks(tasks: Task[]) {
  const seen = new Set<string>();

  return tasks.filter((task) => {
    if (seen.has(task.id)) {
      return false;
    }

    seen.add(task.id);
    return true;
  });
}

function taskTouchesDate(task: Task, date: string) {
  return [task.createdAt, task.updatedAt, task.completedAt].some(
    (timestamp) => dateFromTimestamp(timestamp) === date,
  );
}

function taskCompletedOnDate(task: Task, date: string) {
  return (
    dateFromTimestamp(task.completedAt) === date ||
    (task.status === "done" && dateFromTimestamp(task.updatedAt) === date)
  );
}

function taskTouchesDateRange(task: Task, start: string, end: string) {
  return [task.updatedAt, task.completedAt].some((timestamp) =>
    isDateInRange(dateFromTimestamp(timestamp), start, end),
  );
}

function dateFromTimestamp(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatAppDate(date);
}

function isDateInRange(date: string, start: string, end: string) {
  return Boolean(date) && date >= start && date <= end;
}

function getCurrentWeekRange(date: string) {
  const current = new Date(`${date}T00:00:00.000Z`);
  const day = current.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = addDays(date, mondayOffset);

  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
  };
}

function addDays(date: string, days: number) {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);

  return current.toISOString().slice(0, 10);
}

function getTodayDate() {
  return formatAppDate(new Date());
}

function formatAppDate(date: Date) {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCreatedAt(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

const inputClassName =
  "border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const textareaClassName =
  "min-h-24 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const primaryButtonClassName =
  "border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400";
const secondaryButtonClassName =
  "border border-zinc-700 bg-zinc-950 px-3 py-2 text-base font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300";
