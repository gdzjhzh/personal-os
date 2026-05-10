import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type {
  CreateProductTeardownInput,
  CreateReviewInput,
  CreateTaskInput,
  ProductTeardown,
  Store,
  Task,
  TaskStatus,
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

export async function exportDailyMarkdown(date: string) {
  const store = await readStore();
  const latestReview = [...store.reviews]
    .reverse()
    .find((review) => review.date === date);
  const p0Decision = chooseTodayP0(store.tasks);
  const markdown = buildDailyMarkdown({
    date,
    tasks: store.tasks,
    latestReview,
    p0Decision,
    productTeardowns: store.productTeardowns.filter(
      (teardown) => teardown.date === date,
    ),
  });
  const filePath = resolveDailyMarkdownPath(date);

  await mkdir(path.dirname(filePath), { recursive: true });
  await upsertGeneratedBlock(filePath, markdown);

  return filePath;
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
  };
}

function normalizeStore(value: unknown): Store {
  const store = value as Partial<Store>;

  return {
    tasks: Array.isArray(store.tasks) ? store.tasks : [],
    reviews: Array.isArray(store.reviews) ? store.reviews : [],
    productTeardowns: Array.isArray(store.productTeardowns)
      ? store.productTeardowns
      : [],
  };
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
