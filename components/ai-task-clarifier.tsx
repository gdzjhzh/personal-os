"use client";

import { useEffect, useState } from "react";

import {
  TaskGateDialog,
  type TaskGateInitialPayload,
  type TaskGateSessionSnapshot,
} from "@/components/task-gate-dialog";
import type { DeepSeekModelInfo } from "@/lib/server/ai/deepseek";

const currentPhaseContext =
  "让 Personal SaaS OS 成为日用的任务规划和复盘系统";
const taskGateDraftStorageKey = "personal-os.ai-task-gate.draft.v1";

type ActiveDialogPayload = TaskGateInitialPayload & {
  restoredSession?: TaskGateSessionSnapshot;
};

type StoredTaskGateDraft = {
  rawTask: string;
  project: string;
  savedAt: string;
  session?: TaskGateSessionSnapshot;
};

export function AiTaskClarifier({
  modelInfo,
}: {
  modelInfo: DeepSeekModelInfo;
}) {
  const [rawTask, setRawTask] = useState("");
  const [project, setProject] = useState("Personal SaaS OS");
  const [inputError, setInputError] = useState("");
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [loadedDraftSavedAt, setLoadedDraftSavedAt] = useState("");
  const [savedSession, setSavedSession] =
    useState<TaskGateSessionSnapshot | null>(null);
  const [dialogPayload, setDialogPayload] =
    useState<ActiveDialogPayload | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = readStoredTaskGateDraft();

      if (draft) {
        setRawTask(draft.session?.initialPayload.rawTask || draft.rawTask);
        setProject(
          draft.session?.initialPayload.project ||
            draft.project ||
            "Personal SaaS OS",
        );
        setSavedSession(draft.session || null);
        setLoadedDraftSavedAt(draft.savedAt);
      }

      setHasLoadedDraft(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasLoadedDraft) {
      return;
    }

    const rawTaskToSave = savedSession?.initialPayload.rawTask || rawTask;
    const projectToSave =
      savedSession?.initialPayload.project ||
      project.trim() ||
      "Personal SaaS OS";

    if (!rawTaskToSave.trim() && !savedSession) {
      window.localStorage.removeItem(taskGateDraftStorageKey);
      return;
    }

    const draft: StoredTaskGateDraft = {
      rawTask: rawTaskToSave,
      project: projectToSave,
      savedAt: savedSession?.updatedAt || new Date().toISOString(),
      session: savedSession || undefined,
    };

    window.localStorage.setItem(
      taskGateDraftStorageKey,
      JSON.stringify(draft),
    );
  }, [hasLoadedDraft, project, rawTask, savedSession]);

  function startDialog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = rawTask.trim();

    if (!trimmed) {
      setInputError("请先输入一个想法。");
      return;
    }

    setInputError("");
    setSavedSession(null);
    setLoadedDraftSavedAt("");
    setDialogPayload({
      requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rawTask: trimmed,
      project: project.trim() || "Personal SaaS OS",
      currentPhaseContext,
    });
  }

  function restoreDialog() {
    if (!savedSession) {
      return;
    }

    setRawTask(savedSession.initialPayload.rawTask);
    setProject(savedSession.initialPayload.project || "Personal SaaS OS");
    setInputError("");
    setDialogPayload({
      ...savedSession.initialPayload,
      requestKey: `${savedSession.initialPayload.requestKey}-restore-${Date.now()}`,
      restoredSession: savedSession,
    });
  }

  function clearDraft() {
    window.localStorage.removeItem(taskGateDraftStorageKey);
    setRawTask("");
    setProject("Personal SaaS OS");
    setInputError("");
    setSavedSession(null);
    setLoadedDraftSavedAt("");
  }

  function updateRawTask(value: string) {
    setRawTask(value);
    clearSavedSessionIfEditingDraft();
  }

  function updateProject(value: string) {
    setProject(value);
    clearSavedSessionIfEditingDraft();
  }

  function clearSavedSessionIfEditingDraft() {
    if (!savedSession) {
      return;
    }

    setSavedSession(null);
    setLoadedDraftSavedAt("");
  }

  const hasRecoverableDraft =
    hasLoadedDraft && Boolean(savedSession || loadedDraftSavedAt);

  return (
    <section className="grid gap-4 border border-zinc-800 bg-black/80 p-4">
      <div className="grid gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <h2 className="text-base font-semibold text-zinc-100">
              AI 任务准入
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-zinc-500">
              这是任务梳理前的闸门：先判断这个想法是否值得进入任务系统，再生成可保存的任务草稿。和超级助手不同，这里的结果会围绕 nextAction、doneWhen、优先级、风险和是否写入任务池展开。
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

      {hasRecoverableDraft ? (
        <DraftRecoveryNotice
          canRestore={Boolean(savedSession)}
          savedAt={savedSession?.updatedAt || loadedDraftSavedAt}
          onClear={clearDraft}
          onRestore={restoreDialog}
        />
      ) : null}

      <form className="grid gap-3" onSubmit={startDialog}>
        <label className="grid gap-1.5 text-sm text-zinc-500">
          想法
          <textarea
            className="min-h-28 resize-y border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
            placeholder="例如：小程序 / 验证一个产品入口想法 / 今天要不要继续优化系统"
            value={rawTask}
            onChange={(event) => updateRawTask(event.target.value)}
          />
        </label>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1.5 text-sm text-zinc-500">
            项目
            <input
              className="border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-500"
              value={project}
              onChange={(event) => updateProject(event.target.value)}
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
          initialSession={dialogPayload.restoredSession}
          key={dialogPayload.requestKey}
          onSessionChange={setSavedSession}
          onTaskSaved={clearDraft}
          onClose={() => setDialogPayload(null)}
        />
      ) : null}
    </section>
  );
}

function DraftRecoveryNotice({
  canRestore,
  savedAt,
  onClear,
  onRestore,
}: {
  canRestore: boolean;
  savedAt: string;
  onClear: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="grid gap-3 border border-amber-900 bg-amber-950/20 p-3 text-sm text-amber-50 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="grid gap-1">
        <div className="font-semibold">上次未完成的 AI 讨论已保留</div>
        <div className="leading-6 text-amber-100/80">
          {savedAt ? `保存于 ${formatSavedAt(savedAt)}。` : ""}
          现在刷新页面或切换视图，不会再直接丢失当前讨论。
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRestore ? (
          <button
            className="min-h-9 border border-amber-500 bg-amber-400 px-3 py-1.5 font-semibold text-black hover:bg-amber-300"
            type="button"
            onClick={onRestore}
          >
            恢复对话
          </button>
        ) : null}
        <button
          className="min-h-9 border border-zinc-700 bg-black px-3 py-1.5 font-semibold text-zinc-200 hover:border-zinc-500"
          type="button"
          onClick={onClear}
        >
          清除记录
        </button>
      </div>
    </div>
  );
}

function readStoredTaskGateDraft() {
  try {
    return parseStoredTaskGateDraft(
      window.localStorage.getItem(taskGateDraftStorageKey),
    );
  } catch {
    return null;
  }
}

function parseStoredTaskGateDraft(value: string | null): StoredTaskGateDraft | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredTaskGateDraft>;

    if (typeof parsed.rawTask !== "string") {
      return null;
    }

    return {
      rawTask: parsed.rawTask,
      project:
        typeof parsed.project === "string" && parsed.project.trim()
          ? parsed.project
          : "Personal SaaS OS",
      savedAt:
        typeof parsed.savedAt === "string" && parsed.savedAt
          ? parsed.savedAt
          : new Date().toISOString(),
      session: isStoredTaskGateSession(parsed.session)
        ? parsed.session
        : undefined,
    };
  } catch {
    return null;
  }
}

function isStoredTaskGateSession(
  value: unknown,
): value is TaskGateSessionSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const session = value as Partial<TaskGateSessionSnapshot>;
  const payload = session.initialPayload as Partial<TaskGateInitialPayload>;

  return (
    typeof payload?.requestKey === "string" &&
    typeof payload.rawTask === "string" &&
    typeof payload.project === "string" &&
    typeof payload.currentPhaseContext === "string" &&
    Array.isArray(session.dialogMessages)
  );
}

function formatSavedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
