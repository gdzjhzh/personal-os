type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletionOptions = {
  messages: DeepSeekMessage[];
  reasoningEffort?: DeepSeekReasoningEffort;
  enableOneMillionContext?: boolean;
};

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type DeepSeekReasoningEffort = "high" | "max";

export class MissingDeepSeekApiKeyError extends Error {
  constructor() {
    super("Missing DEEPSEEK_API_KEY");
    this.name = "MissingDeepSeekApiKeyError";
  }
}

export class DeepSeekRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "DeepSeekRequestError";
    this.status = status;
  }
}

export async function createDeepSeekChatCompletion({
  messages,
  reasoningEffort = readReasoningEffortFromEnv(),
  enableOneMillionContext = readOneMillionContextFromEnv(),
}: DeepSeekChatCompletionOptions) {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim();

  if (!apiKey) {
    throw new MissingDeepSeekApiKeyError();
  }

  const model = resolveDeepSeekModel(
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
    enableOneMillionContext,
  );
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      thinking: { type: "enabled" },
      reasoning_effort: reasoningEffort,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new DeepSeekRequestError(
      `DeepSeek request failed with ${response.status}`,
      response.status,
    );
  }

  const data = (await response.json()) as DeepSeekChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new DeepSeekRequestError("DeepSeek returned no content");
  }

  return content;
}

function resolveDeepSeekModel(baseModel: string, enableOneMillionContext: boolean) {
  const normalized = baseModel.replace(/\[1m\]$/i, "");

  if (enableOneMillionContext) {
    return `${normalized}[1m]`;
  }

  return normalized;
}

function readReasoningEffortFromEnv(): DeepSeekReasoningEffort {
  return process.env.DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high";
}

function readOneMillionContextFromEnv() {
  return process.env.DEEPSEEK_ENABLE_1M === "true";
}
