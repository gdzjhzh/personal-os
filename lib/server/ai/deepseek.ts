type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletionOptions = {
  messages: DeepSeekMessage[];
  reasoningEffort?: DeepSeekReasoningEffort;
  requestId?: string;
  responseFormat?: "json_object";
};

type DeepSeekChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

type LoggableError = {
  name: string;
  message: string;
  cause?: LoggableError;
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

const DEEPSEEK_MAX_ATTEMPTS = 2;
const DEEPSEEK_ATTEMPT_TIMEOUT_MS = 12000;
const DEEPSEEK_RETRY_DELAYS_MS = [800];

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
  requestId = createDeepSeekRequestId(),
  responseFormat,
}: DeepSeekChatCompletionOptions) {
  const startedAt = Date.now();
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim();

  if (!apiKey) {
    console.warn("[ai.deepseek] request:missing_key", { requestId });
    throw new MissingDeepSeekApiKeyError();
  }

  const model = normalizeDeepSeekModel(
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  );
  console.info("[ai.deepseek] request:start", {
    requestId,
    model,
    reasoningEffort,
    responseFormat: responseFormat || null,
    maxAttempts: DEEPSEEK_MAX_ATTEMPTS,
    messageCount: messages.length,
    promptChars: messages.reduce((total, message) => total + message.content.length, 0),
  });

  const body = JSON.stringify({
    model,
    messages,
    thinking: { type: "enabled" },
    reasoning_effort: reasoningEffort,
    ...(responseFormat
      ? { response_format: { type: responseFormat } }
      : {}),
    stream: false,
  });
  let response: Response | null = null;

  for (let attempt = 1; attempt <= DEEPSEEK_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEEPSEEK_ATTEMPT_TIMEOUT_MS,
    );

    try {
      response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      const shouldRetry = attempt < DEEPSEEK_MAX_ATTEMPTS;
      const details = formatNetworkErrorDetails(error);

      console.warn("[ai.deepseek] request:network_error", {
        requestId,
        model,
        attempt,
        maxAttempts: DEEPSEEK_MAX_ATTEMPTS,
        retry: shouldRetry,
        attemptTimeoutMs: DEEPSEEK_ATTEMPT_TIMEOUT_MS,
        elapsedMs: Date.now() - startedAt,
        error: describeError(error),
      });

      if (!shouldRetry) {
        throw new DeepSeekRequestError(
          "DeepSeek network request failed",
          undefined,
          details,
        );
      }

      await delay(DEEPSEEK_RETRY_DELAYS_MS[attempt - 1] || 0);
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      break;
    }

    const errorText = await response.text();
    const details = readDeepSeekErrorMessage(errorText);
    const shouldRetry =
      isRetryableDeepSeekStatus(response.status) &&
      attempt < DEEPSEEK_MAX_ATTEMPTS;

    console.warn("[ai.deepseek] request:http_error", {
      requestId,
      model,
      status: response.status,
      attempt,
      maxAttempts: DEEPSEEK_MAX_ATTEMPTS,
      retry: shouldRetry,
      elapsedMs: Date.now() - startedAt,
      details,
    });

    if (!shouldRetry) {
      throw new DeepSeekRequestError(
        `DeepSeek request failed with ${response.status}`,
        response.status,
        details,
      );
    }

    await delay(DEEPSEEK_RETRY_DELAYS_MS[attempt - 1] || 0);
  }

  if (!response?.ok) {
    throw new DeepSeekRequestError("DeepSeek request did not complete");
  }

  const data = (await response.json()) as DeepSeekChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.warn("[ai.deepseek] request:empty_content", {
      requestId,
      model: data.model || model,
      responseId: data.id || null,
      elapsedMs: Date.now() - startedAt,
    });
    throw new DeepSeekRequestError("DeepSeek returned no content");
  }

  console.info("[ai.deepseek] request:success", {
    requestId,
    model: data.model || model,
    responseId: data.id || null,
    elapsedMs: Date.now() - startedAt,
    contentChars: content.length,
    usage: data.usage || null,
  });

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

function isRetryableDeepSeekStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function formatNetworkErrorDetails(error: unknown) {
  const details = describeError(error);
  const cause = details.cause
    ? ` / cause=${details.cause.name}: ${details.cause.message}`
    : "";

  return `network_error / ${details.name}: ${details.message}${cause}`;
}

async function delay(ms: number) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeepSeekRequestId() {
  return `ds_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function describeError(error: unknown): LoggableError {
  if (error instanceof Error) {
    const cause = error.cause;

    return {
      name: error.name,
      message: error.message,
      ...(cause ? { cause: describeError(cause) } : {}),
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
}
