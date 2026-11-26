import { config } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

async function fetchLlmStream(
  messages: ChatMessage[],
  model: string,
  options: LlmOptions
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 12000,
      stream: true,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`LLM API ${res.status}: ${errText.slice(0, 400)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }

    // Some proxies may ignore stream:true and return plain JSON
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') && !res.body) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('LLM returned empty content');
      return content;
    }

    if (!res.body) {
      throw new Error('LLM stream body is empty');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string };
              message?: { content?: string };
            }>;
          };
          const delta =
            chunk.choices?.[0]?.delta?.content ??
            chunk.choices?.[0]?.message?.content ??
            '';
          if (delta) fullText += delta;
        } catch {
          // ignore partial/non-JSON SSE frames
        }
      }
    }

    // Fallback if server actually sent a single non-SSE JSON body
    if (!fullText && buffer.trim().startsWith('{')) {
      try {
        const data = JSON.parse(buffer.trim()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        fullText = data.choices?.[0]?.message?.content || '';
      } catch {
        // ignore
      }
    }

    if (!fullText.trim()) {
      throw new Error('LLM stream returned empty content');
    }
    return fullText;
  } finally {
    clearTimeout(timer);
  }
}

export async function callLlm(
  messages: ChatMessage[],
  options: LlmOptions = {}
): Promise<string> {
  const primaryModel = options.model || config.llm.model;
  const fallbackModel =
    config.llm.raceModel && config.llm.raceModel !== primaryModel
      ? config.llm.raceModel
      : primaryModel;

  const attempts = [primaryModel, primaryModel, fallbackModel];
  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    try {
      return await fetchLlmStream(messages, model, options);
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      const isRetryable = !status || status >= 500 || status === 429;
      console.warn(
        `[Nucleus LLM] Attempt ${i + 1}/${attempts.length} failed (model=${model}, status=${status ?? 'net'}):`,
        err instanceof Error ? err.message : err
      );
      if (!isRetryable || i === attempts.length - 1) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM request failed');
}

export function extractJsonObject<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim()) as T;
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Failed to parse JSON from LLM output');
  }
}
