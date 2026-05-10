import type {
  AiDailyReview,
  DailyReview,
  ProductTeardown,
  Task,
} from "@/lib/types";
import type { P0Decision } from "@/lib/server/scoring";
import { createDeepSeekChatCompletion } from "@/lib/server/ai/deepseek";

export type AiDailyReviewDraft = Omit<AiDailyReview, "id" | "createdAt">;

type DailyReviewCoachInput = {
  date: string;
  tasks: Task[];
  completedTasks: Task[];
  currentTasks: Task[];
  dailyReview?: DailyReview;
  productTeardowns: ProductTeardown[];
  p0Decision: P0Decision;
};

export class AiDailyReviewInvalidJsonError extends Error {
  rawOutput?: string;

  constructor(rawOutput?: string) {
    super("AI daily review returned invalid JSON");
    this.name = "AiDailyReviewInvalidJsonError";
    this.rawOutput = rawOutput;
  }
}

export async function generateAiDailyReview(
  input: DailyReviewCoachInput,
): Promise<AiDailyReviewDraft> {
  const rawOutput = await createDeepSeekChatCompletion({
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: buildUserPrompt(input),
      },
    ],
  });

  return parseAiDailyReview(rawOutput);
}

function buildSystemPrompt() {
  return `You are the AI Daily Review coach inside Personal SaaS OS.

The user wants to become an independent SaaS product creator. Your job is to judge whether the day created real SaaS-builder progress.

Return ONLY strict JSON. Do not include markdown, comments, code fences, or explanations.

The JSON must match this exact structure:
{
  "date": string,
  "summary": string,
  "realOutput": string,
  "fakeProgress": string,
  "growthSignals": string[],
  "driftWarnings": string[],
  "productThinkingProgress": string,
  "executionProgress": string,
  "technicalProgress": string,
  "nextDaySuggestion": string,
  "score": {
    "execution": number,
    "productThinking": number,
    "technicalShipping": number,
    "antiDrift": number,
    "reviewQuality": number
  }
}

Rules:
- Use Chinese.
- Be direct.
- Distinguish real output from fake progress.
- Point out drift risk clearly.
- Evaluate product judgment progress based on product teardowns.
- Evaluate technical progress based on tasks and Codex-ready tasks.
- nextDaySuggestion must be one concrete P0 suggestion for tomorrow.
- Scores must be integers from 0 to 5.
- Do not flatter.
- Do not write generic motivational text.`;
}

function buildUserPrompt(input: DailyReviewCoachInput) {
  return `Review this local-first execution data for ${input.date}.

Input JSON:
${JSON.stringify(input, null, 2)}

Return the strict JSON daily review object.`;
}

function parseAiDailyReview(rawOutput: string): AiDailyReviewDraft {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch {
    throwInvalid(rawOutput);
  }

  if (!isRecord(parsed)) {
    throwInvalid(rawOutput);
  }

  const score = readRecord(parsed.score, rawOutput);

  return {
    date: readString(parsed.date, rawOutput),
    summary: readString(parsed.summary, rawOutput),
    realOutput: readString(parsed.realOutput, rawOutput),
    fakeProgress: readString(parsed.fakeProgress, rawOutput),
    growthSignals: readStringArray(parsed.growthSignals, rawOutput),
    driftWarnings: readStringArray(parsed.driftWarnings, rawOutput),
    productThinkingProgress: readString(
      parsed.productThinkingProgress,
      rawOutput,
    ),
    executionProgress: readString(parsed.executionProgress, rawOutput),
    technicalProgress: readString(parsed.technicalProgress, rawOutput),
    nextDaySuggestion: readString(parsed.nextDaySuggestion, rawOutput),
    score: {
      execution: readScore(score.execution, rawOutput),
      productThinking: readScore(score.productThinking, rawOutput),
      technicalShipping: readScore(score.technicalShipping, rawOutput),
      antiDrift: readScore(score.antiDrift, rawOutput),
      reviewQuality: readScore(score.reviewQuality, rawOutput),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, rawOutput: string) {
  if (!isRecord(value)) {
    throwInvalid(rawOutput);
  }

  return value;
}

function readString(value: unknown, rawOutput: string) {
  if (typeof value !== "string") {
    throwInvalid(rawOutput);
  }

  return value.trim();
}

function readStringArray(value: unknown, rawOutput: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throwInvalid(rawOutput);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

function readScore(value: unknown, rawOutput: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 5
  ) {
    throwInvalid(rawOutput);
  }

  return value;
}

function throwInvalid(rawOutput: string): never {
  throw new AiDailyReviewInvalidJsonError(rawOutput);
}
