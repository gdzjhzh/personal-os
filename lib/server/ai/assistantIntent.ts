export type AssistantIntent =
  | "quick_answer"
  | "plan_today"
  | "daily_review"
  | "task_breakdown"
  | "task_gate"
  | "knowledge_recall"
  | "schedule";

export type AssistantIntentResult = {
  intent: AssistantIntent;
  confidence: number;
  reason: string;
};

type Rule = {
  intent: AssistantIntent;
  confidence: number;
  keywords: string[];
  reason: string;
};

const rules: Rule[] = [
  {
    intent: "task_gate",
    confidence: 0.94,
    reason: "用户明确在问是否新增或进入任务系统。",
    keywords: [
      "新增任务",
      "创建任务",
      "变成任务",
      "做成任务",
      "加入任务",
      "要不要做",
      "是否值得做",
      "是否进入任务",
      "任务准入",
      "帮我判断这个任务",
    ],
  },
  {
    intent: "daily_review",
    confidence: 0.9,
    reason: "用户在请求今日复盘或当天学习总结。",
    keywords: [
      "复盘",
      "回顾今天",
      "今天学到",
      "学到了什么",
      "总结今天",
      "晚间复盘",
      "今日复盘",
    ],
  },
  {
    intent: "plan_today",
    confidence: 0.9,
    reason: "用户在请求今日计划或当天 P0 判断。",
    keywords: [
      "今天做什么",
      "今天先做什么",
      "今日计划",
      "今天怎么安排",
      "帮我安排今天",
      "今天如何最高效",
      "本月目标今天怎么推进",
    ],
  },
  {
    intent: "schedule",
    confidence: 0.86,
    reason: "用户在请求时间块或日程安排。",
    keywords: [
      "日程",
      "时间块",
      "time block",
      "安排到几点",
      "上午下午怎么排",
    ],
  },
  {
    intent: "task_breakdown",
    confidence: 0.84,
    reason: "用户在请求把目标拆成可执行动作。",
    keywords: ["拆解", "怎么做", "下一步", "行动步骤", "具体动作", "任务怎么拆"],
  },
  {
    intent: "knowledge_recall",
    confidence: 0.82,
    reason: "用户在请求从历史知识或学习记录中回忆相关内容。",
    keywords: [
      "知识库",
      "我学过什么",
      "最近学到",
      "最近学到了什么",
      "相关知识",
      "之前记录",
      "帮我回忆",
      "insight",
    ],
  },
  {
    intent: "quick_answer",
    confidence: 0.74,
    reason: "用户在问概念解释或普通问题。",
    keywords: ["是什么", "为什么", "怎么理解", "区别", "解释一下", "举例", "帮我理解"],
  },
];

const priority: AssistantIntent[] = [
  "task_gate",
  "daily_review",
  "plan_today",
  "schedule",
  "task_breakdown",
  "knowledge_recall",
  "quick_answer",
];

export function classifyAssistantIntent(input: string): AssistantIntentResult {
  const text = normalizeInput(input);

  if (!text) {
    return {
      intent: "quick_answer",
      confidence: 0.45,
      reason: "输入为空，交给 assistant endpoint 返回低风险提示。",
    };
  }

  const matches = rules.filter((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())),
  );

  const recentLearningRecall =
    /最近|之前|过去/.test(text) && /学到|学过|记录|回忆/.test(text);

  if (recentLearningRecall && !matches.some((rule) => rule.intent === "task_gate")) {
    return {
      intent: "knowledge_recall",
      confidence: 0.88,
      reason: "用户在问最近或之前学到的内容，优先作为知识回顾处理。",
    };
  }

  if (matches.length === 0) {
    return {
      intent: "quick_answer",
      confidence: 0.58,
      reason: "没有命中高风险或结构化工作流意图，按普通问答处理。",
    };
  }

  const selected = [...matches].sort(
    (a, b) => priority.indexOf(a.intent) - priority.indexOf(b.intent),
  )[0];

  return {
    intent: selected.intent,
    confidence: selected.confidence,
    reason: selected.reason,
  };
}

function normalizeInput(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
