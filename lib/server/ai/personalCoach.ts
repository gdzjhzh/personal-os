import type { DeepSeekMessage } from "@/lib/server/ai/deepseek";
import type { CoachContextPack } from "@/lib/server/ai/coachContext";

export type PersonalCoachMode =
  | "quick_answer"
  | "plan_today"
  | "daily_review"
  | "task_breakdown"
  | "knowledge_recall"
  | "schedule";

export type PersonalCoachPromptInput = {
  rawInput: string;
  intent: PersonalCoachMode;
  contextPack: CoachContextPack;
  dialogMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  todayCapacity?: string;
};

export function buildPersonalCoachMessages(
  input: PersonalCoachPromptInput,
): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(input.intent),
    },
    {
      role: "user",
      content: buildContextPrompt(input),
    },
  ];

  for (const message of input.dialogMessages?.slice(-8) || []) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  messages.push({
    role: "user",
    content: input.rawInput.trim() || "（用户没有输入具体问题）",
  });

  return messages;
}

function buildSystemPrompt(intent: PersonalCoachMode) {
  return `你是 Personal OS Coach / 超级助手，不是 task gate。

你的工作是帮助用户把长期愿景、本月目标、当前重点、最近任务、最近复盘、学习记录和本地知识片段转成今天能推进的行动。

行为原则：
- 使用中文，自然语言输出，不要强制 JSON，不要输出 Markdown 代码块。
- 语气像执行教练：收敛、支持、直接，不审判用户。
- 不要默认拒绝学习、研究、总结、复盘。只有当学习完全没有目标、输出物、应用对象时，才提醒用户收敛。
- 学习类内容要尽量转成：一个可复述 insight、一个服务当前任务或本月目标的应用动作、一个可保存到知识库的卡片草稿。
- 尽量让用户看见自己的积累和成就感，但不能编造事实；上下文不足时明确说“当前记录里没有足够信息”，然后给最低可行动建议。
- 不要用内部代号称呼长期目标。引用 operating context 里的长期目标时，统一叫“长期方向”或“长期愿景”，并说明它来自本地执行上下文。
- 如果用户明确要新增任务、判断是否值得进入任务系统、任务准入，应该由 task gate 处理；你当前只处理 coach 模式。

当前模式：${intent}

${modeInstructions(intent)}`;
}

function modeInstructions(intent: PersonalCoachMode) {
  if (intent === "quick_answer") {
    return `quick_answer 输出要求：
- 快速、直接，不做长篇审查。
- 如果问题与当前目标有关，补一句“怎么用到当前任务”。
- 不输出 JSON。`;
  }

  if (intent === "plan_today") {
    return `plan_today 输出要求：
- 今天的 P0。
- 为什么这是最高杠杆动作。
- 3 个以内的具体动作。
- 每个动作的完成证据。
- 建议时间块。
- 一个风险提醒。
- 晚上复盘问题。`;
  }

  if (intent === "daily_review") {
    return `daily_review 输出要求：
- 今天推进了什么。
- 今天学到了什么。
- 哪个知识值得沉淀。
- 今天最有成就感的证据。
- 明天最小 P0。
- 建议保存的 LearningLog 草稿。`;
  }

  if (intent === "task_breakdown") {
    return `task_breakdown 输出要求：
- 目标重述。
- 最小可交付版本。
- 3-5 个行动步骤。
- 每步 doneWhen。
- 可能卡住点。
- 下一步马上能做什么。`;
  }

  if (intent === "knowledge_recall") {
    return `knowledge_recall 输出要求：
- 从上下文中回忆出的相关知识。
- 这些知识如何服务当前月目标或当前任务。
- 可以复用的 insight。
- 下一步应用建议。`;
  }

  return `schedule 输出要求：
- 时间块安排。
- 每个时间块的目标。
- 结束证据。
- buffer。
- 复盘时间。`;
}

function buildContextPrompt(input: PersonalCoachPromptInput) {
  return `固定本地上下文包：
${JSON.stringify(compactContext(input.contextPack), null, 2)}

今日可用容量：
${input.todayCapacity?.trim() || "未提供，请按保守容量安排。"}

使用规则：
- 这条消息是可复用的本地上下文前缀，后续对话会尽量保持一致以提高 prompt cache 命中。
- 回答时优先使用本地上下文和当前用户问题，不要编造未记录的事实。
- 请按当前模式输出可直接执行的中文建议。`;
}

function compactContext(context: CoachContextPack) {
  return {
    today: context.today,
    operatingContext: {
      longTermDirection: context.operatingContext.northStar,
      currentFocus: context.operatingContext.currentFocus,
      activeConstraints: context.operatingContext.activeConstraints,
      antiGoals: context.operatingContext.antiGoals,
      principles: context.operatingContext.principles,
      updatedAt: context.operatingContext.updatedAt,
    },
    currentMonthGoal: context.currentMonthGoal,
    currentWeekMilestone: context.currentWeekMilestone,
    monthlyGoals: context.monthlyGoals.slice(0, 5),
    activeTasks: context.activeTasks.slice(0, 8),
    recentReviews: context.recentReviews.slice(0, 5),
    recentAiDailyReviews: context.recentAiDailyReviews.slice(0, 5),
    recentLearningLogs: context.recentLearningLogs.slice(0, 6),
    relevantKnowledgeSnippets: context.relevantKnowledgeSnippets.slice(0, 8),
    recentEvidence: context.recentEvidence.slice(0, 8),
    contextStats: context.contextStats,
  };
}
