"use client";

import { useState } from "react";

import {
  TaskGateDialog,
  type TaskGateInitialPayload,
} from "@/components/task-gate-dialog";
import type { DeepSeekModelInfo } from "@/lib/server/ai/deepseek";

const currentPhaseContext =
  "让 Personal SaaS OS 成为日用的任务规划和复盘系统";

export function AiTaskClarifier({
  modelInfo,
}: {
  modelInfo: DeepSeekModelInfo;
}) {
  const [rawTask, setRawTask] = useState("");
  const [project, setProject] = useState("Personal SaaS OS");
  const [inputError, setInputError] = useState("");
  const [dialogPayload, setDialogPayload] =
    useState<TaskGateInitialPayload | null>(null);

  function startDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = rawTask.trim();

    if (!trimmed) {
      setInputError("请先输入一个想法。");
      return;
    }

    setInputError("");
    setDialogPayload({
      requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rawTask: trimmed,
      project: project.trim() || "Personal SaaS OS",
      currentPhaseContext,
    });
  }

  return (
    <section className="grid gap-4 border border-zinc-800 bg-black/80 p-4">
      <div className="grid gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold text-zinc-100">
              AI 任务准入
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-zinc-500">
              先判断这个想法是否值得进入任务系统。AI 会结合你的愿景、当前任务、复盘和近期风险与你讨论；没问题再生成任务。不符合当前情况时，它会建议暂不生成，除非你强制执行。
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
      </div>

      <form className="grid gap-3" onSubmit={startDialog}>
        <label className="grid gap-1.5 text-sm text-zinc-500">
          想法
          <textarea
            className="min-h-28 resize-y border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            placeholder="例如：小程序 / 验证一个产品入口想法 / 今天要不要继续优化系统"
            value={rawTask}
            onChange={(event) => setRawTask(event.target.value)}
          />
        </label>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1.5 text-sm text-zinc-500">
            项目
            <input
              className="border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
              value={project}
              onChange={(event) => setProject(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button
              className="min-h-11 border border-emerald-600 bg-emerald-500 px-4 py-2 text-base font-semibold text-black hover:bg-emerald-400"
              type="submit"
            >
              和 AI 讨论
            </button>
          </div>
        </div>

        {inputError ? (
          <p className="text-sm text-amber-300">{inputError}</p>
        ) : null}

        <p className="text-xs leading-5 text-zinc-500">
          AI 可能会建议不生成任务；你也可以强制生成。手动新增任务入口仍在下方。
        </p>
      </form>

      {dialogPayload ? (
        <TaskGateDialog
          initialPayload={dialogPayload}
          key={dialogPayload.requestKey}
          onClose={() => setDialogPayload(null)}
        />
      ) : null}
    </section>
  );
}
