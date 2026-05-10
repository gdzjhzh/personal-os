export type TaskPriority = "P0" | "P1" | "P2";

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

export type Store = {
  tasks: Task[];
  reviews: DailyReview[];
  productTeardowns: ProductTeardown[];
  aiDailyReviews: AiDailyReview[];
  aiWeeklyReviews: AiWeeklyReview[];
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

export type AiTaskClarifierState =
  | {
      status: "idle";
    }
  | {
      status: "success";
      task: ClarifiedTaskDraft;
      rawOutput: string;
    }
  | {
      status: "error";
      message: string;
      rawOutput?: string;
    };
