import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAlexOutput, parseEmmaOutput } from '../dist/agents/outputs.js';
import { parseChatImages } from '../dist/agents/images.js';
import { config } from '../dist/config.js';
import { callLlm, userMessage } from '../dist/llm.js';
import { buildRunnableHtml } from '../dist/runtime/bundler.js';

const options = { stage: 'Emma', temperature: 0.4, maxTokens: 8192, jsonMode: true };
const document = { chatSummary: '需求已整理', prdMarkdown: '# 示例' };

function stream(...events) {
  const bytes = new TextEncoder().encode(events.join('\r\n\r\n'));
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) {
        controller.enqueue(bytes.slice(offset, offset + 7));
      }
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

function event(content, finishReason = null) {
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] });
}

test('truncation and invalid JSON retry the stage, then use the fallback model', async (t) => {
  config.llm.model = 'test-primary';
  config.llm.fallbackModel = 'test-fallback';
  const responses = [
    stream(event(JSON.stringify(document), 'length')),
    stream(event('{"chatSummary":"unfinished', 'stop'), 'data: [DONE]'),
    Response.json({ choices: [{ message: { content: '\`\`\`json\n' + JSON.stringify(document) + '\n\`\`\`' } }] }),
  ];
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requested.push(JSON.parse(init.body).model);
    return responses.shift();
  });

  const result = await callLlm([], options, parseEmmaOutput);
  assert.deepEqual(requested, ['test-primary', 'test-primary', 'test-fallback']);
  assert.deepEqual(result, { value: document, model: 'test-fallback' });
});

test('retries without JSON mode and decodes fragmented SSE through its final event', async (t) => {
  const responses = [
    Response.json({ error: 'Unsupported response_format' }, { status: 400 }),
    stream(': heartbeat', event(JSON.stringify(document)), event('', 'stop'), 'data: [DONE]'),
  ];
  const modes = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    modes.push(JSON.parse(init.body).response_format);
    return responses.shift();
  });

  const result = await callLlm([], options, parseEmmaOutput);
  assert.deepEqual(modes, [{ type: 'json_object' }, undefined]);
  assert.deepEqual(result.value, document);
});

test('rejects an interrupted stream even when the content happens to be valid JSON', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return stream(event(JSON.stringify(document)));
  });

  await assert.rejects(callLlm([], options, parseEmmaOutput), /Emma.*完成前断开/);
  assert.equal(calls, 3);
});

test('uses DeepSeek non-thinking mode only on the official API', async (t) => {
  const previousBaseUrl = config.llm.baseUrl;
  t.after(() => { config.llm.baseUrl = previousBaseUrl; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ origin: url.origin, thinking: JSON.parse(init.body).thinking });
    return Response.json({ choices: [{ message: { content: JSON.stringify(document) } }] });
  });

  config.llm.baseUrl = 'https://api.deepseek.com';
  await callLlm([], options, parseEmmaOutput);
  config.llm.baseUrl = 'https://compatible.example/v1';
  await callLlm([], options, parseEmmaOutput);

  assert.deepEqual(requests, [
    { origin: 'https://api.deepseek.com', thinking: { type: 'disabled' } },
    { origin: 'https://compatible.example', thinking: undefined },
  ]);
});

test('text retries, fallback, and image requests use the credentials for their own provider', async (t) => {
  const previousConfig = { ...config.llm };
  t.after(() => Object.assign(config.llm, previousConfig));
  Object.assign(config.llm, {
    baseUrl: 'https://primary.example/v1', apiKey: 'primary-key', model: 'text-model',
    secondaryBaseUrl: 'https://secondary.example', secondaryApiKey: 'secondary-key',
    fallbackModel: 'fallback-model', visionProvider: 'secondary', visionModel: 'image-model',
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([url.href, init.headers.Authorization, JSON.parse(init.body).model]);
    const content = requests.length <= 2 ? 'unfinished JSON' : JSON.stringify(document);
    return Response.json({ choices: [{ message: { content } }] });
  });

  const text = await callLlm([userMessage('Write a spec')], options, parseEmmaOutput);
  const image = { name: 'reference.png', dataUrl: 'data:image/png;base64,placeholder' };
  const vision = await callLlm([userMessage('Use this reference', [image])], options, parseEmmaOutput);
  assert.deepEqual(requests, [
    ['https://primary.example/v1/chat/completions', 'Bearer primary-key', 'text-model'],
    ['https://primary.example/v1/chat/completions', 'Bearer primary-key', 'text-model'],
    ['https://secondary.example/chat/completions', 'Bearer secondary-key', 'fallback-model'],
    ['https://secondary.example/chat/completions', 'Bearer secondary-key', 'image-model'],
  ]);
  assert.equal(text.model, 'fallback-model');
  assert.equal(vision.model, 'image-model');
});

test('image requests retain the original image through every retry on the vision model', async (t) => {
  const image = { name: 'reference.png', dataUrl: 'data:image/png;base64,placeholder' };
  const requests = [];
  config.llm.visionModel = 'test-vision';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const content = requests.length < 3 ? 'unfinished JSON' : JSON.stringify(document);
    return Response.json({ choices: [{ message: { content } }] });
  });

  await callLlm([userMessage('Refer to the image', [image])], options, parseEmmaOutput);
  assert.equal(requests.length, 3);
  for (const { model, messages } of requests) {
    assert.equal(model, 'test-vision');
    assert.deepEqual(messages[0].content, [
      { type: 'text', text: 'Refer to the image' },
      { type: 'image_url', image_url: { url: image.dataUrl } },
    ]);
  }
});

test('images can use the main provider and then fall back to a separate vision model', async (t) => {
  const previousConfig = { ...config.llm };
  t.after(() => Object.assign(config.llm, previousConfig));
  Object.assign(config.llm, {
    baseUrl: 'https://primary.example/v1', apiKey: 'primary-key',
    secondaryBaseUrl: 'https://secondary.example', secondaryApiKey: 'secondary-key',
    visionProvider: 'primary', visionModel: 'gpt-vision', visionFallbackModel: 'backup-vision',
  });
  const image = { name: 'reference.png', dataUrl: 'data:image/png;base64,placeholder' };
  const messages = [userMessage('Read the heading', [image])];
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages, messages);
    requests.push([url.origin, init.headers.Authorization, body.model]);
    const content = requests.length < 3 ? 'unfinished JSON' : JSON.stringify(document);
    return Response.json({ choices: [{ message: { content } }] });
  });

  const result = await callLlm(messages, options, parseEmmaOutput);
  assert.deepEqual(requests, [
    ['https://primary.example', 'Bearer primary-key', 'gpt-vision'],
    ['https://primary.example', 'Bearer primary-key', 'gpt-vision'],
    ['https://secondary.example', 'Bearer secondary-key', 'backup-vision'],
  ]);
  assert.equal(result.model, 'backup-vision');
});

test('a silent primary times out and goes straight to the other provider', async (t) => {
  const previousConfig = { ...config.llm };
  t.after(() => Object.assign(config.llm, previousConfig));
  Object.assign(config.llm, {
    baseUrl: 'https://primary.example', model: 'test-primary',
    secondaryBaseUrl: 'https://secondary.example', fallbackModel: 'test-fallback',
    idleTimeoutMs: 20, timeoutMs: 2000,
  });
  const requests = [];
  const retries = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push(url.origin);
    if (url.origin === 'https://primary.example') {
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    return stream(event(JSON.stringify(document), 'stop'), 'data: [DONE]');
  });

  const result = await callLlm([], { ...options, onRetry: model => retries.push(model) }, parseEmmaOutput);
  assert.deepEqual(requests, ['https://primary.example', 'https://secondary.example']);
  assert.deepEqual(retries, ['test-fallback']);
  assert.equal(result.model, 'test-fallback');
});

test('image attachments accept bounded inline raster images and reject unsafe formats', () => {
  const image = {
    name: ' screenshot.png ',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO//k8sAAAAASUVORK5CYII=',
  };
  assert.equal(parseChatImages([image])[0].name, 'screenshot.png');
  assert.throws(() => parseChatImages(Array(4).fill(image)), /最多/);
  assert.throws(() => parseChatImages([{ ...image, dataUrl: 'https://example.com/image.png' }]), /请上传/);
  assert.throws(() => parseChatImages([{ ...image, dataUrl: image.dataUrl.replace('/png', '/gif') }]), /不匹配/);
  assert.throws(() => parseChatImages([{ ...image, dataUrl: image.dataUrl.replace('/png', '/svg+xml') }]), /请上传/);
});

test('rejects partial file output and preserves an existing HTML entry on an incremental edit', () => {
  const existing = { 'index.html': '<html></html>', 'app.js': 'old code' };
  assert.throws(
    () => parseAlexOutput('<file path="app.js">new code</file>\n<file path="styles.css">', existing),
    /未完整结束/
  );
  assert.deepEqual(
    parseAlexOutput('<file path="app.js">new code</file>', existing).files,
    { ...existing, 'app.js': 'new code' }
  );
  assert.throws(() => parseAlexOutput('<file path="app.js">new code</file>', {}), /HTML 入口/);
});

test('preserves JavaScript replacement tokens in the bundled app', () => {
  const code = "window.result = 'x'.replace(/x/, '$& $$');";
  const html = buildRunnableHtml({
    projectId: 'test',
    files: { 'index.html': '<html><head></head><body></body></html>', 'app.js': code },
  });
  assert.ok(html.includes(code));
});
