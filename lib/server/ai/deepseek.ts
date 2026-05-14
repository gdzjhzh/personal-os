export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletionOptions = {
  messages: DeepSeekMessage[];
  reasoningEffort?: DeepSeekReasoningEffort | null;
  requestId?: string;
  responseFormat?: "json_object";
  maxTokens?: number;
  signal?: AbortSignal;
  deadlineMs?: number;
  deadlineMode?: "overall" | "until_first_content";
  idleTimeoutMs?: number;
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

export type DeepSeekStreamChunk =
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "usage"; usage: unknown };

type DeepSeekStreamPayload = {
  choices?: Array<{
    delta?: {
      reasoning_content?: string;
      content?: string;
    };
  }>;
  usage?: unknown;
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

export class DeepSeekTimeoutError extends DeepSeekRequestError {
  constructor(deadlineMs: number) {
    super("DeepSeek request timed out", undefined, `deadlineMs=${deadlineMs}`);
    this.name = "DeepSeekTimeoutError";
  }
}

export class DeepSeekAbortError extends DeepSeekRequestError {
  constructor() {
    super("DeepSeek request aborted");
    this.name = "DeepSeekAbortError";
  }
}

export async function createDeepSeekChatCompletion({
  messages,
  reasoningEffort,
  requestId = createDeepSeekRequestId(),
  responseFormat,
  maxTokens,
  signal,
}: DeepSeekChatCompletionOptions) {
  const startedAt = Date.now();
  const apiKey = readDeepSeekApiKey();

  if (!apiKey) {
    console.warn("[ai.deepseek] request:missing_key", { requestId });
    throw new MissingDeepSeekApiKeyError();
  }

  const model = currentDeepSeekModel();
  const resolvedReasoningEffort =
    reasoningEffort === undefined ? readReasoningEffortFromEnv() : reasoningEffort;
  const promptChars = countPromptChars(messages);
  console.info("[ai.deepseek] request:start", {
    requestId,
    model,
    reasoningEffort: resolvedReasoningEffort || null,
    responseFormat: responseFormat || null,
    maxTokens: maxTokens || null,
    maxAttempts: DEEPSEEK_MAX_ATTEMPTS,
    messageCount: messages.length,
    promptChars,
  });

  const body = JSON.stringify({
    model,
    messages,
    thinking: { type: "enabled" },
    ...(resolvedReasoningEffort
      ? { reasoning_effort: resolvedReasoningEffort }
      : {}),
    ...(responseFormat
      ? { response_format: { type: responseFormat } }
      : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    stream: false,
  });
  let response: Response | null = null;

  for (let attempt = 1; attempt <= DEEPSEEK_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEEPSEEK_ATTEMPT_TIMEOUT_MS,
    );
    const removeExternalAbort = linkExternalSignal(signal, controller);

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
      if (signal?.aborted) {
        throw new DeepSeekAbortError();
      }

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
      removeExternalAbort();
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

export async function* streamDeepSeekChatCompletion({
  messages,
  reasoningEffort,
  requestId = createDeepSeekRequestId(),
  responseFormat,
  maxTokens,
  signal,
  deadlineMs,
  deadlineMode = "overall",
  idleTimeoutMs,
}: DeepSeekChatCompletionOptions): AsyncGenerator<DeepSeekStreamChunk> {
  const startedAt = Date.now();
  const apiKey = readDeepSeekApiKey();

  if (!apiKey) {
    console.warn("[ai.deepseek] stream:missing_key", { requestId });
    throw new MissingDeepSeekApiKeyError();
  }

  const model = currentDeepSeekModel();
  const resolvedReasoningEffort =
    reasoningEffort === undefined ? readReasoningEffortFromEnv() : reasoningEffort;
  const promptChars = countPromptChars(messages);
  const body = JSON.stringify({
    model,
    messages,
    thinking: { type: "enabled" },
    ...(resolvedReasoningEffort
      ? { reasoning_effort: resolvedReasoningEffort }
      : {}),
    ...(responseFormat
      ? { response_format: { type: responseFormat } }
      : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    stream: true,
  });
  const controller = new AbortController();
  let deadlineExpired = false;
  let idleTimeoutExpired = false;
  let externalAborted = false;
  let completed = false;
  let contentChars = 0;
  let reasoningChars = 0;
  let usage: unknown = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined =
    typeof deadlineMs === "number" && deadlineMs > 0
      ? setTimeout(() => {
          deadlineExpired = true;
          controller.abort();
        }, deadlineMs)
      : undefined;
  let idleDeadline: ReturnType<typeof setTimeout> | undefined;
  const clearDeadline = () => {
    if (!deadline) {
      return;
    }
    clearTimeout(deadline);
    deadline = undefined;
  };
  const refreshIdleDeadline = () => {
    if (typeof idleTimeoutMs !== "number" || idleTimeoutMs <= 0) {
      return;
    }

    if (idleDeadline) {
      clearTimeout(idleDeadline);
    }

    idleDeadline = setTimeout(() => {
      idleTimeoutExpired = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  const removeExternalAbort = linkExternalSignal(signal, controller, () => {
    externalAborted = true;
  });
  refreshIdleDeadline();

  console.info("[ai.deepseek] stream:start", {
    requestId,
    model,
    reasoningEffort: resolvedReasoningEffort || null,
    responseFormat: responseFormat || null,
    maxTokens: maxTokens || null,
    deadlineMs: deadlineMs || null,
    deadlineMode,
    idleTimeoutMs: idleTimeoutMs || null,
    messageCount: messages.length,
    promptChars,
  });

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const details = readDeepSeekErrorMessage(errorText);

      console.warn("[ai.deepseek] stream:http_error", {
        requestId,
        model,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        details,
      });
      throw new DeepSeekRequestError(
        `DeepSeek request failed with ${response.status}`,
        response.status,
        details,
      );
    }

    if (!response.body) {
      throw new DeepSeekRequestError("DeepSeek returned no response body");
    }

    reader = response.body.getReader();

    for await (const payload of readSsePayloads(reader, controller.signal)) {
      if (payload === "[DONE]") {
        completed = true;
        break;
      }

      refreshIdleDeadline();

      const parsed = parseStreamPayload(payload);
      const delta = parsed.choices?.[0]?.delta;
      const reasoningText = delta?.reasoning_content;
      const contentText = delta?.content;

      if (typeof reasoningText === "string" && reasoningText.length > 0) {
        reasoningChars += reasoningText.length;
        yield { type: "reasoning", text: reasoningText };
      }

      if (typeof contentText === "string" && contentText.length > 0) {
        const hadContent = contentChars > 0;
        contentChars += contentText.length;
        if (deadlineMode === "until_first_content" && !hadContent) {
          clearDeadline();
        }
        yield { type: "content", text: contentText };
      }

      if (parsed.usage) {
        usage = parsed.usage;
        yield { type: "usage", usage: parsed.usage };
      }
    }
  } catch (error) {
    if (deadlineExpired || idleTimeoutExpired) {
      console.warn("[ai.deepseek] stream:timeout", {
        requestId,
        model,
        deadlineMs: deadlineMs || null,
        deadlineMode,
        idleTimeoutMs: idleTimeoutMs || null,
        timeoutKind: idleTimeoutExpired ? "idle" : "deadline",
        elapsedMs: Date.now() - startedAt,
        contentChars,
        reasoningChars,
      });
      throw new DeepSeekTimeoutError(
        idleTimeoutExpired ? idleTimeoutMs || 0 : deadlineMs || 0,
      );
    }

    if (externalAborted || signal?.aborted) {
      console.info("[ai.deepseek] stream:aborted", {
        requestId,
        model,
        elapsedMs: Date.now() - startedAt,
        contentChars,
        reasoningChars,
      });
      throw new DeepSeekAbortError();
    }

    if (error instanceof DeepSeekRequestError) {
      throw error;
    }

    console.warn("[ai.deepseek] stream:network_error", {
      requestId,
      model,
      elapsedMs: Date.now() - startedAt,
      error: describeError(error),
    });
    throw new DeepSeekRequestError(
      "DeepSeek stream request failed",
      undefined,
      formatNetworkErrorDetails(error),
    );
  } finally {
    clearDeadline();
    if (idleDeadline) {
      clearTimeout(idleDeadline);
    }
    removeExternalAbort();

    if (!completed && !controller.signal.aborted) {
      controller.abort();
    }

    try {
      reader?.releaseLock();
    } catch {
      // The reader may already be released after abort. Nothing else to clean up.
    }

    console.info("[ai.deepseek] stream:finish", {
      requestId,
      model,
      reasoningEffort: resolvedReasoningEffort || null,
      promptChars,
      elapsedMs: Date.now() - startedAt,
      contentChars,
      reasoningChars,
      completed,
      usage,
    });
  }
}

export function getDeepSeekModelInfo(): DeepSeekModelInfo {
  return {
    provider: "DeepSeek",
    model: currentDeepSeekModel(),
    endpointHost: "api.deepseek.com",
    thinkingEnabled: true,
    apiKeyConfigured: Boolean(readDeepSeekApiKey()),
    defaultReasoningEffort: readReasoningEffortFromEnv(),
  };
}

export function createDeepSeekRequestId() {
  return `ds_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeDeepSeekModel(baseModel: string) {
  return baseModel.replace(/\[1m\]$/i, "");
}

function currentDeepSeekModel() {
  return normalizeDeepSeekModel(
    process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
  );
}

function readDeepSeekApiKey() {
  return (
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim()
  );
}

function readReasoningEffortFromEnv(): DeepSeekReasoningEffort {
  return process.env.DEEPSEEK_REASONING_EFFORT === "max" ? "max" : "high";
}

function countPromptChars(messages: DeepSeekMessage[]) {
  return messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
}

async function* readSsePayloads(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = splitSseFrames(buffer);
    buffer = frames.remainder;

    for (const frame of frames.complete) {
      const data = readSseData(frame);

      if (!data) {
        continue;
      }

      yield data;
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const data = readSseData(buffer);

    if (data) {
      yield data;
    }
  }
}

function splitSseFrames(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const complete: string[] = [];
  let searchFrom = 0;
  let separatorIndex = normalized.indexOf("\n\n", searchFrom);

  while (separatorIndex !== -1) {
    complete.push(normalized.slice(searchFrom, separatorIndex));
    searchFrom = separatorIndex + 2;
    separatorIndex = normalized.indexOf("\n\n", searchFrom);
  }

  return {
    complete,
    remainder: normalized.slice(searchFrom),
  };
}

function readSseData(frame: string) {
  const dataLines = frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return "";
  }

  return dataLines.join("\n").trim();
}

function parseStreamPayload(payload: string): DeepSeekStreamPayload {
  try {
    return JSON.parse(payload) as DeepSeekStreamPayload;
  } catch (error) {
    throw new DeepSeekRequestError(
      "DeepSeek stream returned invalid JSON chunk",
      undefined,
      describeError(error).message,
    );
  }
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

function linkExternalSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
  onAbort?: () => void,
) {
  if (!signal) {
    return () => undefined;
  }

  if (signal.aborted) {
    onAbort?.();
    controller.abort();
    return () => undefined;
  }

  const abort = () => {
    onAbort?.();
    controller.abort();
  };

  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
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
