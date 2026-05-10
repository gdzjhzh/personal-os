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

export type Store = {
  tasks: Task[];
  reviews: DailyReview[];
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
