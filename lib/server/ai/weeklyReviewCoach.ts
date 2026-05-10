import type {
  AiDailyReview,
  AiWeeklyReview,
  DailyReview,
  ProductTeardown,
  Task,
} from "@/lib/types";
import { createDeepSeekChatCompletion } from "@/lib/server/ai/deepseek";

export type AiWeeklyReviewDraft = Omit<AiWeeklyReview, "id" | "createdAt">;

type WeeklyReviewCoachInput = {
  weekStart: string;
  weekEnd: string;
  tasks: Task[];
  dailyReviews: DailyReview[];
  productTeardowns: ProductTeardown[];
  aiDailyReviews: AiDailyReview[];
};

export class AiWeeklyReviewInvalidJsonError extends Error {
  rawOutput?: string;

  constructor(rawOutput?: string) {
    super("AI weekly review returned invalid JSON");
    this.name = "AiWeeklyReviewInvalidJsonError";
    this.rawOutput = rawOutput;
  }
}

export async function generateAiWeeklyReview(
  input: WeeklyReviewCoachInput,
): Promise<AiWeeklyReviewDraft> {
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

  return parseAiWeeklyReview(rawOutput);
}

function buildSystemPrompt() {
  return `You are the AI Weekly Review coach inside Personal SaaS OS.

The user wants to become an independent SaaS product creator. Your job is to judge whether the week improved product judgment, execution, technical shipping, and anti-drift ability.

Return ONLY strict JSON. Do not include markdown, comments, code fences, or explanations.

The JSON must match this exact structure:
{
  "weekStart": string,
  "weekEnd": string,
  "summary": string,
  "mainGrowth": string[],
  "repeatedDrifts": string[],
  "productThinkingGrowth": string,
  "executionGrowth": string,
  "technicalGrowth": string,
  "strongestDay": string,
  "weakestDay": string,
  "nextWeekFocus": string,
  "stopDoing": string[],
  "keepDoing": string[],
  "startDoing": string[]
}

Rules:
- Use Chinese.
- Identify growth with evidence.
- Identify repeated drift patterns.
- Summarize product thinking growth.
- Summarize execution growth.
- Summarize technical shipping growth.
- Pick strongestDay and weakestDay with reason.
- nextWeekFocus must be one focus, not many.
- stopDoing, keepDoing, startDoing should each contain 3 items max.
- Do not flatter.
- Do not write generic motivational text.`;
}

function buildUserPrompt(input: WeeklyReviewCoachInput) {
  return `Review this local-first execution data from ${input.weekStart} to ${input.weekEnd}.

Input JSON:
${JSON.stringify(input, null, 2)}

Return the strict JSON weekly review object.`;
}

function parseAiWeeklyReview(rawOutput: string): AiWeeklyReviewDraft {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch {
    throwInvalid(rawOutput);
  }

  if (!isRecord(parsed)) {
    throwInvalid(rawOutput);
  }

  return {
    weekStart: readString(parsed.weekStart, rawOutput),
    weekEnd: readString(parsed.weekEnd, rawOutput),
    summary: readString(parsed.summary, rawOutput),
    mainGrowth: readStringArray(parsed.mainGrowth, rawOutput),
    repeatedDrifts: readStringArray(parsed.repeatedDrifts, rawOutput),
    productThinkingGrowth: readString(
      parsed.productThinkingGrowth,
      rawOutput,
    ),
    executionGrowth: readString(parsed.executionGrowth, rawOutput),
    technicalGrowth: readString(parsed.technicalGrowth, rawOutput),
    strongestDay: readString(parsed.strongestDay, rawOutput),
    weakestDay: readString(parsed.weakestDay, rawOutput),
    nextWeekFocus: readString(parsed.nextWeekFocus, rawOutput),
    stopDoing: readStringArray(parsed.stopDoing, rawOutput).slice(0, 3),
    keepDoing: readStringArray(parsed.keepDoing, rawOutput).slice(0, 3),
    startDoing: readStringArray(parsed.startDoing, rawOutput).slice(0, 3),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function throwInvalid(rawOutput: string): never {
  throw new AiWeeklyReviewInvalidJsonError(rawOutput);
}
