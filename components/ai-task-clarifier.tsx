"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  clarifyTaskAction,
  saveClarifiedTaskAction,
} from "@/app/today/actions";
import type { AiTaskClarifierState, ClarifiedTaskDraft } from "@/lib/types";

const initialState: AiTaskClarifierState = { status: "idle" };

export function AiTaskClarifier() {
  const [state, formAction, isPending] = useActionState(
    clarifyTaskAction,
    initialState,
  );

  return (
    <section className="grid gap-3 border border-zinc-800 bg-black/80 p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-emerald-400">09</span>
        <h2 className="text-base font-semibold text-zinc-100">
          AI 任务梳理
        </h2>
      </div>

      <form action={formAction} className="grid gap-3">
        <input
          type="hidden"
          name="currentPhaseContext"
          value="make Personal SaaS OS a daily-used task planning and review system"
        />
        <label className="grid gap-1 text-sm text-zinc-500">
          待整理任务
          <textarea
            className="min-h-28 border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            name="rawTask"
            placeholder="例如：研究几个 SaaS 产品，拆出今天能推进的一步"
            required
          />
        </label>
        <div className="grid gap-2 md:grid-cols-[1fr_12rem_auto]">
          <label className="grid gap-1 text-sm text-zinc-500">
            项目
            <input
              className="border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
              name="project"
              defaultValue="Personal SaaS OS"
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-500">
            整理方式
            <select
              className="border border-zinc-800 bg-black px-2 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
              name="reasoningEffort"
              defaultValue="high"
            >
              <option value="high">high</option>
              <option value="max">max</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              className="border border-emerald-600 bg-emerald-500 px-3 py-2 text-base font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isPending}
            >
              {isPending ? "整理中..." : "整理任务"}
            </button>
          </div>
        </div>
      </form>

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
        <ClarifiedPreview task={state.task} rawOutput={state.rawOutput} />
      ) : null}
    </section>
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
        <form action={saveClarifiedTaskAction}>
          <input type="hidden" name="taskJson" value={JSON.stringify(task)} />
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
