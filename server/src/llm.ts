import { config } from './config.js';
import type { ChatImage } from './agents/images.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    { type: 'text'; text: string } |
    { type: 'image_url'; image_url: { url: string } }
  >;
}

export function userMessage(text: string, images?: ChatImage[]): ChatMessage {
  return {
    role: 'user',
    content: images?.length
      ? [
          { type: 'text', text },
          ...images.map((image) => ({
            type: 'image_url' as const,
            image_url: { url: image.dataUrl },
          })),
        ]
      : text,
  };
}

interface LlmOptions {
  stage: string;
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
  onRetry?: (model: string) => void;
}

interface LlmRoute {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface Completion {
  error?: unknown;
  choices?: Array<{
    delta?: { content?: string; refusal?: string; reasoning_content?: string };
    message?: { content?: string; refusal?: string; reasoning_content?: string };
    finish_reason?: string;
  }>;
}

class LlmResponseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly rejectsJsonMode = false
  ) {
    super(message);
  }
}

class LlmTimeoutError extends Error {}

function checkFinishReason(reason?: string) {
  if (reason === 'length') {
    throw new Error('模型输出达到长度上限');
  }
  if (reason === 'content_filter') {
    throw new LlmResponseError('模型未生成当前请求的内容', 422);
  }
  if (reason && reason !== 'stop') {
    throw new Error(`模型未正常结束输出（${reason}）`);
  }
}

async function readCompletionStream(body: NonNullable<Response['body']>, onProgress: () => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';

      for (const event of events) {
        const payload = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
          .trim();
        if (!payload) continue;
        if (payload === '[DONE]') return content;

        let chunk: Completion;
        try {
          chunk = JSON.parse(payload) as Completion;
        } catch {
          throw new Error('模型网关返回了无效的流事件');
        }
        if (chunk.error) throw new Error('模型网关中断了流式响应');
        const choice = chunk.choices?.[0];
        const message = choice?.delta ?? choice?.message;
        if (message?.refusal) throw new LlmResponseError('模型拒绝生成当前请求的内容', 422);
        if (message?.content || message?.reasoning_content) onProgress();
        if (typeof message?.content === 'string') content += message.content;
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
          checkFinishReason(finishReason);
        }
      }

      if (done) {
        if (!finishReason) throw new Error('模型响应在完成前断开');
        return content;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

async function fetchLlm(
  messages: ChatMessage[],
  { baseUrl, apiKey, model }: LlmRoute,
  options: LlmOptions
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new LlmTimeoutError('模型响应超时')), config.llm.timeoutMs);
  const idleTimeoutMs = config.llm.idleTimeoutMs;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function onProgress() {
    if (!(idleTimeoutMs > 0)) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new LlmTimeoutError('模型长时间未返回新内容')), idleTimeoutMs);
  }

  try {
    onProgress();
    const endpoint = new URL(`${baseUrl}/chat/completions`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
        ...(endpoint.origin === 'https://api.deepseek.com' && { thinking: { type: 'disabled' } }),
        ...(options.jsonMode && { response_format: { type: 'json_object' } }),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      const rejectsJsonMode =
        (res.status === 400 || res.status === 422) &&
        /response_format|json[_ -]mode|json_object/i.test(errorBody);
      throw new LlmResponseError(`模型网关返回 HTTP ${res.status}`, res.status, rejectsJsonMode);
    }

    let content: string | undefined;
    if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
      content = await readCompletionStream(res.body, onProgress);
    } else {
      const data = (await res.json()) as Completion;
      if (data.error) throw new Error('模型网关返回错误');
      const choice = data.choices?.[0];
      checkFinishReason(choice?.finish_reason);
      if (choice?.message?.refusal) {
        throw new LlmResponseError('模型拒绝生成当前请求的内容', 422);
      }
      content = choice?.message?.content;
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('模型未返回可用内容');
    }
    return content;
  } catch (error) {
    if (controller.signal.reason instanceof LlmTimeoutError) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(idleTimer);
  }
}

export async function callLlm<T>(
  messages: ChatMessage[],
  options: LlmOptions,
  parse: (raw: string) => T
): Promise<{ value: T; model: string }> {
  const hasImages = messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url')
  );
  const {
    baseUrl, apiKey, model, secondaryBaseUrl, secondaryApiKey, fallbackModel,
    visionProvider, visionModel, visionFallbackModel,
  } = config.llm;
  const main = { baseUrl, apiKey };
  const secondary = {
    baseUrl: secondaryBaseUrl || baseUrl,
    apiKey: secondaryApiKey ?? (!secondaryBaseUrl || secondaryBaseUrl === baseUrl ? apiKey : ''),
  };
  const vision = visionProvider === 'primary' ? main : secondary;
  const primary = hasImages ? { ...vision, model: visionModel } : { ...main, model };
  const backupModel = hasImages ? visionFallbackModel : fallbackModel;
  const fallback = backupModel ? { ...secondary, model: backupModel } : primary;
  const attempts = [primary, primary, fallback];
  const withoutJsonMode = new Set<string>();

  for (let index = 0; index < attempts.length; index += 1) {
    const route = attempts[index];
    const modeKey = `${route.baseUrl}/${route.model}`;
    const jsonMode = options.jsonMode && !withoutJsonMode.has(modeKey);
    try {
      const raw = await fetchLlm(messages, route, { ...options, jsonMode });
      return { value: parse(raw), model: route.model };
    } catch (err) {
      const status = err instanceof LlmResponseError ? err.status : undefined;
      const rejectedMode = jsonMode && err instanceof LlmResponseError && err.rejectsJsonMode;
      if (rejectedMode) withoutJsonMode.add(modeKey);
      const message = err instanceof Error ? err.message : '未知模型错误';
      console.warn(
        `[Nucleus LLM] ${options.stage} attempt ${index + 1}/${attempts.length} (${route.model}): ${message}`
      );
      const retryable = rejectedMode || !status || status === 429 || status >= 500;
      if (!retryable || index === attempts.length - 1) {
        throw new Error(`${options.stage} 执行失败：${message}`, { cause: err });
      }
      if (index === 0 && err instanceof LlmTimeoutError && primary.baseUrl !== fallback.baseUrl) index += 1;
      options.onRetry?.(attempts[index + 1].model);
      if (status && !rejectedMode) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  throw new Error(`${options.stage} 执行失败`);
}
