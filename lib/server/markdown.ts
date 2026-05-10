import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import type {
  AiDailyReview,
  CodexRun,
  DailyReview,
  Evidence,
  OperatingContext,
  ProductTeardown,
  Task,
} from "@/lib/types";
import {
  DO_NOT_DO_LIST,
  minimumActionFromP0,
  scheduleAdvice,
  type P0Decision,
} from "@/lib/server/scoring";

const START_MARKER = "<!-- PSOS_START -->";
const END_MARKER = "<!-- PSOS_END -->";

type DailyMarkdownInput = {
  date: string;
  tasks: Task[];
  latestReview?: DailyReview;
  latestAiDailyReview?: AiDailyReview;
  p0Decision: P0Decision;
  codexRuns: CodexRun[];
  evidence: Evidence[];
  operatingContext: OperatingContext;
  productTeardowns: ProductTeardown[];
};

export function resolveDailyMarkdownPath(date: string) {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH?.trim();

  if (vaultPath) {
    return path.join(vaultPath, "00-Daily", `${date}.md`);
  }

  return path.join(process.cwd(), "exports", `${date}.md`);
}

export function buildDailyMarkdown({
  date,
  tasks,
  latestReview,
  latestAiDailyReview,
  p0Decision,
  codexRuns,
  evidence,
  operatingContext,
  productTeardowns,
}: DailyMarkdownInput) {
  const p0 = p0Decision.task;
  const activeTasks = tasks.filter((task) =>
    ["inbox", "active", "codex_ready", "codex_running"].includes(task.status),
  );
  const codexReady = tasks.filter((task) =>
    ["codex_ready", "codex_running"].includes(task.status),
  );
  const waitingReview = tasks.filter((task) =>
    ["waiting", "review", "frozen"].includes(task.status),
  );

  return `${START_MARKER}
# Personal SaaS OS - ${date}

## 今日 P0
${p0 ? `- ${p0.code} ${p0.title}` : "- 暂无 P0"}
${p0 ? `- Next Action: ${p0.nextAction || "未填写"}` : ""}
${p0 ? `- Done When: ${p0.doneWhen || "未填写"}` : ""}
${p0 ? `- Why: ${p0Decision.reasons.join("；")}` : ""}

## 最小 25 分钟动作
${minimumActionFromP0(p0)}

## 今日不该做什么
${DO_NOT_DO_LIST.map((item) => `- ${item}`).join("\n")}

## Active Tasks table
| 优先级 | 任务 | 状态 | Codex 适配度 | 当前可推进动作 | 完成标准 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
${activeTasks.map(taskToMarkdownRow).join("\n") || "| - | - | - | - | - | - | - |"}

## Codex Ready queue
${queueLines(codexReady)}

## Waiting / Review queue
${queueLines(waitingReview)}

## 今日 3 个产品拆解
${productTeardownMarkdown(productTeardowns)}

## Growth Loop V0.2
${operatingContextMarkdown(operatingContext)}

### CodexRun 技术交付
${codexRunsMarkdown(codexRuns)}

### Evidence 真实产出
${evidenceMarkdown(evidence)}

## Evening Review
- 今日真实产出：${latestReview?.actualOutput || "未填写"}
- 今日伪忙碌：${latestReview?.fakeProgress || "未填写"}
- 偏离标签：${latestReview?.driftFlags.join(", ") || "无"}
- 明日 P0：${latestReview?.tomorrowP0 || "未填写"}
- 系统更新：${latestReview?.systemUpdate || "未填写"}
- 备注：${latestReview?.notes || "无"}

## AI 每日复盘
${aiDailyReviewMarkdown(latestAiDailyReview)}

## AI 排程建议
${scheduleAdvice(p0Decision)}
${END_MARKER}
`;
}

export async function upsertGeneratedBlock(filePath: string, markdown: string) {
  let previous = "";

  try {
    previous = await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }
  }

  const startIndex = previous.indexOf(START_MARKER);
  const endIndex = previous.indexOf(END_MARKER);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = previous.slice(0, startIndex).trimEnd();
    const after = previous.slice(endIndex + END_MARKER.length).trimStart();
    const next = [before, markdown.trim(), after].filter(Boolean).join("\n\n");

    await writeFile(filePath, `${next}\n`, "utf8");
    return;
  }

  const next = [previous.trimEnd(), markdown.trim()].filter(Boolean).join("\n\n");
  await writeFile(filePath, `${next}\n`, "utf8");
}

function taskToMarkdownRow(task: Task) {
  return [
    task.priority,
    `${task.code} ${escapeCell(task.title)}`,
    task.status,
    task.codexFit,
    escapeCell(task.nextAction || "未填写"),
    escapeCell(task.doneWhen || "未填写"),
    escapeCell(task.riskFlags.join(", ") || "无"),
  ]
    .map((value) => ` ${value} `)
    .join("|")
    .replace(/^/, "|")
    .replace(/$/, "|");
}

function queueLines(tasks: Task[]) {
  if (tasks.length === 0) {
    return "- 无";
  }

  return tasks
    .map((task) => `- ${task.code} ${task.title} [${task.status}] - ${task.nextAction}`)
    .join("\n");
}

function productTeardownMarkdown(productTeardowns: ProductTeardown[]) {
  if (productTeardowns.length === 0) {
    return "- 今日未记录产品拆解。";
  }

  return productTeardowns
    .map(
      (teardown) => `### ${singleLine(teardown.productName) || "未命名产品"}

- 来源：${teardown.source}
- 链接：${singleLine(teardown.productUrl || "无")}
- 解决的问题：${singleLine(teardown.problem || "未填写")}
- 用户是谁：${singleLine(teardown.targetUser || "未填写")}
- 用户为什么需要：${singleLine(teardown.whyUsersNeedIt || "未填写")}
- 用户评价：${singleLine(teardown.userReviews || "未填写")}
- 如何找到用户：${singleLine(teardown.acquisition || "未填写")}
- 收入信号：${singleLine(teardown.revenueSignal || "未填写")}
- 我学到了什么：${singleLine(teardown.whatILearned || "未填写")}
- 什么做法不容易：${singleLine(teardown.hardPart || "未填写")}
- 一句话推销：${singleLine(teardown.oneSentencePitch || "未填写")}
- 不同的方法：${singleLine(teardown.alternativeApproach || "未填写")}
- 我能做出来吗：${singleLine(teardown.canIBuildIt || "未填写")}
- 冷启动策略：${singleLine(teardown.coldStartStrategy || "未填写")}
- 备注：${singleLine(teardown.notes || "无")}`,
    )
    .join("\n\n");
}

function operatingContextMarkdown(context: OperatingContext) {
  return `### OperatingContext 长期方向
- 长期方向：${singleLine(context.northStar || "未填写")}
- 当前焦点：${singleLine(context.currentFocus || "未填写")}
- 约束：${listInline(context.activeConstraints)}
- 反目标：${listInline(context.antiGoals)}
- 运行原则：${listInline(context.principles)}`;
}

function codexRunsMarkdown(codexRuns: CodexRun[]) {
  if (codexRuns.length === 0) {
    return "- 今日未记录 CodexRun。";
  }

  return codexRuns
    .map(
      (run) => `- ${singleLine(run.title)} [${run.status}]
  - 期望产出：${singleLine(run.expectedOutput || "未填写")}
  - 实际结果：${singleLine(run.actualOutput || "未填写")}
  - 任务包：${singleLine(run.prompt || "未填写")}`,
    )
    .join("\n");
}

function evidenceMarkdown(evidence: Evidence[]) {
  if (evidence.length === 0) {
    return "- 今日未记录 Evidence。";
  }

  return evidence
    .map(
      (item) => `- ${singleLine(item.title)} [${item.type}]
  - 说明：${singleLine(item.description || "未填写")}
  - 证据：${singleLine(item.artifactUrl || "无")}`,
    )
    .join("\n");
}

function aiDailyReviewMarkdown(review?: AiDailyReview) {
  if (!review) {
    return "- 未生成 AI 每日复盘。";
  }

  return `- 今日总结：${singleLine(review.summary || "未填写")}
- 真实产出：${singleLine(review.realOutput || "未填写")}
- 伪忙碌：${singleLine(review.fakeProgress || "未填写")}
- 成长信号：${listInline(review.growthSignals)}
- 偏离警告：${listInline(review.driftWarnings)}
- 产品判断力进展：${singleLine(review.productThinkingProgress || "未填写")}
- 执行力进展：${singleLine(review.executionProgress || "未填写")}
- 技术交付进展：${singleLine(review.technicalProgress || "未填写")}
- 明日建议：${singleLine(review.nextDaySuggestion || "未填写")}
- 评分：执行 ${review.score.execution}/5，产品判断 ${review.score.productThinking}/5，技术交付 ${review.score.technicalShipping}/5，抗偏离 ${review.score.antiDrift}/5，复盘质量 ${review.score.reviewQuality}/5`;
}

function listInline(items: string[]) {
  return items.length > 0 ? items.map(singleLine).join("；") : "无";
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
