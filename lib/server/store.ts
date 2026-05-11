import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type {
  AiDailyReview,
  AiWeeklyReview,
  CreateAiDailyReviewInput,
  CreateAiWeeklyReviewInput,
  CreateCodexRunInput,
  CreateEvidenceInput,
  CreateProductTeardownInput,
  CreateReviewInput,
  CreateTaskInput,
  CodexRun,
  Evidence,
  OperatingContext,
  ProductTeardown,
  Store,
  Task,
  TaskStatus,
  UpdateCodexRunPatch,
  UpdateOperatingContextInput,
  UpdateTaskPatch,
} from "@/lib/types";
import { chooseTodayP0 } from "@/lib/server/scoring";
import {
  buildDailyMarkdown,
  resolveDailyMarkdownPath,
  upsertGeneratedBlock,
} from "@/lib/server/markdown";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

export async function readStore(): Promise<Store> {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }

    const seed = createSeedStore();
    await writeStore(seed);
    return seed;
  }
}

export async function writeStore(store: Store) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    STORE_PATH,
    `${JSON.stringify(normalizeStore(store), null, 2)}\n`,
    "utf8",
  );
}

export async function getTasks() {
  const store = await readStore();
  return store.tasks;
}

export async function createTask(input: CreateTaskInput) {
  const store = await readStore();
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID(),
    code: nextTaskCode(store.tasks),
    title: input.title.trim(),
    project: input.project?.trim() || "Personal SaaS OS",
    priority: input.priority || "P2",
    status: input.status || "inbox",
    codexFit: input.codexFit || "medium",
    owner: input.owner || "mixed",
    nextAction: input.nextAction?.trim() || "",
    doneWhen: input.doneWhen?.trim() || "",
    doNot: input.doNot || [],
    riskFlags: input.riskFlags || [],
    waitingFor: emptyToUndefined(input.waitingFor),
    notes: emptyToUndefined(input.notes),
    quadrant: input.quadrant,
    plannedFor: emptyToUndefined(input.plannedFor),
    createdAt: now,
    updatedAt: now,
  };

  store.tasks.push(task);
  await writeStore(store);
  return task;
}

export async function updateTask(id: string, patch: UpdateTaskPatch) {
  const store = await readStore();
  const index = store.tasks.findIndex((task) => task.id === id);

  if (index === -1) {
    throw new Error(`Task not found: ${id}`);
  }

  const now = new Date().toISOString();
  const current = store.tasks[index];
  const nextStatus = patch.status;
  const next: Task = {
    ...current,
    ...patch,
    updatedAt: now,
  };

  if (nextStatus === "done" && !next.completedAt) {
    next.completedAt = now;
  }

  store.tasks[index] = next;
  await writeStore(store);
  return next;
}

export async function createReview(input: CreateReviewInput) {
  const store = await readStore();
  const review = {
    ...input,
    createdAt: new Date().toISOString(),
  };

  store.reviews.push(review);
  await writeStore(store);
  return review;
}

export async function createProductTeardown(input: CreateProductTeardownInput) {
  const store = await readStore();
  const now = new Date().toISOString();
  const teardown: ProductTeardown = {
    ...input,
    id: crypto.randomUUID(),
    date: input.date,
    productName: input.productName.trim(),
    productUrl: emptyToUndefined(input.productUrl),
    source: input.source,
    problem: input.problem.trim(),
    targetUser: input.targetUser.trim(),
    whyUsersNeedIt: input.whyUsersNeedIt.trim(),
    userReviews: input.userReviews.trim(),
    acquisition: input.acquisition.trim(),
    revenueSignal: input.revenueSignal.trim(),
    whatILearned: input.whatILearned.trim(),
    hardPart: input.hardPart.trim(),
    oneSentencePitch: input.oneSentencePitch.trim(),
    alternativeApproach: input.alternativeApproach.trim(),
    canIBuildIt: input.canIBuildIt.trim(),
    coldStartStrategy: input.coldStartStrategy.trim(),
    notes: emptyToUndefined(input.notes),
    createdAt: now,
    updatedAt: now,
  };

  store.productTeardowns.push(teardown);
  await writeStore(store);
  return teardown;
}

export async function getProductTeardownsByDate(date: string) {
  const store = await readStore();

  return store.productTeardowns.filter((teardown) => teardown.date === date);
}

export async function createAiDailyReview(input: CreateAiDailyReviewInput) {
  const store = await readStore();
  const review: AiDailyReview = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  store.aiDailyReviews.push(review);
  await writeStore(store);
  return review;
}

export async function createAiWeeklyReview(input: CreateAiWeeklyReviewInput) {
  const store = await readStore();
  const review: AiWeeklyReview = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  store.aiWeeklyReviews.push(review);
  await writeStore(store);
  return review;
}

export async function getAiDailyReviewByDate(date: string) {
  const store = await readStore();

  return latestByCreatedAt(
    store.aiDailyReviews.filter((review) => review.date === date),
  );
}

export async function getAiWeeklyReviewByRange(
  weekStart: string,
  weekEnd: string,
) {
  const store = await readStore();

  return latestByCreatedAt(
    store.aiWeeklyReviews.filter(
      (review) =>
        review.weekStart === weekStart && review.weekEnd === weekEnd,
    ),
  );
}

export async function exportDailyMarkdown(date: string) {
  const store = await readStore();
  const latestReview = [...store.reviews]
    .reverse()
    .find((review) => review.date === date);
  const latestAiDailyReview = latestByCreatedAt(
    store.aiDailyReviews.filter((review) => review.date === date),
  );
  const p0Decision = chooseTodayP0(store.tasks);
  const markdown = buildDailyMarkdown({
    date,
    tasks: store.tasks,
    latestReview,
    latestAiDailyReview,
    p0Decision,
    codexRuns: store.codexRuns.filter((run) => run.date === date),
    evidence: store.evidence.filter((item) => item.date === date),
    operatingContext: store.operatingContext,
    productTeardowns: store.productTeardowns.filter(
      (teardown) => teardown.date === date,
    ),
  });
  const filePath = resolveDailyMarkdownPath(date);

  await mkdir(path.dirname(filePath), { recursive: true });
  await upsertGeneratedBlock(filePath, markdown);

  return filePath;
}

export async function createCodexRun(input: CreateCodexRunInput) {
  const store = await readStore();
  const now = new Date().toISOString();
  const run: CodexRun = {
    ...input,
    id: crypto.randomUUID(),
    date: input.date,
    taskId: emptyToUndefined(input.taskId),
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    expectedOutput: input.expectedOutput.trim(),
    actualOutput: input.actualOutput.trim(),
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };

  store.codexRuns.push(run);
  await writeStore(store);
  return run;
}

export async function updateCodexRun(id: string, patch: UpdateCodexRunPatch) {
  const store = await readStore();
  const index = store.codexRuns.findIndex((run) => run.id === id);

  if (index === -1) {
    throw new Error(`Codex run not found: ${id}`);
  }

  const current = store.codexRuns[index];
  const next: CodexRun = {
    ...current,
    ...patch,
    taskId: patch.taskId === undefined ? current.taskId : emptyToUndefined(patch.taskId),
    title: patch.title?.trim() || current.title,
    prompt: patch.prompt?.trim() || current.prompt,
    expectedOutput: patch.expectedOutput?.trim() || current.expectedOutput,
    actualOutput:
      patch.actualOutput === undefined
        ? current.actualOutput
        : patch.actualOutput.trim(),
    updatedAt: new Date().toISOString(),
  };

  store.codexRuns[index] = next;
  await writeStore(store);
  return next;
}

export async function createEvidence(input: CreateEvidenceInput) {
  const store = await readStore();
  const now = new Date().toISOString();
  const evidence: Evidence = {
    ...input,
    id: crypto.randomUUID(),
    date: input.date,
    title: input.title.trim(),
    description: input.description.trim(),
    artifactUrl: emptyToUndefined(input.artifactUrl),
    taskId: emptyToUndefined(input.taskId),
    codexRunId: emptyToUndefined(input.codexRunId),
    createdAt: now,
    updatedAt: now,
  };

  store.evidence.push(evidence);
  await writeStore(store);
  return evidence;
}

export async function updateOperatingContext(
  input: UpdateOperatingContextInput,
) {
  const store = await readStore();
  const operatingContext: OperatingContext = {
    northStar: input.northStar.trim(),
    currentFocus: input.currentFocus.trim(),
    activeConstraints: input.activeConstraints,
    antiGoals: input.antiGoals,
    principles: input.principles,
    updatedAt: new Date().toISOString(),
  };

  store.operatingContext = operatingContext;
  await writeStore(store);
  return operatingContext;
}

function createSeedStore(): Store {
  const now = new Date().toISOString();

  return {
    tasks: [
      {
        id: crypto.randomUUID(),
        code: "T001",
        title: "实现 Active Task SSOT 静态页面",
        project: "Personal SaaS OS",
        priority: "P0",
        status: "active",
        codexFit: "high",
        owner: "mixed",
        nextAction: "用 mock data 完成 /today 页面",
        doneWhen: "页面能展示 P0、Active 表格、Codex 队列、Waiting 队列、复盘区",
        doNot: [],
        riskFlags: ["任务过大", "过度设计"],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        code: "T002",
        title: "实现每日复盘导出到 Obsidian",
        project: "Personal SaaS OS",
        priority: "P1",
        status: "waiting",
        codexFit: "medium",
        owner: "mixed",
        nextAction: "先把复盘内容导出为 Markdown",
        doneWhen: "点击按钮后生成当天 Markdown 文件",
        doNot: [],
        riskFlags: ["scope creep"],
        waitingFor: "等 T001 页面可用后再做",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        code: "T003",
        title: "拆解 3 个 SaaS 产品",
        project: "Product Research",
        priority: "P1",
        status: "active",
        codexFit: "low",
        owner: "human",
        nextAction: "今天只记录 3 个产品的核心问题、用户、冷启动方式",
        doneWhen: "产出 3 张产品拆解卡片",
        doNot: [],
        riskFlags: ["信息刷屏", "泛学习"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    reviews: [],
    productTeardowns: [],
    aiDailyReviews: [],
    aiWeeklyReviews: [],
    codexRuns: [],
    evidence: [],
    operatingContext: createDefaultOperatingContext(now),
  };
}

function normalizeStore(value: unknown): Store {
  const store = value as Partial<Store>;
  const now = new Date().toISOString();

  return {
    tasks: Array.isArray(store.tasks) ? store.tasks : [],
    reviews: Array.isArray(store.reviews) ? store.reviews : [],
    productTeardowns: Array.isArray(store.productTeardowns)
      ? store.productTeardowns
      : [],
    aiDailyReviews: Array.isArray(store.aiDailyReviews)
      ? store.aiDailyReviews
      : [],
    aiWeeklyReviews: Array.isArray(store.aiWeeklyReviews)
      ? store.aiWeeklyReviews
      : [],
    codexRuns: Array.isArray(store.codexRuns) ? store.codexRuns : [],
    evidence: Array.isArray(store.evidence) ? store.evidence : [],
    operatingContext: normalizeOperatingContext(store.operatingContext, now),
  };
}

function createDefaultOperatingContext(now: string): OperatingContext {
  return {
    northStar: "成为能持续交付独立 SaaS 产品的人。",
    currentFocus: "每天围绕一个真实产出推进最小闭环。",
    activeConstraints: ["本地优先", "不引入数据库", "不做泛学习"],
    antiGoals: ["刷信息", "重构系统", "做通用项目管理"],
    principles: ["任务必须有 nextAction 和 doneWhen", "真实产出优先于阅读", "复盘要更新系统"],
    updatedAt: now,
  };
}

function normalizeOperatingContext(
  value: unknown,
  now: string,
): OperatingContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return createDefaultOperatingContext(now);
  }

  const context = value as Partial<OperatingContext>;

  return {
    northStar:
      typeof context.northStar === "string" && context.northStar.trim()
        ? context.northStar
        : "成为能持续交付独立 SaaS 产品的人。",
    currentFocus:
      typeof context.currentFocus === "string" && context.currentFocus.trim()
        ? context.currentFocus
        : "每天围绕一个真实产出推进最小闭环。",
    activeConstraints: Array.isArray(context.activeConstraints)
      ? context.activeConstraints.filter((item) => typeof item === "string")
      : ["本地优先", "不引入数据库", "不做泛学习"],
    antiGoals: Array.isArray(context.antiGoals)
      ? context.antiGoals.filter((item) => typeof item === "string")
      : ["刷信息", "重构系统", "做通用项目管理"],
    principles: Array.isArray(context.principles)
      ? context.principles.filter((item) => typeof item === "string")
      : ["任务必须有 nextAction 和 doneWhen", "真实产出优先于阅读", "复盘要更新系统"],
    updatedAt:
      typeof context.updatedAt === "string" && context.updatedAt
        ? context.updatedAt
        : now,
  };
}

function latestByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function nextTaskCode(tasks: Task[]) {
  const max = tasks.reduce((currentMax, task) => {
    const match = /^T(\d+)$/.exec(task.code);
    if (!match) {
      return currentMax;
    }

    return Math.max(currentMax, Number(match[1]));
  }, 0);

  return `T${String(max + 1).padStart(3, "0")}`;
}

function emptyToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const TASK_STATUSES: TaskStatus[] = [
  "inbox",
  "active",
  "codex_ready",
  "codex_running",
  "review",
  "waiting",
  "frozen",
  "done",
  "dropped",
];
