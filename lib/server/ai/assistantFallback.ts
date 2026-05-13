import type { CoachContextPack } from "@/lib/server/ai/coachContext";
import type { PersonalCoachMode } from "@/lib/server/ai/personalCoach";

export function buildAssistantFallback(params: {
  intent: PersonalCoachMode;
  rawInput: string;
  contextPack: CoachContextPack;
  reason: "timeout" | "missing_api_key" | "request_error" | "parse_error";
}): string {
  const prefix = fallbackPrefix(params.reason);

  if (params.intent === "quick_answer") {
    return `${prefix}

我先给你一个简短可执行回答：当前记录里没有足够信息做完整 AI 分析。你可以先把问题压成一句“我要解决什么 / 产出什么 / 今天能验证什么”。

下一步动作：用 10 分钟写出一个最小输出物，再决定是否需要进入任务系统。`;
  }

  if (params.intent === "plan_today") {
    return buildPlanTodayFallback(params.contextPack, prefix);
  }

  if (params.intent === "daily_review") {
    return buildDailyReviewFallback(params.contextPack, prefix);
  }

  if (params.intent === "task_breakdown") {
    return buildTaskBreakdownFallback(params.rawInput, prefix);
  }

  if (params.intent === "knowledge_recall") {
    return buildKnowledgeRecallFallback(params.contextPack, prefix);
  }

  return buildScheduleFallback(params.contextPack, prefix);
}

function buildPlanTodayFallback(context: CoachContextPack, prefix: string) {
  const p0 = pickP0(context);
  const why =
    context.currentWeekMilestone?.mustShip ||
    context.currentMonthGoal?.successMetric ||
    context.operatingContext.currentFocus ||
    "当前记录里没有足够信息，只能先选择最小可推进动作。";

  return `${prefix}

## 今天的 P0
${p0.title}

为什么这是最高杠杆动作：${why}

## 具体动作
1. 打开当前 P0 相关材料，写清楚下一步。
doneWhen：得到一条不超过 3 行的 nextAction。
2. 完成一个最小输出物，不扩展范围。
doneWhen：有一个可检查的文件、截图、记录、提交或复盘证据。
3. 把结果写回 Personal OS。
doneWhen：任务状态、完成证据或复盘笔记至少更新一项。

## 建议时间块
- 25 分钟：只推进 P0 的最小动作。
- 10 分钟：补记录和证据。
- 5 分钟：决定下一步是否继续、等待或收尾。

风险提醒：不要把今天变成泛学习或系统整理。晚上复盘问题：今天哪一个证据最能证明我真的推进了？`;
}

function buildDailyReviewFallback(context: CoachContextPack, prefix: string) {
  const activeTasks = context.activeTasks.slice(0, 3);
  const learning = context.recentLearningLogs[0];

  return `${prefix}

## 今日复盘模板
1. 今天推进了什么：
${activeTasks.length > 0 ? activeTasks.map((task) => `- ${task.code} ${task.title}：${task.doneWhen || "补一个完成证据"}`).join("\n") : "- 当前记录里没有足够任务信息，请写下今天最接近完成的一个输出。"}

2. 今天学到了什么：
${learning ? `- 最近学习记录提示：${learning.title}。可复述 insight：${learning.insight || learning.summary}` : "- 当前记录里没有足够学习记录，请写下一个能复述给别人的 insight。"}

3. 哪个知识值得沉淀：
- 选择今天最能复用的一条经验，保存为知识卡片，而不是保存一整段流水账。

4. 今天最有成就感的证据：
- 文件、截图、commit、导出的 Markdown、任务状态变化、产品拆解卡片都可以。

5. 明天最小 P0：
${pickP0(context).title}

## 建议保存的 LearningLog 草稿
- title：今天最重要的一个 insight
- summary：我今天做了什么，以及这个 insight 从哪里来
- insight：以后遇到类似问题可以复用的判断
- tags：复盘, Personal OS
`;
}

function buildTaskBreakdownFallback(rawInput: string, prefix: string) {
  const target = rawInput.trim() || "当前目标";

  return `${prefix}

## 目标重述
${target}

## 最小可交付版本
先做一个 25-45 分钟内可检查的版本，只证明方向能推进，不追求完整。

## 行动步骤
1. 写清楚输入和期望输出。
doneWhen：得到一段 3 行以内的目标说明。
2. 做最小实现或最小验证。
doneWhen：有一个可打开、可运行、可阅读或可截图的产物。
3. 记录风险和不做什么。
doneWhen：列出 1 个主要风险和 1 个明确 doNot。
4. 回写系统。
doneWhen：任务 nextAction、doneWhen 或复盘记录被更新。

可能卡住点：范围变大、开始找资料、想一次性做完整。

下一步马上能做什么：打开相关文件或材料，只写第一条 nextAction。`;
}

function buildKnowledgeRecallFallback(context: CoachContextPack, prefix: string) {
  const snippets = context.relevantKnowledgeSnippets.slice(0, 5);

  return `${prefix}

## 从本地记录回忆到的内容
${snippets.length > 0 ? snippets.map((snippet) => `- ${snippet.title}：${snippet.summary || snippet.quote || "有相关记录，但内容较短。"}（${snippet.relevanceReason}）`).join("\n") : "- 当前记录里没有足够信息。先把今天的问题写成一个知识卡片草稿。"}

## 可复用 insight
${snippets[0]?.quote || snippets[0]?.summary || "先保留一个能服务当前任务的判断：知识只有在能改变下一步动作时才值得沉淀。"}

## 应用建议
选择一条 insight，立刻绑定到当前 P0：写下“它会改变我今天哪一个动作”。`;
}

function buildScheduleFallback(context: CoachContextPack, prefix: string) {
  const p0 = pickP0(context);

  return `${prefix}

## 时间块安排
- 09:30-10:00：P0 启动。目标：${p0.title}。结束证据：写出 nextAction 和 doneWhen。
- 10:00-11:00：深度推进。目标：完成最小输出物。结束证据：文件、截图、commit 或记录。
- 11:00-11:15：buffer。目标：处理阻塞，不扩展新任务。结束证据：更新风险或等待项。
- 14:00-15:00：补齐证据。目标：把结果写回 Personal OS 或 Markdown。结束证据：任务状态或复盘记录更新。
- 21:30-21:45：复盘。目标：记录今天推进了什么、学到了什么、明天最小 P0。
`;
}

function pickP0(context: CoachContextPack) {
  const activeP0 =
    context.activeTasks.find((task) => task.priority === "P0") ||
    context.activeTasks[0];

  if (activeP0) {
    return {
      title: `${activeP0.code ? `${activeP0.code} ` : ""}${activeP0.title}`,
      doneWhen: activeP0.doneWhen,
    };
  }

  if (context.currentWeekMilestone) {
    return {
      title: context.currentWeekMilestone.mustShip || context.currentWeekMilestone.outcome,
      doneWhen: context.currentWeekMilestone.evidence.join("、"),
    };
  }

  if (context.currentMonthGoal) {
    return {
      title: context.currentMonthGoal.title,
      doneWhen: context.currentMonthGoal.successMetric,
    };
  }

  return {
    title: context.operatingContext.currentFocus || "写下今天唯一要推进的最小产出",
    doneWhen: "有一条可检查的完成证据",
  };
}

function fallbackPrefix(reason: string) {
  if (reason === "missing_api_key") {
    return "当前未配置 AI Key，先给出本地规则版建议。";
  }

  if (reason === "timeout") {
    return "模型响应超时，我先给你一个可执行的本地兜底结果。";
  }

  if (reason === "parse_error") {
    return "AI 输出格式不稳定，我先给出本地规则版结果。";
  }

  return "AI 请求暂时不可用，我先给出本地规则版建议。";
}
