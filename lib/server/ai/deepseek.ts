type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletionOptions = {
  messages: DeepSeekMessage[];
  reasoningEffort?: DeepSeekReasoningEffort;
  responseFormat?: "json_object";
};

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type DeepSeekReasoningEffort = "high" | "max";

export type DeepSeekModelInfo = {
  provider: "DeepSeek";
  model: string;
  endpointHost: string;
  thinkingEnabled: boolean;
  apiKeyConfigured: boolean;
  defaultReasoningEffort: DeepSeekReasoningEffort;
};

export class MissingDeepSeekApiKeyError extends Error {
  constructor() {
    super("Missing DEEPSEEK_API_KEY");
    this.name = "MissingDeepSeekApiKeyError";
  }
}

export class DeepSeekRequestError extends Error {
  details?: string;
  status?: number;

  constructor(message: string, status?: number, details?: string) {
    super(message);
    this.name = "DeepSeekRequestError";
    this.status = status;
    this.details = details;
  }
}

export async function createDeepSeekChatCompletion({
  messages,
  reasoningEffort = readReasoningEffortFromEnv(),
  responseFormat,
}: DeepSeekChatCompletionOptions) {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim();

  if (!apiKey) {
    throw new MissingDeepSeekApiKeyError();
  }

  const model = normalizeDeepSeekModel(
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
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
      ...(responseFormat
        ? { response_format: { type: responseFormat } }
        : {}),
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new DeepSeekRequestError(
      `DeepSeek request failed with ${response.status}`,
      response.status,
      readDeepSeekErrorMessage(errorText),
    );
  }

  const data = (await response.json()) as DeepSeekChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new DeepSeekRequestError("DeepSeek returned no content");
  }

  return content;
}

export function getDeepSeekModelInfo(): DeepSeekModelInfo {
  return {
    provider: "DeepSeek",
    model: currentDeepSeekModel(),
    endpointHost: "api.deepseek.com",
    thinkingEnabled: true,
    apiKeyConfigured: Boolean(
      process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim(),
    ),
    defaultReasoningEffort: readReasoningEffortFromEnv(),
  };
}

function normalizeDeepSeekModel(baseModel: string) {
  return baseModel.replace(/\[1m\]$/i, "");
}

function currentDeepSeekModel() {
  return normalizeDeepSeekModel(
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  );
}

function readReasoningEffortFromEnv(): DeepSeekReasoningEffort {
  return process.env.DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high";
}

function readDeepSeekErrorMessage(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      error?: {
        code?: string;
        message?: string;
        type?: string;
      };
    };
    const error = parsed.error;

    return [error?.code, error?.type, error?.message]
      .filter(Boolean)
      .join(" / ");
  } catch {
    return value.slice(0, 240);
  }
}
