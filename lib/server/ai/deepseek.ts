type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type DeepSeekChatCompletionOptions = {
  messages: DeepSeekMessage[];
  temperature?: number;
  maxTokens?: number;
};

type DeepSeekChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

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
  temperature = 0.2,
  maxTokens = 1200,
}: DeepSeekChatCompletionOptions) {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.PSOS_AI_API_KEY?.trim();

  if (!apiKey) {
    throw new MissingDeepSeekApiKeyError();
  }

  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro";
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
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
