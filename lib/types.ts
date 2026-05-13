export type TaskPriority = "P0" | "P1" | "P2";

export type TaskQuadrant =
  | "important_urgent"
  | "important_not_urgent"
  | "urgent_not_important"
  | "not_urgent_not_important";

export type TaskStatus =
  | "inbox"
  | "active"
  | "codex_ready"
  | "codex_running"
  | "review"
  | "waiting"
  | "frozen"
  | "done"
  | "dropped";

export type CodexFit = "high" | "medium" | "low" | "none";

export type TaskOwner = "human" | "codex" | "mixed";

export type Task = {
  id: string;
  code: string;
  title: string;
  project: string;
  priority: TaskPriority;
  status: TaskStatus;
  codexFit: CodexFit;
  owner: TaskOwner;
  nextAction: string;
  doneWhen: string;
  doNot: string[];
  riskFlags: string[];
  waitingFor?: string;
  notes?: string;
  quadrant?: TaskQuadrant;
  plannedFor?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type DailyReview = {
  date: string;
  plannedP0?: string;
  actualOutput: string;
  fakeProgress: string;
  driftFlags: string[];
  tomorrowP0: string;
  systemUpdate?: string;
  notes: string;
  createdAt: string;
};

export type ProductTeardownSource =
  | "TrustMRR"
  | "Toolify"
  | "TAAFT"
  | "Other";

export type ProductTeardown = {
  id: string;
  date: string;
  productName: string;
  productUrl?: string;
  source: ProductTeardownSource;
  problem: string;
  targetUser: string;
  whyUsersNeedIt: string;
  userReviews: string;
  acquisition: string;
  revenueSignal: string;
  whatILearned: string;
  hardPart: string;
  oneSentencePitch: string;
  alternativeApproach: string;
  canIBuildIt: string;
  coldStartStrategy: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiDailyReview = {
  id: string;
  date: string;
  summary: string;
  realOutput: string;
  fakeProgress: string;
  growthSignals: string[];
  driftWarnings: string[];
  productThinkingProgress: string;
  executionProgress: string;
  technicalProgress: string;
  nextDaySuggestion: string;
  score: {
    execution: number;
    productThinking: number;
    technicalShipping: number;
    antiDrift: number;
    reviewQuality: number;
  };
  createdAt: string;
};

export type AiWeeklyReview = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string;
  mainGrowth: string[];
  repeatedDrifts: string[];
  productThinkingGrowth: string;
  executionGrowth: string;
  technicalGrowth: string;
  strongestDay: string;
  weakestDay: string;
  nextWeekFocus: string;
  stopDoing: string[];
  keepDoing: string[];
  startDoing: string[];
  createdAt: string;
};

type CodexRunStatus = "queued" | "running" | "shipped" | "blocked";

export type CodexRun = {
  id: string;
  date: string;
  taskId?: string;
  title: string;
  prompt: string;
  expectedOutput: string;
  actualOutput: string;
  status: CodexRunStatus;
  createdAt: string;
  updatedAt: string;
};

type EvidenceType =
  | "shipping"
  | "product_judgment"
  | "technical_learning"
  | "system_update";

export type Evidence = {
  id: string;
  date: string;
  type: EvidenceType;
  title: string;
  description: string;
  artifactUrl?: string;
  taskId?: string;
  codexRunId?: string;
  createdAt: string;
  updatedAt: string;
};

export type OperatingContext = {
  northStar: string;
  currentFocus: string;
  activeConstraints: string[];
  antiGoals: string[];
  principles: string[];
  updatedAt: string;
};

export type Store = {
  tasks: Task[];
  reviews: DailyReview[];
  productTeardowns: ProductTeardown[];
  aiDailyReviews: AiDailyReview[];
  aiWeeklyReviews: AiWeeklyReview[];
  codexRuns: CodexRun[];
  evidence: Evidence[];
  operatingContext: OperatingContext;
};

export type DecisionContextTaskSnapshot = {
  id: string;
  code: string;
  title: string;
  project: string;
  priority: TaskPriority;
  status: TaskStatus;
  nextAction: string;
  doneWhen: string;
  riskFlags: string[];
  updatedAt: string;
  plannedFor?: string;
};

export type DecisionContextReviewSnapshot = {
  date: string;
  plannedP0?: string;
  actualOutput: string;
  fakeProgress: string;
  driftFlags: string[];
  tomorrowP0: string;
  notes: string;
  createdAt: string;
};

export type DecisionContextEvidenceSnapshot = {
  id: string;
  date: string;
  type: string;
  title: string;
  description: string;
  taskId?: string;
  createdAt: string;
};

export type DecisionContextProductTeardownSnapshot = {
  id: string;
  date: string;
  productName: string;
  problem: string;
  targetUser: string;
  whyUsersNeedIt: string;
  revenueSignal: string;
  whatILearned: string;
  hardPart: string;
  alternativeApproach: string;
  canIBuildIt: string;
  coldStartStrategy: string;
  notes?: string;
  createdAt: string;
};

export type DecisionContextDriftPattern = {
  pattern: string;
  count: number;
  evidence: string[];
};

export type DecisionContextPack = {
  rawInput: string;
  generatedAt: string;
  operatingContext: {
    northStar: string;
    currentFocus: string;
    activeConstraints: string[];
    antiGoals: string[];
    principles: string[];
    updatedAt: string;
  };
  activeTasks: DecisionContextTaskSnapshot[];
  recentReviews: DecisionContextReviewSnapshot[];
  recentEvidence: DecisionContextEvidenceSnapshot[];
  recentProductTeardowns: DecisionContextProductTeardownSnapshot[];
  recentDriftPatterns: DecisionContextDriftPattern[];
  contextStats: {
    activeTaskCount: number;
    recentReviewCount: number;
    recentEvidenceCount: number;
    recentProductTeardownCount: number;
    recentDriftPatternCount: number;
  };
};

export type NeedConfidence = "low" | "medium" | "high";

export type NeedClarification = {
  understoodInput: string;
  inferredRealNeed: {
    statement: string;
    confidence: NeedConfidence;
    evidence: string[];
  };
  possibleAvoidance: {
    pattern: string;
    evidence: string[];
    warning: string;
  };
  alignment: {
    northStarFit: number;
    currentFocusFit: number;
    whyThisMatters: string;
  };
  contextUsed: {
    operatingContext: string[];
    tasks: string[];
    reviews: string[];
    evidence: string[];
    productTeardowns: string[];
    driftPatterns: string[];
  };
  missingQuestions: string[];
  candidateTasks: Array<{
    title: string;
    whyThisTask: string;
    nextAction: string;
    doneWhen: string;
    riskFlags: string[];
    recommended: boolean;
  }>;
  recommendation: string;
};

export type AiDecisionSignal = {
  sourceType:
    | "rawInput"
    | "operatingContext"
    | "task"
    | "review"
    | "evidence"
    | "productTeardown"
    | "driftPattern";
  sourceId?: string;
  label: string;
  quote: string;
  interpretation: string;
  strength: "weak" | "medium" | "strong";
};

export type AiCandidateDecision = {
  title: string;
  whyConsidered: string;
  northStarFit: number;
  currentFocusFit: number;
  evidencePotential: number;
  avoidanceRisk: number;
  effortLevel: "small" | "medium" | "large";
  decision: "recommended" | "alternative" | "rejected";
  reason: string;
};

export type AiGuardrailApplied = {
  rule: string;
  triggeredBy: string;
  effect: string;
};

export type AiDecisionTrace = {
  decisionQuestion: string;
  contextSummary: {
    northStar: string;
    currentFocus: string;
    antiGoalsUsed: string[];
    principlesUsed: string[];
    contextStats: DecisionContextPack["contextStats"];
  };
  signals: AiDecisionSignal[];
  hypotheses: Array<{
    statement: string;
    confidence: NeedConfidence;
    supportingSignals: string[];
    uncertainty: string;
  }>;
  candidateComparison: AiCandidateDecision[];
  guardrailsApplied: AiGuardrailApplied[];
  finalDecision: {
    selectedTitle: string;
    whyThisNow: string;
    whyNotOthers: string[];
    smallestNextAction: string;
    doneWhen: string;
  };
  discussionPrompts: string[];
};

export type CreateTaskInput = {
  title: string;
  project?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  codexFit?: CodexFit;
  owner?: TaskOwner;
  nextAction?: string;
  doneWhen?: string;
  doNot?: string[];
  riskFlags?: string[];
  waitingFor?: string;
  notes?: string;
  quadrant?: TaskQuadrant;
  plannedFor?: string;
};

export type UpdateTaskPatch = Partial<
  Omit<Task, "id" | "code" | "createdAt" | "updatedAt">
>;

export type CreateReviewInput = Omit<DailyReview, "createdAt">;

export type CreateProductTeardownInput = Omit<
  ProductTeardown,
  "id" | "createdAt" | "updatedAt"
>;

export type CreateAiDailyReviewInput = Omit<AiDailyReview, "id" | "createdAt">;

export type CreateAiWeeklyReviewInput = Omit<
  AiWeeklyReview,
  "id" | "createdAt"
>;

export type ClarifiedTaskStatus = Extract<
  TaskStatus,
  "inbox" | "active" | "codex_ready" | "waiting" | "frozen"
>;

export type ClarifiedTaskDraft = {
  title: string;
  project: string;
  priority: TaskPriority;
  status: ClarifiedTaskStatus;
  codexFit: CodexFit;
  owner: TaskOwner;
  nextAction: string;
  doneWhen: string;
  riskFlags: string[];
  doNot: string[];
  notes: string;
};

export type TaskGateVerdictKind = "reject" | "ask" | "recommend";

export type TaskGateEvidence = {
  sourceType:
    | "rawInput"
    | "operatingContext"
    | "task"
    | "review"
    | "evidence"
    | "productTeardown"
    | "driftPattern";
  label: string;
  quote: string;
  interpretation: string;
};

export type TaskGateOption = {
  label: string;
  value: string;
  intent:
    | "answer"
    | "revise_smaller"
    | "continue"
    | "dismiss"
    | "force";
};

export type TaskGateContextSnapshot = {
  northStar: string;
  currentFocus: string;
  activeTaskCount: number;
  recentReviewCount: number;
  recentEvidenceCount: number;
  recentProductTeardownCount: number;
  recentDriftPatternCount: number;
  driftPatterns: string[];
};

export type TaskGateVerdict = {
  verdict: TaskGateVerdictKind;
  summary: string;
  reason: string;
  evidence: TaskGateEvidence[];
  blockingQuestion?: string;
  options: TaskGateOption[];
  contextSnapshot: TaskGateContextSnapshot;
  taskDraft: ClarifiedTaskDraft | null;
  forceDraftSuggestion?: {
    title: string;
    nextAction: string;
    doneWhen: string;
    riskFlags: string[];
    doNot: string[];
    notes: string;
  } | null;
};

export type TaskGateDialogMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TaskGateStreamEvent =
  | { type: "status"; message: string }
  | { type: "heartbeat"; message: string; elapsedMs: number }
  | { type: "thinking"; message: string; reasoningChars: number }
  | { type: "drafting"; message: string; receivedChars: number }
  | { type: "result"; verdict: TaskGateVerdict }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; ok: boolean };

export type AiTaskClarifierState =
  | {
      status: "idle";
    }
  | {
      status: "success";
      needClarification: NeedClarification;
      decisionTrace: AiDecisionTrace;
      task: ClarifiedTaskDraft;
      rawOutput: string;
      contextStats?: DecisionContextPack["contextStats"];
    }
  | {
      status: "error";
      message: string;
      rawOutput?: string;
    };
