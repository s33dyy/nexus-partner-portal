// Thin OpenRouter client for the in-app Assistant. Per product direction, the
// assistant always uses the cheapest available chat model rather than a
// pinned model name, so pricing is discovered at request time (and cached
// briefly) instead of hardcoded.

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Used only if the live /models pricing lookup fails (network error, outage,
// or missing key at call time) — a small, broadly available instruct model,
// not a claim that it is always the cheapest.
const FALLBACK_MODEL = "meta-llama/llama-3.2-3b-instruct";

const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

type OpenRouterModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
};

type CachedModel = { id: string; cachedAt: number };

let cachedModel: CachedModel | null = null;

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("Missing OPENROUTER_API_KEY environment variable");
  }
  return key;
}

export function hasOpenRouterConfig(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

async function fetchModels(apiKey: string): Promise<OpenRouterModel[]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter models request failed: ${response.status}`);
  }
  const body = (await response.json()) as { data?: OpenRouterModel[] };
  return body.data ?? [];
}

function modelTotalPrice(model: OpenRouterModel): number | null {
  const prompt = Number(model.pricing?.prompt);
  const completion = Number(model.pricing?.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  if (prompt < 0 || completion < 0) return null;
  return prompt + completion;
}

/**
 * Selects the cheapest available OpenRouter chat model by combined
 * prompt+completion price, refreshed at most once per hour. A tiny minimum
 * context window filters out non-chat catalogue entries without hardcoding
 * any specific provider or model family.
 */
export async function selectCheapestChatModel(): Promise<string> {
  if (cachedModel && Date.now() - cachedModel.cachedAt < MODEL_CACHE_TTL_MS) {
    return cachedModel.id;
  }

  try {
    const apiKey = getApiKey();
    const models = await fetchModels(apiKey);
    const priced = models
      .map((model) => ({ model, price: modelTotalPrice(model) }))
      .filter((entry): entry is { model: OpenRouterModel; price: number } => entry.price !== null)
      .filter((entry) => !entry.model.context_length || entry.model.context_length >= 4000)
      .sort((a, b) => a.price - b.price);

    const cheapest = priced[0]?.model.id ?? FALLBACK_MODEL;
    cachedModel = { id: cheapest, cachedAt: Date.now() };
    return cheapest;
  } catch {
    return FALLBACK_MODEL;
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletionResult = { content: string; model: string };

export async function runChatCompletion(input: {
  messages: ChatMessage[];
  temperature?: number;
}): Promise<ChatCompletionResult> {
  const apiKey = getApiKey();
  const model = await selectCheapestChatModel();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter's optional app-identification headers; informational only.
      "HTTP-Referer": "https://livey-pam-crm.local",
      "X-Title": "LIVEY PAM CRM Assistant",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter chat completion failed (${response.status}): ${errorBody.slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  return { content, model };
}
