import {
  createCodexRunAction,
  createEvidenceAction,
  updateCodexRunStatusAction,
  updateOperatingContextAction,
} from "@/app/today/actions";
import type {
  CodexRun,
  CodexRunStatus,
  Evidence,
  EvidenceType,
  OperatingContext,
  Task,
} from "@/lib/types";

type GrowthLoopPanelProps = {
  today: string;
  tasks: Task[];
  codexRuns: CodexRun[];
  evidence: Evidence[];
  operatingContext: OperatingContext;
};

const codexRunStatuses: CodexRunStatus[] = [
  "queued",
  "running",
  "shipped",
  "blocked",
];
const evidenceTypes: EvidenceType[] = [
  "shipping",
  "product_judgment",
  "technical_learning",
  "system_update",
];

const codexRunStatusLabels: Record<CodexRunStatus, string> = {
  queued: "待交付",
  running: "执行中",
  shipped: "已交付",
  blocked: "卡住",
};

const evidenceTypeLabels: Record<EvidenceType, string> = {
  shipping: "真实交付",
  product_judgment: "产品判断",
  technical_learning: "技术沉淀",
  system_update: "系统更新",
};

export function GrowthLoopPanel({
  today,
  tasks,
  codexRuns,
  evidence,
  operatingContext,
}: GrowthLoopPanelProps) {
  const selectableTasks = tasks.filter((task) =>
    ["active", "codex_ready", "codex_running", "review", "done"].includes(
      task.status,
    ),
  );

  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
      <div className="grid gap-1">
        <SectionTitle eyebrow="08" title="成长闭环 V0.2" />
        <p className="text-sm text-zinc-500">
          Task 管执行，ProductTeardown 管产品判断，CodexRun 管技术交付，Evidence 管真实产出。
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <OperatingContextCard context={operatingContext} />
        <EvidenceCard
          codexRuns={codexRuns}
          evidence={evidence}
          selectableTasks={selectableTasks}
          today={today}
        />
      </div>

      <CodexRunCard
        codexRuns={codexRuns}
        selectableTasks={selectableTasks}
        today={today}
      />
    </section>
  );
}

function OperatingContextCard({ context }: { context: OperatingContext }) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="text-base font-semibold text-zinc-100">
          OperatingContext 长期方向
        </h3>
        <span className="font-mono text-xs text-zinc-500">
          {formatCreatedAt(context.updatedAt)}
        </span>
      </div>

      <div className="grid gap-2 text-sm">
        <Detail label="长期方向" value={context.northStar} />
        <Detail label="当前焦点" value={context.currentFocus} />
        <TagList label="约束" items={context.activeConstraints} />
        <TagList label="反目标" items={context.antiGoals} />
        <TagList label="运行原则" items={context.principles} />
      </div>

      <form action={updateOperatingContextAction} className="grid gap-2">
        <Field label="长期方向">
          <input
            className={inputClassName}
            name="northStar"
            defaultValue={context.northStar}
          />
        </Field>
        <Field label="当前焦点">
          <input
            className={inputClassName}
            name="currentFocus"
            defaultValue={context.currentFocus}
          />
        </Field>
        <Field label="约束">
          <textarea
            className={compactTextareaClassName}
            name="activeConstraints"
            defaultValue={context.activeConstraints.join("\n")}
          />
        </Field>
        <Field label="反目标">
          <textarea
            className={compactTextareaClassName}
            name="antiGoals"
            defaultValue={context.antiGoals.join("\n")}
          />
        </Field>
        <Field label="运行原则">
          <textarea
            className={compactTextareaClassName}
            name="principles"
            defaultValue={context.principles.join("\n")}
          />
        </Field>
        <div className="flex justify-end">
          <button className={secondaryButtonClassName} type="submit">
            保存方向
          </button>
        </div>
      </form>
    </article>
  );
}

function EvidenceCard({
  today,
  selectableTasks,
  codexRuns,
  evidence,
}: {
  today: string;
  selectableTasks: Task[];
  codexRuns: CodexRun[];
  evidence: Evidence[];
}) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3">
      <h3 className="text-base font-semibold text-zinc-100">
        Evidence 真实产出
      </h3>

      {evidence.length > 0 ? (
        <div className="grid gap-2">
          {evidence.map((item) => (
            <div
              className="grid gap-1 border border-zinc-900 bg-black p-2 text-sm"
              key={item.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{evidenceTypeLabels[item.type]}</Badge>
                <span className="font-semibold text-zinc-100">{item.title}</span>
              </div>
              <p className="leading-6 text-zinc-300">
                {item.description || "未填写"}
              </p>
              {item.artifactUrl ? (
                <a
                  className="break-all text-xs text-emerald-300 hover:text-emerald-200"
                  href={item.artifactUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {item.artifactUrl}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">今天还没有记录真实产出证据。</p>
      )}

      <form action={createEvidenceAction} className="grid gap-2">
        <input name="date" type="hidden" value={today} />
        <div className="grid gap-2 md:grid-cols-2">
          <Field label="证据类型">
            <select className={inputClassName} name="type" defaultValue="shipping">
              {evidenceTypes.map((type) => (
                <option key={type} value={type}>
                  {evidenceTypeLabels[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="关联任务">
            <TaskSelect tasks={selectableTasks} />
          </Field>
          <Field label="关联 CodexRun">
            <select className={inputClassName} name="codexRunId" defaultValue="">
              <option value="">不关联</option>
              {codexRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标题">
            <input
              className={inputClassName}
              name="title"
              placeholder="今天真实交付了什么"
              required
            />
          </Field>
        </div>
        <Field label="证据说明">
          <textarea
            className={compactTextareaClassName}
            name="description"
            placeholder="写清楚可检查的产出，不写感受"
          />
        </Field>
        <Field label="链接或本地路径">
          <input
            className={inputClassName}
            name="artifactUrl"
            placeholder="可选，例如 PR、Markdown、导出文件或本地路径"
          />
        </Field>
        <div className="flex justify-end">
          <button className={primaryButtonClassName} type="submit">
            记录 Evidence
          </button>
        </div>
      </form>
    </article>
  );
}

function CodexRunCard({
  today,
  selectableTasks,
  codexRuns,
}: {
  today: string;
  selectableTasks: Task[];
  codexRuns: CodexRun[];
}) {
  return (
    <article className="grid gap-3 border border-zinc-900 bg-zinc-950 p-3">
      <h3 className="text-base font-semibold text-zinc-100">
        CodexRun 技术交付
      </h3>

      {codexRuns.length > 0 ? (
        <div className="grid gap-2 xl:grid-cols-2">
          {codexRuns.map((run) => (
            <div
              className="grid gap-2 border border-zinc-900 bg-black p-2 text-sm"
              key={run.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{codexRunStatusLabels[run.status]}</Badge>
                <span className="font-semibold text-zinc-100">{run.title}</span>
              </div>
              <Detail label="期望产出" value={run.expectedOutput} />
              <Detail label="实际结果" value={run.actualOutput || "未填写"} />
              <form action={updateCodexRunStatusAction} className="grid gap-2">
                <input name="id" type="hidden" value={run.id} />
                <Field label="交付状态">
                  <select
                    className={inputClassName}
                    name="status"
                    defaultValue={run.status}
                  >
                    {codexRunStatuses.map((status) => (
                      <option key={status} value={status}>
                        {codexRunStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="实际结果">
                  <textarea
                    className={compactTextareaClassName}
                    name="actualOutput"
                    defaultValue={run.actualOutput}
                  />
                </Field>
                <button className={secondaryButtonClassName} type="submit">
                  更新 CodexRun
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">今天还没有记录 Codex 技术交付。</p>
      )}

      <form action={createCodexRunAction} className="grid gap-2">
        <input name="date" type="hidden" value={today} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Field label="关联任务">
            <TaskSelect tasks={selectableTasks} />
          </Field>
          <Field label="交付状态">
            <select className={inputClassName} name="status" defaultValue="queued">
              {codexRunStatuses.map((status) => (
                <option key={status} value={status}>
                  {codexRunStatusLabels[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标题">
            <input
              className={inputClassName}
              name="title"
              placeholder="交给 Codex 的技术交付"
              required
            />
          </Field>
          <Field label="期望产出">
            <input
              className={inputClassName}
              name="expectedOutput"
              placeholder="可验收的代码/文档/修复"
            />
          </Field>
        </div>
        <Field label="给 Codex 的任务包">
          <textarea
            className={compactTextareaClassName}
            name="prompt"
            placeholder="复制实际发给 Codex 的边界、文件、验收标准"
          />
        </Field>
        <Field label="实际结果">
          <textarea
            className={compactTextareaClassName}
            name="actualOutput"
            placeholder="完成后补：提交号、验证结果、残留问题"
          />
        </Field>
        <div className="flex justify-end">
          <button className={primaryButtonClassName} type="submit">
            记录 CodexRun
          </button>
        </div>
      </form>
    </article>
  );
}

function TaskSelect({ tasks }: { tasks: Task[] }) {
  return (
    <select className={inputClassName} name="taskId" defaultValue="">
      <option value="">不关联</option>
      {tasks.map((task) => (
        <option key={task.id} value={task.id}>
          {task.code} {task.title}
        </option>
      ))}
    </select>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="break-words leading-6 text-zinc-300">
        {value || "未填写"}
      </div>
    </div>
  );
}

function TagList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((item) => <Badge key={item}>{item}</Badge>)
        ) : (
          <span className="text-sm text-zinc-500">未填写</span>
        )}
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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex border border-emerald-700 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-300">
      {children}
    </span>
  );
}

function formatCreatedAt(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

const inputClassName =
  "border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const compactTextareaClassName =
  "min-h-20 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500";
const primaryButtonClassName =
  "border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400";
const secondaryButtonClassName =
  "border border-zinc-700 bg-zinc-950 px-3 py-2 text-base font-semibold text-zinc-100 hover:border-emerald-500 hover:text-emerald-300";
