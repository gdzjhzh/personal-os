import type {
  DecisionContextDriftPattern,
  DecisionContextPack,
  Store,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/lib/types";

const activeContextStatuses: TaskStatus[] = [
  "inbox",
  "active",
  "codex_ready",
  "codex_running",
  "review",
  "waiting",
  "frozen",
];

const priorityRank: Record<TaskPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

type PatternRule = {
  pattern: string;
  keywords: string[];
};

const driftRules: PatternRule[] = [
  {
    pattern: "泛学习",
    keywords: ["学习", "研究", "了解", "看看", "阅读", "课程", "教程", "调研"],
  },
  {
    pattern: "信息刷屏",
    keywords: [
      "网站",
      "产品",
      "竞品",
      "网页",
      "浏览",
      "搜索",
      "Google",
      "YouTube",
      "Twitter",
      "X",
      "刷",
    ],
  },
  {
    pattern: "任务过大",
    keywords: ["完整", "全部", "系统", "平台", "重构", "做完", "从零", "上线", "发布"],
  },
  {
    pattern: "系统打磨成瘾",
    keywords: [
      "优化系统",
      "重构系统",
      "整理系统",
      "配置",
      "框架",
      "架构",
      "自动化",
      "仪表盘",
    ],
  },
  {
    pattern: "产出不可观察",
    keywords: ["思考", "梳理", "规划", "整理一下", "优化一下", "推进一下"],
  },
  {
    pattern: "只整理不交付",
    keywords: ["整理", "归纳", "总结", "分类", "清单", "文档化"],
  },
  {
    pattern: "过度设计",
    keywords: ["过度设计", "抽象", "通用", "扩展性", "架构设计", "设计模式"],
  },
  {
    pattern: "scope creep",
    keywords: ["scope creep", "顺便", "再加", "扩展", "全量", "更多功能"],
  },
];

export function buildDecisionContextPack(
  rawInput: string,
  store: Store,
): DecisionContextPack {
  const operatingContext = store.operatingContext || {
    northStar: "",
    currentFocus: "",
    activeConstraints: [],
    antiGoals: [],
    principles: [],
    updatedAt: "",
  };
  const tasks = Array.isArray(store.tasks) ? store.tasks : [];
  const reviews = Array.isArray(store.reviews) ? store.reviews : [];
  const evidence = Array.isArray(store.evidence) ? store.evidence : [];
  const productTeardowns = Array.isArray(store.productTeardowns)
    ? store.productTeardowns
    : [];
  const aiDailyReviews = Array.isArray(store.aiDailyReviews)
    ? store.aiDailyReviews
    : [];
  const activeTasks = buildActiveTasks(tasks, getTodayDate());
  const recentReviews = [...reviews]
    .sort(byDateThenCreatedAt)
    .slice(0, 7)
    .map((review) => ({
      date: trimText(review.date),
      ...(trimText(review.plannedP0) ? { plannedP0: trimText(review.plannedP0) } : {}),
      actualOutput: truncateText(trimText(review.actualOutput), 300),
      fakeProgress: truncateText(trimText(review.fakeProgress), 300),
      driftFlags: trimTextArray(review.driftFlags),
      tomorrowP0: truncateText(trimText(review.tomorrowP0), 200),
      notes: truncateText(trimText(review.notes), 300),
      createdAt: trimText(review.createdAt),
    }));
  const recentEvidence = [...evidence]
    .sort(byDateThenCreatedAt)
    .slice(0, 8)
    .map((item) => ({
      id: trimText(item.id),
      date: trimText(item.date),
      type: trimText(item.type),
      title: truncateText(trimText(item.title), 160),
      description: truncateText(trimText(item.description), 400),
      ...(trimText(item.taskId) ? { taskId: trimText(item.taskId) } : {}),
      createdAt: trimText(item.createdAt),
    }));
  const recentProductTeardowns = [...productTeardowns]
    .sort(byDateThenCreatedAt)
    .slice(0, 5)
    .map((teardown) => ({
      id: trimText(teardown.id),
      date: trimText(teardown.date),
      productName: truncateText(trimText(teardown.productName), 120),
      problem: truncateText(trimText(teardown.problem), 240),
      targetUser: truncateText(trimText(teardown.targetUser), 160),
      whyUsersNeedIt: truncateText(trimText(teardown.whyUsersNeedIt), 300),
      revenueSignal: truncateText(trimText(teardown.revenueSignal), 240),
      whatILearned: truncateText(trimText(teardown.whatILearned), 400),
      hardPart: truncateText(trimText(teardown.hardPart), 240),
      alternativeApproach: truncateText(
        trimText(teardown.alternativeApproach),
        300,
      ),
      canIBuildIt: truncateText(trimText(teardown.canIBuildIt), 240),
      coldStartStrategy: truncateText(trimText(teardown.coldStartStrategy), 300),
      ...(trimText(teardown.notes)
        ? { notes: truncateText(trimText(teardown.notes), 300) }
        : {}),
      createdAt: trimText(teardown.createdAt),
    }));
  const recentDriftPatterns = buildRecentDriftPatterns({
    ...store,
    tasks,
    reviews,
    evidence,
    productTeardowns,
    aiDailyReviews,
  });

  return {
    rawInput: trimText(rawInput),
    generatedAt: new Date().toISOString(),
    operatingContext: {
      northStar: truncateText(trimText(operatingContext.northStar), 300),
      currentFocus: truncateText(trimText(operatingContext.currentFocus), 300),
      activeConstraints: trimTextArray(operatingContext.activeConstraints),
      antiGoals: trimTextArray(operatingContext.antiGoals),
      principles: trimTextArray(operatingContext.principles),
      updatedAt: trimText(operatingContext.updatedAt),
    },
    activeTasks,
    recentReviews,
    recentEvidence,
    recentProductTeardowns,
    recentDriftPatterns,
    contextStats: {
      activeTaskCount: activeTasks.length,
      recentReviewCount: recentReviews.length,
      recentEvidenceCount: recentEvidence.length,
      recentProductTeardownCount: recentProductTeardowns.length,
      recentDriftPatternCount: recentDriftPatterns.length,
    },
  };
}

function buildActiveTasks(tasks: Task[], today: string) {
  return tasks
    .filter((task) => activeContextStatuses.includes(task.status))
    .sort((a, b) => {
      const plannedDiff = Number(b.plannedFor === today) - Number(a.plannedFor === today);

      if (plannedDiff !== 0) {
        return plannedDiff;
      }

      const priorityDiff = priorityRank[a.priority] - priorityRank[b.priority];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return trimText(b.updatedAt).localeCompare(trimText(a.updatedAt));
    })
    .slice(0, 8)
    .map((task) => ({
      id: trimText(task.id),
      code: trimText(task.code),
      title: truncateText(trimText(task.title), 160),
      project: truncateText(trimText(task.project), 120),
      priority: task.priority,
      status: task.status,
      nextAction: truncateText(trimText(task.nextAction), 220),
      doneWhen: truncateText(trimText(task.doneWhen), 220),
      riskFlags: trimTextArray(task.riskFlags),
      updatedAt: trimText(task.updatedAt),
      ...(trimText(task.plannedFor) ? { plannedFor: trimText(task.plannedFor) } : {}),
    }));
}

function buildRecentDriftPatterns(store: Store): DecisionContextDriftPattern[] {
  const patterns = new Map<string, DecisionContextDriftPattern>();

  for (const task of store.tasks) {
    for (const flag of task.riskFlags) {
      addPattern(patterns, normalizeKnownPattern(flag), `任务 ${task.code}: ${flag}`);
    }

    addPatternsFromText(
      patterns,
      [task.title, task.notes, task.nextAction].filter(Boolean).join(" "),
      `任务 ${task.code}: ${truncateText(task.title || task.nextAction, 120)}`,
    );
  }

  for (const review of store.reviews) {
    for (const flag of review.driftFlags) {
      addPattern(patterns, normalizeKnownPattern(flag), `复盘 ${review.date}: ${flag}`);
    }

    addPatternsFromText(
      patterns,
      review.fakeProgress,
      `复盘 ${review.date}: ${truncateText(review.fakeProgress, 120)}`,
    );
  }

  for (const review of store.aiDailyReviews) {
    for (const warning of review.driftWarnings) {
      addPatternsFromText(
        patterns,
        warning,
        `AI 日复盘 ${review.date}: ${truncateText(warning, 120)}`,
      );
    }

    addPatternsFromText(
      patterns,
      review.fakeProgress,
      `AI 日复盘 ${review.date}: ${truncateText(review.fakeProgress, 120)}`,
    );
  }

  maybeAddUserValidationAvoidance(patterns, store);

  return [...patterns.values()]
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.pattern.localeCompare(b.pattern);
    })
    .slice(0, 6);
}

function maybeAddUserValidationAvoidance(
  patterns: Map<string, DecisionContextDriftPattern>,
  store: Store,
) {
  const systemBuildingTaskCount = store.tasks.filter((task) =>
    /系统|框架|架构|自动化|仪表盘|重构|配置|优化/.test(
      [task.title, task.nextAction, task.notes].filter(Boolean).join(" "),
    ),
  ).length;
  const hasValidationEvidence = store.evidence.some((item) =>
    /product_judgment|用户|访谈|潜在用户|付费|验证|痛点|邀约/.test(
      [item.type, item.title, item.description].join(" "),
    ),
  );

  if (systemBuildingTaskCount >= 2 && !hasValidationEvidence) {
    addPattern(
      patterns,
      "逃避用户验证",
      `最近有 ${systemBuildingTaskCount} 个系统建设任务，但缺少用户验证或 product_judgment 证据`,
    );
  }
}

function addPatternsFromText(
  patterns: Map<string, DecisionContextDriftPattern>,
  text: string,
  evidence: string,
) {
  const matched = normalizeRiskPattern(text);

  for (const pattern of matched) {
    addPattern(patterns, pattern, evidence);
  }
}

function normalizeRiskPattern(text: string): string[] {
  const normalized = trimText(text);

  if (!normalized) {
    return [];
  }

  return driftRules
    .filter((rule) => {
      const matched = rule.keywords.some((keyword) => normalized.includes(keyword));

      if (!matched) {
        return false;
      }

      if (isLearningOrReviewRule(rule) && hasAppliedLearningAnchor(normalized)) {
        return false;
      }

      return true;
    })
    .map((rule) => rule.pattern);
}

function isLearningOrReviewRule(rule: PatternRule) {
  return rule.keywords.some((keyword) =>
    ["学习", "研究", "了解", "阅读", "课程", "教程", "调研", "整理", "归纳", "总结"].includes(
      keyword,
    ),
  );
}

function hasAppliedLearningAnchor(text: string) {
  return /输出物|产出|交付|应用|用于|服务|当前任务|本月目标|知识卡|复盘|doneWhen|nextAction|完成证据|可复述|insight/i.test(
    text,
  );
}

function normalizeKnownPattern(value: string) {
  const text = trimText(value);

  if (!text) {
    return "";
  }

  if (text.includes("泛学习")) {
    return "泛学习";
  }

  if (text.includes("信息刷屏")) {
    return "信息刷屏";
  }

  if (text.includes("任务过大")) {
    return "任务过大";
  }

  if (text.includes("系统打磨")) {
    return "系统打磨成瘾";
  }

  if (text.includes("过度设计")) {
    return "过度设计";
  }

  return truncateText(text, 40);
}

function addPattern(
  patterns: Map<string, DecisionContextDriftPattern>,
  pattern: string,
  evidence: string,
) {
  const normalizedPattern = trimText(pattern);
  const normalizedEvidence = truncateText(trimText(evidence), 180);

  if (!normalizedPattern || !normalizedEvidence) {
    return;
  }

  const current = patterns.get(normalizedPattern);

  if (!current) {
    patterns.set(normalizedPattern, {
      pattern: normalizedPattern,
      count: 1,
      evidence: [normalizedEvidence],
    });
    return;
  }

  current.count += 1;

  if (
    current.evidence.length < 3 &&
    !current.evidence.includes(normalizedEvidence)
  ) {
    current.evidence.push(normalizedEvidence);
  }
}

function byDateThenCreatedAt(
  a: { date: string; createdAt: string },
  b: { date: string; createdAt: string },
) {
  const dateDiff = trimText(b.date).localeCompare(trimText(a.date));

  if (dateDiff !== 0) {
    return dateDiff;
  }

  return trimText(b.createdAt).localeCompare(trimText(a.createdAt));
}

function getTodayDate() {
  const timeZone = process.env.APP_TIMEZONE || "Asia/Shanghai";

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function truncateText(value: string, max = 400): string {
  const trimmed = trimText(value);

  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1)}…`;
}
