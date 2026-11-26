import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const database = process.env.BRAINSTORM_TEST_DATABASE_URL;
const image = {
  name: 'reference.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO//k8sAAAAASUVORK5CYII=',
};

async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Timed out: ' + label);
}

test('BrainStorm persists both modes, streams changes, resumes failures and hands off only confirmed minutes', {
  skip: !database && 'Set BRAINSTORM_TEST_DATABASE_URL to an isolated PostgreSQL database',
  timeout: 60_000,
}, async (t) => {
  const seen = [];
  let reviewerFailed = false;
  const mock = http.createServer(async (req, res) => {
    const bytes = [];
    for await (const chunk of req) bytes.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(bytes));
    const system = messages[0].content;
    const parts = messages[1].content;
    const context = JSON.parse(typeof parts === 'string' ? parts : parts[0].text);
    seen.push({ system, context, parts });
    let output;
    if (system.includes('You are Mike')) {
      output = { intent: 'discussion_only', summary: '未决事项等待确认。', runEmma: false, runBob: false, runAlex: false };
    } else if (system.includes('会议执笔人')) {
      output = { markdown: '# 会议纪要\n\n## 已确认结论\n待确认。' };
    } else {
      if (context.topic === '暂停验证') await delay(650);
      if (context.topic === '失败验证' && system.includes('首次使用者') && !reviewerFailed) {
        reviewerFailed = true;
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":"test failure"}');
        return;
      }
      output = system.includes('重度用户') || context.topic === '全员跳过'
        ? { action: 'pass' } : { action: 'speak', content: '请验证截图里的开始按钮。' };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  }).listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const portProbe = http.createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
    env: {
      ...process.env, PORT: String(port), DATABASE_URL: database, JWT_SECRET: 'brainstorm-isolated-test',
      LLM_BASE_URL: `http://127.0.0.1:${mock.address().port}`, LLM_API_KEY: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', value => { childError += value; });
  child.stdout.resume();
  let cleanupProject;
  t.after(async () => {
    await cleanupProject?.();
    child.kill();
    mock.closeAllConnections();
    mock.close();
  });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(childError);
    return fetch(origin + '/healthz').then(res => res.ok).catch(() => false);
  }, 'startup');

  async function request(path, token, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  }
  async function json(path, token, body) {
    const response = await request(path, token, body);
    if (!response.ok) assert.fail(`${response.status} ${await response.text()}`);
    return response.json();
  }
  const { token } = await json('/api/auth/guest', undefined, {});
  const { token: outsider } = await json('/api/auth/guest', undefined, {});
  const { project } = await json('/api/projects', token, { title: 'BrainStorm fixture' });
  const key = '/api/projects/' + project.id;
  cleanupProject = () => request(key, token, undefined, 'DELETE').catch(() => {});
  const base = key + '/brainstorms';
  const create = (topic, extra = {}) => json(base, token, { topic, mode: 'human', participants: ['first-time', 'power-user'], ...extra });
  const at = (id, status) => waitFor(async () => {
    const detail = await json(base + '/' + id, token);
    return detail.room.status === status ? detail : null;
  }, status);
  const action = (id, data) => json(base + '/' + id + '/actions', token, data);

  const requestId = randomUUID();
  const first = await create('看截图', { requestId, images: [image] });
  assert.equal((await create('看截图', { requestId, images: [image] })).id, first.id);
  const ready = await at(first.id, 'waiting');
  assert.deepEqual(ready.turns.map(turn => turn.kind), ['human', 'speak', 'pass']);
  assert.equal(ready.room.participants[0].name, '测评者 A');
  assert.ok(seen.some(x => Array.isArray(x.parts) && x.parts.some(part => part.image_url?.url === image.dataUrl)));
  assert.equal((await request(base + '/' + first.id, outsider)).status, 404);
  assert.equal((await request(base + '/' + first.id + '/events', outsider)).status, 404);

  const stream = await request(base + '/' + first.id + '/events?since=' + ready.room.revision, token);
  assert.ok(stream.ok);
  const reader = stream.body.getReader();
  const responses = await Promise.all([1, 2].map(() => request(base + '/' + first.id + '/actions', token, {
    type: 'next', expectedRound: 1, text: '我同意调整入口。'
  })));
  assert.deepEqual(responses.map(res => res.status).sort(), [200, 409]);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"changed"/);
  await reader.cancel();
  const next = await at(first.id, 'waiting');
  assert.equal(next.room.round, 2);
  assert.equal(next.turns.length, 6);
  assert.equal((await json(key, token)).project.prd_md, '');
  assert.deepEqual((await json(key, token)).project.files, {});

  await action(first.id, { type: 'draft', author: 'first-time' });
  const draft = await at(first.id, 'review');
  assert.equal(draft.minutes.author_id, 'first-time');
  assert.equal((await request(key + '/chat', token, { brainstormMinutesId: draft.minutes.id })).status, 404);
  await action(first.id, { type: 'save', markdown: '# 经编辑的纪要\n\n## 待验证问题\n颜色方案。' });
  const archive = await json(base + '/minutes', token);
  assert.equal(archive.minutes[0].markdown, '# 经编辑的纪要\n\n## 待验证问题\n颜色方案。');
  const handoffs = await Promise.all([1, 2].map(() => request(key + '/chat', token, { brainstormMinutesId: draft.minutes.id })));
  assert.deepEqual(handoffs.map(res => res.status).sort(), [200, 409]);
  assert.match(await handoffs.find(res => res.ok).text(), /"type":"done"/);
  assert.match(seen.find(x => x.system.includes('You are Mike')).context.confirmedMeetingMinutes, /经编辑的纪要/);
  assert.equal((await json(base + '/minutes', token)).minutes[0].handoff_status, 'done');
  assert.ok((await json(key, token)).messages.some(msg => msg.meta.brainstormSessionId === first.id));

  const passive = await create('全员跳过', { mode: 'ai', roundLimit: 3, participants: ['first-time'] });
  assert.equal((await at(passive.id, 'ready')).room.round, 1);
  const automatic = await create('自动轮次', { mode: 'ai', roundLimit: 2, participants: ['first-time'] });
  assert.equal((await at(automatic.id, 'ready')).room.round, 2);

  const pausable = await create('暂停验证', { mode: 'ai', roundLimit: 2 });
  await action(pausable.id, { type: 'pause' });
  const paused = await at(pausable.id, 'paused');
  assert.equal(paused.room.round, 1);
  assert.ok(paused.turns.length <= 1);
  await action(pausable.id, { type: 'resume' });
  assert.equal((await at(pausable.id, 'ready')).turns.length, 4);

  const retryable = await create('失败验证');
  assert.equal((await at(retryable.id, 'paused')).turns.length, 1);
  await action(retryable.id, { type: 'resume' });
  assert.deepEqual((await at(retryable.id, 'waiting')).turns.map(turn => turn.kind), ['human', 'speak', 'pass']);
});
