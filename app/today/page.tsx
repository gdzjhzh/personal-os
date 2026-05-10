import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CodexPacketPanel } from "@/components/codex-packet-panel";
import { generateCodexPacket } from "@/lib/server/codexPacket";
import {
  DO_NOT_DO_LIST,
  chooseTodayP0,
  minimumActionFromP0,
  scheduleAdvice,
} from "@/lib/server/scoring";
import {
  TASK_STATUSES,
  createReview,
  createTask,
  exportDailyMarkdown,
  readStore,
  updateTask,
} from "@/lib/server/store";
import type { CodexFit, Task, TaskPriority, TaskStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TodayPageProps = {
  searchParams?: Promise<{
    exported?: string;
    review?: string;
    created?: string;
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
  const store = await readStore();
  const tasks = [...store.tasks].sort((a, b) => a.code.localeCompare(b.code));
  const p0Decision = chooseTodayP0(tasks);
  const p0 = p0Decision.task;
  const latestReview = [...store.reviews]
    .reverse()
    .find((review) => review.date === today);
  const activeTasks = tasks.filter((task) =>
    ["inbox", "active", "codex_ready", "codex_running"].includes(task.status),
  );
  const codexReadyTasks = tasks.filter((task) =>
    ["codex_ready", "codex_running"].includes(task.status),
  );
  const waitingReviewTasks = tasks.filter((task) =>
    ["waiting", "review", "frozen"].includes(task.status),
  );
  const packets = tasks.map((task) => ({
    id: task.id,
    label: `${task.code} ${task.title}`,
    packet: generateCodexPacket(task),
  }));

  return (
    <main className="min-h-screen bg-[#070707] px-3 py-4 font-mono text-zinc-100 sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-[1600px] gap-4">
        <header className="flex flex-col gap-2 border-b border-zinc-800 pb-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase text-emerald-400">
              Personal SaaS OS / Active Task SSOT
            </p>
            <h1 className="text-xl font-semibold text-zinc-50 sm:text-2xl">
              今日执行台
            </h1>
          </div>
          <div className="text-xs text-zinc-500">
            日期：{today} / 存储：data/store.json / 本地优先
          </div>
        </header>

        {params?.exported ? (
          <Notice>Markdown 已导出：{decodeURIComponent(params.exported)}</Notice>
        ) : null}
        {params?.review === "saved" ? <Notice>每日复盘已保存。</Notice> : null}
        {params?.created === "task" ? <Notice>新任务已写入 SSOT。</Notice> : null}

        <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3">
          <SectionTitle eyebrow="01" title="Today P0" />
          {p0 ? (
            <div className="grid gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{p0.priority}</Badge>
                <span className="text-emerald-300">{p0.code}</span>
                <span className="font-semibold text-zinc-50">{p0.title}</span>
              </div>
              <KeyValue label="当前可推进动作" value={p0.nextAction || "未填写"} />
              <KeyValue label="完成标准" value={p0.doneWhen || "未填写"} />
              <KeyValue label="为什么是 P0" value={p0Decision.reasons.join("；")} />
              <KeyValue label="AI 排程建议" value={scheduleAdvice(p0Decision)} />
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              当前没有 active 或 codex_ready 任务。先补齐一个可推进任务。
            </p>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <section className="grid gap-3 border border-zinc-800 bg-black p-3">
            <SectionTitle eyebrow="02" title="Minimum 25-minute action" />
            <p className="text-sm text-emerald-300">{minimumActionFromP0(p0)}</p>
          </section>

          <section className="grid gap-3 border border-zinc-800 bg-black p-3">
            <SectionTitle eyebrow="03" title="Do-not-do list" />
            <ul className="grid gap-1 text-xs text-zinc-300 sm:grid-cols-2">
              {DO_NOT_DO_LIST.map((item) => (
                <li key={item} className="border-l border-zinc-700 pl-2">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="grid gap-3 border border-zinc-800 bg-zinc-950/70 p-3">
          <SectionTitle eyebrow="04" title="Active Task SSOT table" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-xs">
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
            title="Codex Ready queue"
            tasks={codexReadyTasks}
          />
          <QueueSection
            eyebrow="06"
            title="Waiting / Review queue"
            tasks={waitingReviewTasks}
          />
        </div>

        <section className="grid gap-3 border border-zinc-800 bg-black p-3">
          <SectionTitle eyebrow="07" title="Add Task form" />
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
          <SectionTitle eyebrow="08" title="Codex Task Packet generator" />
          <CodexPacketPanel packets={packets} />
        </section>

        <section className="grid gap-3 border border-zinc-800 bg-black p-3">
          <SectionTitle eyebrow="09" title="Evening Review form" />
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

        <section className="grid gap-3 border border-emerald-900/80 bg-emerald-950/20 p-3">
          <SectionTitle eyebrow="10" title="Export to Obsidian / Markdown" />
          <p className="text-xs text-zinc-400">
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
          <span className="text-emerald-300">{task.code}</span>
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
        <div className="flex min-w-72 flex-wrap gap-1">
          {rowStatuses.map((status) => (
            <form key={status} action={updateTaskStatusAction}>
              <input type="hidden" name="id" value={task.id} />
              <button
                className="border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                name="status"
                type="submit"
                value={status}
              >
                set {status}
              </button>
            </form>
          ))}
          <a
            className="border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
            href="#codex-packet-generator"
          >
            generate Codex packet
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
              className="grid gap-1 border border-zinc-900 bg-zinc-950 p-2 text-xs"
              key={task.id}
            >
              <div className="flex flex-wrap gap-2">
                <span className="text-emerald-300">{task.code}</span>
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
        <p className="text-sm text-zinc-500">暂无任务。</p>
      )}
    </section>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-emerald-400">{eyebrow}</span>
      <h2 className="text-sm font-semibold uppercase text-zinc-100">{title}</h2>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
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
    <label className="grid gap-1 text-xs text-zinc-500">
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
    <span className="inline-flex border border-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
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
    notes: String(formData.get("notes") || ""),
  });

  revalidatePath("/today");
  redirect("/today?review=saved");
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

function getTodayDate() {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const inputClassName =
  "border border-zinc-800 bg-black px-2 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
const textareaClassName =
  "min-h-24 border border-zinc-800 bg-black px-2 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";
const primaryButtonClassName =
  "border border-emerald-600 bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400";
