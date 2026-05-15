import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AiTaskClarifier } from "@/components/ai-task-clarifier";
import { PersonalCoach } from "@/components/personal-coach";
import { generateCodexPacket } from "@/lib/server/codexPacket";
import {
  DeepSeekRequestError,
  getDeepSeekModelInfo,
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
import { chooseTodayP0 } from "@/lib/server/scoring";
import {
  archiveMonthlyGoal,
  createAiDailyReview,
  createAiWeeklyReview,
  createMonthlyGoal,
  createTask,
  createReview,
  deleteTask,
  exportDailyMarkdown,
  readStore,
  TASK_STATUSES,
  updateOperatingContext,
  updateTask,
} from "@/lib/server/store";
import type {
  AiDailyReview,
  AiWeeklyReview,
  CodexFit,
  DailyReview,
  MonthlyGoal,
  MonthlyGoalStatus,
  OperatingContext,
  Task,
  TaskPriority,
  TaskQuadrant,
  TaskStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TodayPageProps = {
  searchParams?: Promise<{
    view?: string;
    review?: string;
    aiReview?: string;
    aiReviewError?: string;
    created?: string;
    deleted?: string;
    exported?: string;
    profile?: string;
  }>;
};

type TodayView = "tasks" | "review" | "new-task" | "profile";

const priorities: TaskPriority[] = ["P0", "P1", "P2"];
const manualTaskStatuses: TaskStatus[] = [
  "inbox",
  "active",
  "codex_ready",
  "waiting",
  "frozen",
];
const codexFits: CodexFit[] = ["high", "medium", "low", "none"];

const viewTitles: Record<TodayView, string> = {
  tasks: "今日任务",
  review: "今日复盘",
  "new-task": "AI 任务准入",
  profile: "个人信息",
};

const monthlyGoalStatusLabels: Record<MonthlyGoalStatus, string> = {
  active: "进行中",
  done: "已完成",
  paused: "暂停",
  archived: "已归档",
};

const legacyTodayStatuses: TaskStatus[] = [
  "active",
  "codex_ready",
  "codex_running",
  "review",
];

const statusActions: Array<{ status: TaskStatus; label: string }> = [
  { status: "active", label: "推进中" },
  { status: "codex_ready", label: "Codex 就绪" },
  { status: "waiting", label: "等待" },
  { status: "done", label: "完成" },
];

const statusLabels: Record<TaskStatus, string> = {
  inbox: "收件箱",
  active: "推进中",
  codex_ready: "Codex 就绪",
  codex_running: "Codex 执行中",
  review: "复核",
  waiting: "等待",
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

const quadrants: Array<{
  id: TaskQuadrant;
  title: string;
  description: string;
}> = [
  {
    id: "important_urgent",
    title: "I 重要且紧急",
    description: "今天必须推进",
  },
  {
    id: "important_not_urgent",
    title: "II 重要不紧急",
    description: "长期重要，避免被忽略",
  },
  {
    id: "urgent_not_important",
    title: "III 不重要但紧急",
    description: "能委托就委托，能批处理就批处理",
  },
  {
    id: "not_urgent_not_important",
    title: "IV 不重要不紧急",
    description: "今天不碰",
  },
];

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const params = await searchParams;
  const view = parseView(params?.view);
  const today = getTodayDate();
  const { weekStart, weekEnd } = getCurrentWeekRange(today);
  const store = await readStore();
  const tasks = [...store.tasks].sort((a, b) => a.code.localeCompare(b.code));
  const productTeardowns = store.productTeardowns.filter(
    (teardown) => teardown.date === today,
  );
  const latestReview = latestByCreatedAt(
    store.reviews.filter((review) => review.date === today),
  );
  const latestAiDailyReview = latestByCreatedAt(
    store.aiDailyReviews.filter((review) => review.date === today),
  );
  const latestAiWeeklyReview = latestByCreatedAt(
    store.aiWeeklyReviews.filter(
      (review) =>
        review.weekStart === weekStart && review.weekEnd === weekEnd,
    ),
  );
  const p0Decision = chooseTodayP0(tasks);
  const currentP0 = chooseExplicitOrFallbackP0(tasks, today, p0Decision.task);
  const notices = getNotices(params);
  const aiModelInfo = getDeepSeekModelInfo();

  return (
    <main className="min-h-screen bg-[#080908] px-3 py-4 font-sans text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-[1480px] gap-4 lg:grid-cols-[14rem_1fr]">
        <TodaySidebar activeView={view} />

        <div className="grid min-w-0 gap-4">
          <header className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-mono text-xs text-emerald-400">
                Personal SaaS OS
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-zinc-50 sm:text-3xl">
                {viewTitles[view]}
              </h1>
            </div>
            <div className="text-sm leading-6 text-zinc-500 md:text-right">
              <div>日期：{today}</div>
              <div>本地 JSON 存储 · Chrome 本地使用</div>
            </div>
          </header>

          {notices.length > 0 ? (
            <div className="grid gap-2">
              {notices.map((notice) => (
                <Notice key={notice}>{notice}</Notice>
              ))}
            </div>
          ) : null}

          {view === "tasks" ? (
            <TodayTasksView
              aiModelInfo={aiModelInfo}
              today={today}
              tasks={tasks}
              productTeardownCount={productTeardowns.length}
            />
          ) : null}

          {view === "review" ? (
            <ReviewView
              currentP0={currentP0}
              dailyReview={latestAiDailyReview}
              latestReview={latestReview}
              weeklyReview={latestAiWeeklyReview}
              weekEnd={weekEnd}
              weekStart={weekStart}
              today={today}
            />
          ) : null}

          {view === "new-task" ? (
            <NewTaskView aiModelInfo={aiModelInfo} today={today} />
          ) : null}

          {view === "profile" ? (
            <ProfileView
              currentMonth={today.slice(0, 7)}
              monthlyGoals={store.monthlyGoals || []}
              operatingContext={store.operatingContext}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function TodayTasksView({
  aiModelInfo,
  today,
  tasks,
  productTeardownCount,
}: {
  aiModelInfo: ReturnType<typeof getDeepSeekModelInfo>;
  today: string;
  tasks: Task[];
  productTeardownCount: number;
}) {
  const plannedTasks = tasks.filter((task) => isPlannedForToday(task, today));
  const plannedP0 = plannedTasks.find(
    (task) => task.plannedFor === today && task.priority === "P0",
  );
  const fallbackP0 = chooseTodayP0(tasks).task;
  const todayP0 = plannedP0 || fallbackP0;
  const productProgress = Math.min(productTeardownCount, 3);

  return (
    <div className="grid gap-4">
      <PersonalCoach modelInfo={aiModelInfo} />
      <FocusPanel task={todayP0} />
      <ProgressPanel
        productProgress={productProgress}
        todayTasks={plannedTasks}
      />
      <QuadrantGrid
        productProgress={productProgress}
        tasks={plannedTasks}
      />
      <TaskPool tasks={tasks} today={today} />
    </div>
  );
}

function NewTaskView({
  today,
  aiModelInfo,
}: {
  today: string;
  aiModelInfo: ReturnType<typeof getDeepSeekModelInfo>;
}) {
  return (
    <div className="grid gap-4">
      <AiTaskClarifier modelInfo={aiModelInfo} />
      <ManualTaskSection today={today} />
    </div>
  );
}

function ProfileView({
  currentMonth,
  monthlyGoals,
  operatingContext,
}: {
  currentMonth: string;
  monthlyGoals: MonthlyGoal[];
  operatingContext: OperatingContext;
}) {
  const sortedGoals = [...monthlyGoals].sort(
    (a, b) =>
      b.month.localeCompare(a.month) || b.updatedAt.localeCompare(a.updatedAt),
  );
  const currentGoal = sortedGoals.find(
    (goal) => goal.month === currentMonth && goal.status !== "archived",
  );

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 border border-zinc-800 bg-black/80 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-1">
            <SectionTitle title="长期愿景" />
            <p className="text-sm text-zinc-500">
              这组信息会进入 AI 问答、任务准入和复盘的固定上下文。
            </p>
          </div>
          <span className="font-mono text-xs text-zinc-600">
            更新：{formatCreatedAt(operatingContext.updatedAt)}
          </span>
        </div>

        <form action={updateOperatingContextAction} className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="长期愿景">
              <textarea
                className={textareaClassName}
                defaultValue={operatingContext.northStar}
                name="northStar"
                placeholder="例如：持续交付可收费的独立 SaaS 产品"
                required
              />
            </Field>
            <Field label="当前关注">
              <textarea
                className={textareaClassName}
                defaultValue={operatingContext.currentFocus}
                name="currentFocus"
                placeholder="例如：本月只围绕一个最小闭环推进"
                required
              />
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Field label="当前约束">
              <textarea
                className={textareaClassName}
                defaultValue={listToTextarea(operatingContext.activeConstraints)}
                name="activeConstraints"
                placeholder="每行一个约束"
              />
            </Field>
            <Field label="反目标">
              <textarea
                className={textareaClassName}
                defaultValue={listToTextarea(operatingContext.antiGoals)}
                name="antiGoals"
                placeholder="每行一个不做的事"
              />
            </Field>
            <Field label="执行原则">
              <textarea
                className={textareaClassName}
                defaultValue={listToTextarea(operatingContext.principles)}
                name="principles"
                placeholder="每行一个判断原则"
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <button className={primaryButtonClassName} type="submit">
              保存个人信息
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-1">
            <SectionTitle title="月度目标" />
            <p className="text-sm text-zinc-500">
              当前月份：{currentMonth}
              {currentGoal ? ` · ${currentGoal.title}` : " · 尚未设置目标"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="grid content-start gap-3">
            {sortedGoals.length > 0 ? (
              sortedGoals.map((goal) => (
                <MonthlyGoalCard goal={goal} key={goal.id} />
              ))
            ) : (
              <EmptyState>还没有月度目标。</EmptyState>
            )}
          </div>

          <form
            action={createMonthlyGoalAction}
            className="grid content-start gap-3 border border-zinc-900 bg-black/70 p-3"
          >
            <h3 className="text-sm font-semibold text-zinc-200">
              新增月度目标
            </h3>
            <Field label="月份">
              <input
                className={inputClassName}
                defaultValue={currentMonth}
                name="month"
                required
                type="month"
              />
            </Field>
            <Field label="目标标题">
              <input
                className={inputClassName}
                name="title"
                placeholder="例如：完成小程序 SaaS 产品拆解"
                required
              />
            </Field>
            <Field label="为什么重要">
              <textarea
                className={textareaClassName}
                name="why"
                placeholder="这个目标和长期愿景的关系"
                required
              />
            </Field>
            <Field label="完成标准">
              <textarea
                className={textareaClassName}
                name="successMetric"
                placeholder="月底能检查的结果"
                required
              />
            </Field>
            <Field label="交付证据">
              <textarea
                className={textareaClassName}
                name="targetEvidence"
                placeholder="每行一个证据，例如 commit、页面、文档、产品卡片"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Field label="本月约束">
                <textarea
                  className={textareaClassName}
                  name="constraints"
                  placeholder="每行一个约束"
                />
              </Field>
              <Field label="本月反目标">
                <textarea
                  className={textareaClassName}
                  name="antiGoals"
                  placeholder="每行一个不做的事"
                />
              </Field>
            </div>
            <button className={primaryButtonClassName} type="submit">
              新增月度目标
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function MonthlyGoalCard({ goal }: { goal: MonthlyGoal }) {
  const isArchived = goal.status === "archived";

  return (
    <article
      className={`grid gap-3 border border-zinc-900 bg-black/80 p-3 text-sm ${
        isArchived ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="font-mono text-xs text-emerald-400">
            {goal.month}
          </div>
          <h3 className="mt-1 break-words text-base font-semibold text-zinc-100">
            {goal.title}
          </h3>
        </div>
        <span className="w-fit border border-zinc-800 px-2 py-1 text-xs text-zinc-300">
          {monthlyGoalStatusLabels[goal.status]}
        </span>
      </div>

      <dl className="grid gap-3 md:grid-cols-2">
        <Detail label="为什么" value={goal.why || "未填写"} />
        <Detail label="完成标准" value={goal.successMetric || "未填写"} />
      </dl>

      <div className="grid gap-3 md:grid-cols-3">
        <ReviewList label="交付证据" items={goal.targetEvidence} />
        <ReviewList label="约束" items={goal.constraints} />
        <ReviewList label="反目标" items={goal.antiGoals} />
      </div>

      {!isArchived ? (
        <form action={archiveMonthlyGoalAction} className="flex justify-end">
          <input type="hidden" name="id" value={goal.id} />
          <button className={secondaryButtonClassName} type="submit">
            归档
          </button>
        </form>
      ) : null}
    </article>
  );
}

function ManualTaskSection({ today }: { today: string }) {
  return (
    <section className="grid gap-4 border border-zinc-800 bg-black/80 p-4">
      <div className="grid gap-1">
        <SectionTitle title="手动新增任务" />
        <p className="text-sm text-zinc-500">
          直接写入一条可执行任务，可加入今日四象限，也可先放入任务池。
        </p>
      </div>

      <form action={createTaskAction} className="grid gap-4">
        <input type="hidden" name="today" value={today} />

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="任务标题">
            <input
              className={inputClassName}
              name="title"
              placeholder="例如：完成今日任务页面收尾验证"
              required
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
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="状态">
            <select className={inputClassName} name="status" defaultValue="inbox">
              {manualTaskStatuses.map((status) => (
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
          <Field label="风险标签">
            <input
              className={inputClassName}
              name="riskFlags"
              placeholder="例如：泛学习, 信息刷屏"
            />
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="下一步">
            <textarea
              className={textareaClassName}
              name="nextAction"
              placeholder="写清楚下一次打开任务时立刻做什么"
              required
            />
          </Field>
          <Field label="完成标准">
            <textarea
              className={textareaClassName}
              name="doneWhen"
              placeholder="写清楚怎样算完成，最好可检查"
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 border border-zinc-900 bg-zinc-950/60 p-3 md:grid-cols-[minmax(0,1fr)_18rem]">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              className="h-4 w-4 accent-emerald-500"
              type="checkbox"
              name="planForToday"
              defaultChecked
            />
            加入今日任务
          </label>
          <Field label="四象限">
            <select
              className={inputClassName}
              name="quadrant"
              defaultValue="important_not_urgent"
            >
              {quadrants.map((quadrant) => (
                <option key={quadrant.id} value={quadrant.id}>
                  {quadrant.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <button className={primaryButtonClassName} type="submit">
            写入任务
          </button>
        </div>
      </form>
    </section>
  );
}

function TodaySidebar({ activeView }: { activeView: TodayView }) {
  const items: Array<{ view: TodayView; label: string; href: string }> = [
    { view: "tasks", label: "今日任务", href: "/today?view=tasks" },
    { view: "review", label: "今日复盘", href: "/today?view=review" },
    { view: "new-task", label: "AI 任务准入", href: "/today?view=new-task" },
    { view: "profile", label: "个人信息", href: "/today?view=profile" },
  ];

  return (
    <aside className="h-fit border border-zinc-800 bg-black/80 p-2 lg:sticky lg:top-4">
      <nav aria-label="今日视图" className="grid gap-1">
        {items.map((item) => (
          <Link
            className={`border px-3 py-2 text-sm font-medium transition ${
              activeView === item.view
                ? "border-emerald-600 bg-emerald-500 text-black"
                : "border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-50"
            }`}
            href={item.href}
            key={item.view}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function FocusPanel({ task }: { task: Task | null }) {
  return (
    <section className="grid gap-3 border border-emerald-900/60 bg-zinc-950/80 p-4">
      <SectionTitle title="今日重心" />
      {task ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <h2 className="text-xl font-semibold text-zinc-50">{task.title}</h2>
          </div>
          <KeyValue label="下一步" value={task.nextAction || "未填写"} />
          <KeyValue label="完成标准" value={task.doneWhen || "未填写"} />
        </div>
      ) : (
        <p className="text-sm leading-6 text-zinc-400">
          当前没有可推进的 P0。先从任务池加入一个今日任务。
        </p>
      )}
    </section>
  );
}

function ProgressPanel({
  todayTasks,
  productProgress,
}: {
  todayTasks: Task[];
  productProgress: number;
}) {
  const priorityStats = priorities.map((priority) => {
    const items = todayTasks.filter((task) => task.priority === priority);
    const done = items.filter((task) => task.status === "done").length;

    return `${priority} ${done}/${items.length}`;
  });

  return (
    <section className="border border-zinc-800 bg-black/80 p-4">
      <SectionTitle title="今日进度" />
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {[...priorityStats, `产品拆解 ${productProgress}/3`].map((item) => (
          <span
            className="border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-zinc-200"
            key={item}
          >
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function QuadrantGrid({
  tasks,
  productProgress,
}: {
  tasks: Task[];
  productProgress: number;
}) {
  return (
    <section className="grid gap-3">
      <SectionTitle title="四象限" />
      <div className="grid gap-3 lg:grid-cols-2">
        {quadrants.map((quadrant) => {
          const quadrantTasks = tasks.filter(
            (task) => getDisplayQuadrant(task) === quadrant.id,
          );

          return (
            <section
              className="grid content-start gap-3 border border-zinc-800 bg-zinc-950/70 p-3"
              key={quadrant.id}
            >
              <div className="grid gap-1">
                <h3 className="text-base font-semibold text-zinc-100">
                  {quadrant.title}
                </h3>
                <p className="text-sm text-zinc-500">{quadrant.description}</p>
              </div>

              {quadrant.id === "important_not_urgent" ? (
                <ProductTeardownFixedCard progress={productProgress} />
              ) : null}

              {quadrantTasks.length > 0 ? (
                <div className="grid gap-2">
                  {quadrantTasks.map((task) => (
                    <CompactQuadrantTaskCard
                      key={task.id}
                      task={task}
                      displayQuadrant={quadrant.id}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState>这个象限暂时没有任务。</EmptyState>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ProductTeardownFixedCard({ progress }: { progress: number }) {
  return (
    <article className="grid gap-2 border border-emerald-900/70 bg-emerald-950/20 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 font-semibold text-emerald-200">
          每日固定任务｜产品拆解 3 个
        </div>
        <Link
          className="inline-flex min-h-9 shrink-0 items-center border border-emerald-700 px-3 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-500 hover:text-black"
          href="/today/product-teardowns"
        >
          打开拆解页
        </Link>
      </div>
      <div className="text-zinc-400">进度：{progress}/3</div>
    </article>
  );
}

function CompactQuadrantTaskCard({
  task,
  displayQuadrant,
}: {
  task: Task;
  displayQuadrant: TaskQuadrant;
}) {
  return (
    <article className="grid gap-2 border border-zinc-800 bg-black/80 p-3 text-sm">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-start gap-2">
          <PriorityBadge priority={task.priority} />
          <h4 className="min-w-0 flex-1 break-words text-base font-semibold text-zinc-50">
            {task.title}
          </h4>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>{task.project || "未填写项目"}</span>
          <span>{statusLabels[task.status]}</span>
          <span>今日 {quadrantLabel(displayQuadrant)}</span>
        </div>
      </div>

      <p className="min-w-0 truncate text-zinc-400">
        下一步：{task.nextAction || "未填写"}
      </p>
    </article>
  );
}

function TaskPool({ tasks, today }: { tasks: Task[]; today: string }) {
  const activeTodayTasks = tasks.filter(
    (task) =>
      isPlannedForToday(task, today) &&
      !["done", "dropped"].includes(task.status),
  );
  const unplannedTasks = tasks.filter(
    (task) =>
      !isPlannedForToday(task, today) &&
      !["waiting", "review", "frozen", "done", "dropped"].includes(task.status),
  );
  const waitingTasks = tasks.filter(
    (task) =>
      !isPlannedForToday(task, today) &&
      ["waiting", "review", "frozen"].includes(task.status),
  );
  const completedTasks = tasks.filter((task) =>
    ["done", "dropped"].includes(task.status),
  );
  const groups: Array<{
    title: string;
    description: string;
    tasks: Task[];
    collapsed?: boolean;
    hideCodexPacket?: boolean;
    muted?: boolean;
  }> = [
    {
      title: "今日四象限",
      description: "已经放进今天地图的任务，详情和操作仍在任务池处理。",
      tasks: activeTodayTasks,
    },
    {
      title: "未安排",
      description: "还没有加入今天四象限的可推进任务。",
      tasks: unplannedTasks,
    },
    {
      title: "等待 / 复核 / 冻结",
      description: "暂时不能直接推进，但仍属于任务池。",
      tasks: waitingTasks,
    },
    {
      title: "已完成 / 已放弃",
      description: "保留结果和历史状态，默认弱化显示。",
      tasks: completedTasks,
      collapsed: true,
      hideCodexPacket: true,
      muted: true,
    },
  ];

  return (
    <details className="border border-zinc-800 bg-black/80 p-4" open>
      <summary className="cursor-pointer text-base font-semibold text-zinc-100">
        任务池（{tasks.length}）
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="text-sm text-zinc-500">
          任务池是全量任务 SSOT；四象限只决定今天的摆放位置。
        </p>
        {tasks.length > 0 ? (
          groups.map((group) => {
            const groupClassName = group.muted
              ? "grid gap-2 opacity-70"
              : "grid gap-2";
            const groupContent =
              group.tasks.length > 0 ? (
                <div className="grid gap-2">
                  {group.tasks.map((task) => (
                    <TaskPoolItem
                      hideCodexPacket={group.hideCodexPacket}
                      key={task.id}
                      task={task}
                      today={today}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState>暂无任务。</EmptyState>
              );

            if (group.collapsed) {
              return (
                <details
                  className="border border-zinc-900 bg-black/30 p-3 opacity-70"
                  key={group.title}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="grid gap-1">
                        <h3 className="text-sm font-semibold text-zinc-300">
                          {group.title}（{group.tasks.length}）
                        </h3>
                        <p className="text-xs text-zinc-600">
                          {group.description}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-emerald-400">
                        点击查看列表
                      </span>
                    </div>
                  </summary>
                  <div className="mt-3">{groupContent}</div>
                </details>
              );
            }

            return (
              <section className={groupClassName} key={group.title}>
                <div className="grid gap-1">
                  <h3 className="text-sm font-semibold text-zinc-300">
                    {group.title}（{group.tasks.length}）
                  </h3>
                  <p className="text-xs text-zinc-600">{group.description}</p>
                </div>
                {groupContent}
              </section>
            );
          })
        ) : (
          <EmptyState>任务池为空。</EmptyState>
        )}
      </div>
    </details>
  );
}

function TaskPoolItem({
  hideCodexPacket = false,
  task,
  today,
}: {
  hideCodexPacket?: boolean;
  task: Task;
  today: string;
}) {
  const plannedToday = isPlannedForToday(task, today);
  const displayQuadrant = getDisplayQuadrant(task);
  const isClosedTask = ["done", "dropped"].includes(task.status);
  const canGenerateCodexPacket =
    !hideCodexPacket && !isClosedTask;

  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3 text-sm">
      <div className="grid gap-2 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-2">
            <PriorityBadge priority={task.priority} />
            <h4 className="min-w-0 flex-1 break-words font-semibold text-zinc-100">
              {task.title}
            </h4>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>{statusLabels[task.status]}</span>
            <span>{task.project || "未填写项目"}</span>
            <span>
              {plannedToday
                ? `今日 ${quadrantLabel(displayQuadrant)}`
                : "未安排到今天"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {statusActions.map((action) => (
            <form action={updateTaskStatusAction} key={action.status}>
              <input type="hidden" name="id" value={task.id} />
              <button
                className={
                  task.status === action.status
                    ? activeActionButtonClassName
                    : actionButtonClassName
                }
                name="status"
                type="submit"
                value={action.status}
              >
                {action.label}
              </button>
            </form>
          ))}
          {plannedToday ? (
            <form action={unplanTaskAction}>
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="quadrant" value={displayQuadrant} />
              <button className={actionButtonClassName} type="submit">
                移出今日
              </button>
            </form>
          ) : null}
          <details className="min-w-28">
            <summary className={`${dangerButtonClassName} list-none cursor-pointer`}>
              删除
            </summary>
            <form action={deleteTaskAction} className="mt-1 grid gap-1">
              <input type="hidden" name="id" value={task.id} />
              <button
                aria-label={`确认删除任务 ${task.title}`}
                className={dangerButtonClassName}
                type="submit"
              >
                确认删除
              </button>
            </form>
          </details>
        </div>
      </div>

      <dl className="grid gap-2 md:grid-cols-3">
        <Detail label="下一步" value={task.nextAction || "未填写"} />
        <Detail label="完成标准" value={task.doneWhen || "未填写"} />
        <Detail
          label="风险"
          value={task.riskFlags.length > 0 ? task.riskFlags.join("、") : "无"}
        />
      </dl>

      {!isClosedTask ? (
        <div className="flex flex-wrap gap-1.5">
          {quadrants.map((quadrant) => (
            <form
              action={
                plannedToday ? moveTaskQuadrantAction : planTaskForTodayAction
              }
              key={quadrant.id}
            >
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="today" value={today} />
              <button
                className={
                  plannedToday && displayQuadrant === quadrant.id
                    ? activeActionButtonClassName
                    : actionButtonClassName
                }
                name="quadrant"
                type="submit"
                value={quadrant.id}
              >
                {plannedToday ? "移到" : "加入今日"} {quadrantLabel(quadrant.id)}
              </button>
            </form>
          ))}
        </div>
      ) : null}

      {canGenerateCodexPacket ? (
        <details className="group border-t border-zinc-900 pt-2">
          <summary className="cursor-pointer text-sm font-medium text-emerald-300 hover:text-emerald-200">
            生成 Codex 指令
          </summary>
          <textarea
            className="mt-2 min-h-64 w-full resize-y border border-zinc-800 bg-black p-3 font-mono text-xs leading-5 text-zinc-300 outline-none focus:border-emerald-500"
            readOnly
            value={generateCodexPacket(task)}
          />
        </details>
      ) : null}
    </article>
  );
}

function ReviewView({
  today,
  currentP0,
  latestReview,
  dailyReview,
  weeklyReview,
  weekStart,
  weekEnd,
}: {
  today: string;
  currentP0: Task | null;
  latestReview?: DailyReview;
  dailyReview?: AiDailyReview;
  weeklyReview?: AiWeeklyReview;
  weekStart: string;
  weekEnd: string;
}) {
  return (
    <div className="grid gap-4">
      <ManualReviewSection
        currentP0={currentP0}
        latestReview={latestReview}
        today={today}
      />
      <AiReviewSection
        dailyReview={dailyReview}
        weekEnd={weekEnd}
        weeklyReview={weeklyReview}
        weekStart={weekStart}
      />
      <MarkdownExportSection today={today} />
    </div>
  );
}

function ManualReviewSection({
  today,
  currentP0,
  latestReview,
}: {
  today: string;
  currentP0: Task | null;
  latestReview?: DailyReview;
}) {
  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-4">
      <SectionTitle title="手动复盘" />
      <form action={createReviewAction} className="grid gap-4">
        <input type="hidden" name="date" value={today} />
        <input type="hidden" name="plannedP0" value={currentP0?.id || ""} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="今日真实产出">
            <textarea
              className={reviewTextareaClassName}
              name="actualOutput"
              defaultValue={latestReview?.actualOutput}
            />
          </Field>

          <Field label="今日产出证据 / 备注">
            <textarea
              className={reviewTextareaClassName}
              name="notes"
              defaultValue={latestReview?.notes}
            />
          </Field>
        </div>

        <div className="grid gap-1 border border-zinc-900 bg-zinc-950/50 px-3 py-2 text-xs leading-5">
          <p className="text-zinc-500">
            产出证据 = 能证明今天真的做出了东西的内容，例如 commit、文件、截图、demo、产品拆解、Codex 输出、用户反馈。
          </p>
          <p className="border-l border-amber-700 pl-2 text-amber-200">
            没有产出证据的复盘，容易变成自我感觉良好。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="今日伪忙碌">
            <textarea
              className={reviewTextareaClassName}
              name="fakeProgress"
              defaultValue={latestReview?.fakeProgress}
            />
          </Field>

          <div className="grid content-start gap-4">
            <Field label="偏离标签">
              <input
                className={inputClassName}
                name="driftFlags"
                defaultValue={latestReview?.driftFlags.join(", ")}
                placeholder="逗号分隔，例如 泛学习, 信息刷屏"
              />
            </Field>

            <Field label="明日 P0">
              <input
                className={inputClassName}
                name="tomorrowP0"
                defaultValue={latestReview?.tomorrowP0}
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end">
          <button className={primaryButtonClassName} type="submit">
            保存复盘
          </button>
        </div>
      </form>
    </section>
  );
}

function AiReviewSection({
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
    <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionTitle title="AI 复盘" />
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
          weekEnd={weekEnd}
          weekStart={weekStart}
        />
      </div>
    </section>
  );
}

function AiDailyReviewCard({ review }: { review?: AiDailyReview }) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-black/80 p-3 text-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-zinc-100">
          AI 每日复盘结果
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
          <ReviewDetail
            label="技术交付进展"
            value={review.technicalProgress}
          />
          <ReviewDetail label="明日建议" value={review.nextDaySuggestion} />
          <DailyScoreGrid review={review} />
        </div>
      ) : (
        <p className="text-zinc-500">今天还没有 AI 每日复盘结果。</p>
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
    <article className="grid gap-3 border border-zinc-900 bg-black/80 p-3 text-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-zinc-100">
          AI 每周复盘结果
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
        <p className="text-zinc-500">本周还没有 AI 每周复盘结果。</p>
      )}
    </article>
  );
}

function MarkdownExportSection({ today }: { today: string }) {
  return (
    <section className="grid gap-3 border border-emerald-900/70 bg-emerald-950/15 p-4">
      <SectionTitle title="沉淀" />
      <p className="text-sm text-zinc-400">
        保存复盘后，可导出今日 Markdown 到 Obsidian 或 exports 目录。
      </p>
      <form action={exportMarkdownAction}>
        <input type="hidden" name="date" value={today} />
        <button className={primaryButtonClassName} type="submit">
          导出今日 Markdown
        </button>
      </form>
    </section>
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
            className="border border-zinc-800 bg-zinc-950 px-2 py-2"
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

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-base font-semibold text-zinc-100">{title}</h2>;
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
    <label className="grid gap-1.5 text-sm text-zinc-500">
      {label}
      {children}
    </label>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5rem_1fr]">
      <span className="text-sm text-zinc-500">{label}：</span>
      <span className="break-words leading-7 text-zinc-300">{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words leading-6 text-zinc-300">{value}</dd>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className="inline-flex border border-emerald-700 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300">
      {priority}
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-zinc-800 bg-black/40 px-3 py-4 text-sm text-zinc-500">
      {children}
    </p>
  );
}

async function updateTaskStatusAction(formData: FormData) {
  "use server";

  const id = getFormValue(formData, "id");
  const status = getFormValue(formData, "status") as TaskStatus;

  if (!id || !TASK_STATUSES.includes(status)) {
    return;
  }

  await updateTask(id, { status });
  revalidatePath("/today");
}

async function deleteTaskAction(formData: FormData) {
  "use server";

  const id = getFormValue(formData, "id");

  if (!id) {
    return;
  }

  await deleteTask(id);
  revalidatePath("/today");
  redirect("/today?view=tasks&deleted=task");
}

async function createTaskAction(formData: FormData) {
  "use server";

  const title = getFormValue(formData, "title").trim();

  if (!title) {
    return;
  }

  const today = getFormValue(formData, "today") || getTodayDate();
  const shouldPlanForToday = formData.get("planForToday") === "on";
  const quadrant =
    parseQuadrant(getFormValue(formData, "quadrant")) ||
    "important_not_urgent";

  await createTask({
    title,
    project: getFormValue(formData, "project") || "Personal SaaS OS",
    priority: parsePriority(getFormValue(formData, "priority")),
    status: parseTaskStatus(getFormValue(formData, "status")),
    codexFit: parseCodexFit(getFormValue(formData, "codexFit")),
    nextAction: getFormValue(formData, "nextAction"),
    doneWhen: getFormValue(formData, "doneWhen"),
    riskFlags: parseList(getFormValue(formData, "riskFlags")),
    plannedFor: shouldPlanForToday ? today : undefined,
    quadrant: shouldPlanForToday ? quadrant : undefined,
  });

  revalidatePath("/today");
  redirect("/today?view=tasks&created=task");
}

async function updateOperatingContextAction(formData: FormData) {
  "use server";

  await updateOperatingContext({
    northStar: getFormValue(formData, "northStar"),
    currentFocus: getFormValue(formData, "currentFocus"),
    activeConstraints: parseList(getFormValue(formData, "activeConstraints")),
    antiGoals: parseList(getFormValue(formData, "antiGoals")),
    principles: parseList(getFormValue(formData, "principles")),
  });

  revalidatePath("/today");
  redirect("/today?view=profile&profile=context-saved");
}

async function createMonthlyGoalAction(formData: FormData) {
  "use server";

  const month = normalizeMonth(getFormValue(formData, "month"));
  const title = getFormValue(formData, "title").trim();
  const why = getFormValue(formData, "why").trim();
  const successMetric = getFormValue(formData, "successMetric").trim();

  if (!month || !title || !why || !successMetric) {
    return;
  }

  await createMonthlyGoal({
    month,
    title,
    why,
    successMetric,
    targetEvidence: parseList(getFormValue(formData, "targetEvidence")),
    weeklyMilestones: [],
    constraints: parseList(getFormValue(formData, "constraints")),
    antiGoals: parseList(getFormValue(formData, "antiGoals")),
    status: "active",
  });

  revalidatePath("/today");
  redirect("/today?view=profile&profile=goal-created");
}

async function archiveMonthlyGoalAction(formData: FormData) {
  "use server";

  const id = getFormValue(formData, "id");

  if (!id) {
    return;
  }

  await archiveMonthlyGoal(id);
  revalidatePath("/today");
  redirect("/today?view=profile&profile=goal-archived");
}

async function createReviewAction(formData: FormData) {
  "use server";

  await createReview({
    date: getFormValue(formData, "date") || getTodayDate(),
    plannedP0: getFormValue(formData, "plannedP0") || undefined,
    actualOutput: getFormValue(formData, "actualOutput"),
    fakeProgress: getFormValue(formData, "fakeProgress"),
    driftFlags: parseList(getFormValue(formData, "driftFlags")),
    tomorrowP0: getFormValue(formData, "tomorrowP0"),
    notes: getFormValue(formData, "notes"),
  });

  revalidatePath("/today");
  redirect("/today?view=review&review=saved");
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
  redirect("/today?view=review&aiReview=daily-saved");
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
  redirect("/today?view=review&aiReview=weekly-saved");
}

async function exportMarkdownAction(formData: FormData) {
  "use server";

  const date = getFormValue(formData, "date") || getTodayDate();
  const filePath = await exportDailyMarkdown(date);

  revalidatePath("/today");
  redirect(`/today?view=review&exported=${encodeURIComponent(filePath)}`);
}

async function moveTaskQuadrantAction(formData: FormData) {
  "use server";

  await planTaskForQuadrant(formData);
}

async function planTaskForTodayAction(formData: FormData) {
  "use server";

  await planTaskForQuadrant(formData);
}

async function unplanTaskAction(formData: FormData) {
  "use server";

  const id = getFormValue(formData, "id");
  const quadrant = parseQuadrant(getFormValue(formData, "quadrant"));

  if (!id) {
    return;
  }

  await updateTask(id, {
    plannedFor: undefined,
    ...(quadrant ? { quadrant } : {}),
  });
  revalidatePath("/today");
}

async function planTaskForQuadrant(formData: FormData) {
  const id = getFormValue(formData, "id");
  const quadrant = parseQuadrant(getFormValue(formData, "quadrant"));
  const today = getFormValue(formData, "today") || getTodayDate();

  if (!id || !quadrant) {
    return;
  }

  await updateTask(id, {
    plannedFor: today,
    quadrant,
  });
  revalidatePath("/today");
}

function getNotices(params?: {
  review?: string;
  aiReview?: string;
  aiReviewError?: string;
  created?: string;
  deleted?: string;
  exported?: string;
  profile?: string;
}) {
  const notices: string[] = [];

  if (params?.created === "task") {
    notices.push("新任务已写入任务。");
  }

  if (params?.created === "ai-task") {
    notices.push("AI 整理后的任务已写入任务。");
  }

  if (params?.created === "ai-error") {
    notices.push("AI 整理后的任务写入失败，请重新生成预览。");
  }

  if (params?.deleted === "task") {
    notices.push("任务已删除。");
  }

  if (params?.review === "saved") {
    notices.push("每日复盘已保存。");
  }

  if (params?.profile === "context-saved") {
    notices.push("个人信息已保存。");
  }

  if (params?.profile === "goal-created") {
    notices.push("月度目标已新增。");
  }

  if (params?.profile === "goal-archived") {
    notices.push("月度目标已归档。");
  }

  if (params?.aiReview === "daily-saved") {
    notices.push("AI 每日复盘已生成并保存。");
  }

  if (params?.aiReview === "weekly-saved") {
    notices.push("AI 每周复盘已生成并保存。");
  }

  if (params?.exported) {
    notices.push(`Markdown 已导出：${decodeURIComponent(params.exported)}`);
  }

  const aiReviewErrorMessage = getAiReviewErrorMessage(params?.aiReviewError);

  if (aiReviewErrorMessage) {
    notices.push(aiReviewErrorMessage);
  }

  return notices;
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
    redirect("/today?view=review&aiReviewError=missing-key");
  }

  if (
    error instanceof AiDailyReviewInvalidJsonError ||
    error instanceof AiWeeklyReviewInvalidJsonError
  ) {
    redirect("/today?view=review&aiReviewError=invalid-json");
  }

  if (error instanceof DeepSeekRequestError) {
    redirect("/today?view=review&aiReviewError=request-failed");
  }

  redirect("/today?view=review&aiReviewError=request-failed");
}

function parseView(value?: string): TodayView {
  if (value === "review" || value === "new-task" || value === "profile") {
    return value;
  }

  return "tasks";
}

function normalizeMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? value : "";
}

function parsePriority(value: string): TaskPriority {
  const priority = value as TaskPriority;

  return priorities.includes(priority) ? priority : "P2";
}

function parseTaskStatus(value: string): TaskStatus {
  const status = value as TaskStatus;

  return manualTaskStatuses.includes(status) ? status : "inbox";
}

function parseCodexFit(value: string): CodexFit {
  const codexFit = value as CodexFit;

  return codexFits.includes(codexFit) ? codexFit : "medium";
}

function parseQuadrant(value: string): TaskQuadrant | null {
  const quadrant = value as TaskQuadrant;

  return quadrants.some((item) => item.id === quadrant) ? quadrant : null;
}

function quadrantLabel(quadrant: TaskQuadrant) {
  return quadrants.find((item) => item.id === quadrant)?.title.split(" ")[0] || "";
}

function chooseExplicitOrFallbackP0(
  tasks: Task[],
  today: string,
  fallback: Task | null,
) {
  return (
    tasks.find((task) => task.plannedFor === today && task.priority === "P0") ||
    fallback
  );
}

function isPlannedForToday(task: Task, today: string) {
  if (task.plannedFor === today) {
    return true;
  }

  if (task.plannedFor) {
    return false;
  }

  if (task.quadrant) {
    return false;
  }

  return legacyTodayStatuses.includes(task.status);
}

function getDisplayQuadrant(task: Task): TaskQuadrant {
  if (task.quadrant) {
    return task.quadrant;
  }

  if (hasLowValueRisk(task)) {
    return "not_urgent_not_important";
  }

  if (task.priority === "P0") {
    return "important_urgent";
  }

  return "important_not_urgent";
}

function hasLowValueRisk(task: Task) {
  return task.riskFlags.some(
    (risk) =>
      risk.includes("泛学习") ||
      risk.includes("信息刷屏") ||
      risk.includes("娉涘") ||
      risk.includes("淇℃伅鍒峰睆"),
  );
}

function parseList(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToTextarea(items: string[]) {
  return items.join("\n");
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

function getFormValue(formData: FormData, key: string) {
  return String(formData.get(key) || "");
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

const actionButtonClassName =
  "min-h-8 border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-emerald-500 hover:text-emerald-300";
const activeActionButtonClassName =
  "min-h-8 border border-emerald-700 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300";
const dangerButtonClassName =
  "min-h-8 border border-red-950 px-2.5 py-1.5 text-xs font-medium text-red-300 hover:border-red-700 hover:bg-red-950/40 hover:text-red-200";
const inputClassName =
  "border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const textareaClassName =
  "min-h-28 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const reviewTextareaClassName =
  "min-h-40 resize-y border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const primaryButtonClassName =
  "border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400";
const secondaryButtonClassName =
  "border border-zinc-700 bg-zinc-950 px-3 py-2 text-base font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300";
