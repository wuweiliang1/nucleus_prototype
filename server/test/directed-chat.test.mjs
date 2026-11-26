import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMentionedAgent } from '../dist/agents/mentions.js';
import { runMultiAgentPipeline } from '../dist/agents/orchestrator.js';
import { pool } from '../dist/db.js';

test('recognizes agent mentions in a message and ignores email addresses', () => {
  assert.equal(getMentionedAgent(' @Alex 基于刚才的 PRD 生成官网'), 'alex');
  assert.equal(getMentionedAgent('@emma：整理需求'), 'emma');
  assert.equal(getMentionedAgent('@Bob设计架构'), 'bob');
  assert.equal(getMentionedAgent('@MIKE 统筹下一步'), 'mike');
  assert.equal(getMentionedAgent('@Alexa hello'), undefined);
  assert.equal(getMentionedAgent('Contact us at dev@alex.example'), undefined);
  assert.equal(getMentionedAgent('请参考 @Alex 的建议'), 'alex');
  assert.equal(getMentionedAgent('请 @Alex.com 发送邮件'), undefined);
});

const baseInput = {
  projectId: 'test',
  existingFiles: {},
  existingPrd: '# Existing PRD',
  existingArchitecture: '# Existing architecture',
  existingSchema: [{ name: 'existing_collection', description: '', fields: [] }],
};

const directedCases = [
  {
    agent: 'alex',
    prompt: '@Alex 基于刚才的 PRD 和架构生成完整官网',
    response: '<file path="index.html"><h1>Website</h1></file>',
    update: 'files_update',
    context: ['# Existing PRD', '# Existing architecture', 'existing_collection'],
  },
  {
    agent: 'emma',
    prompt: '@Emma 只整理 PRD，先不写代码',
    response: JSON.stringify({ chatSummary: '需求已整理', prdMarkdown: '# Revised PRD', handoff: 'none' }),
    update: 'artifact_update',
    context: ['# Existing PRD'],
  },
  {
    agent: 'bob',
    prompt: '@Bob 设计架构',
    response: JSON.stringify({ chatSummary: '设计已完成', architectureMarkdown: '# Revised architecture', collections: [] }),
    update: 'artifact_update',
    context: ['# Existing PRD', '# Existing architecture'],
  },
];

for (const { agent, prompt, response, update, context } of directedCases) {
  test(`directs ${agent} without running Mike or the other agents on a project with no files`, async (t) => {
    const events = [];
    const recordedAgents = [];
    const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const messages = JSON.parse(init.body).messages;
      for (const value of context) assert.ok(messages[1].content.includes(value));
      return Response.json({ choices: [{ message: { content: response } }] });
    });
    t.mock.method(pool, 'query', async (sql, parameters) => {
      if (sql.includes('INSERT INTO messages')) recordedAgents.push(parameters[2]);
      return { rows: [] };
    });

    await runMultiAgentPipeline(
      { ...baseInput, userPrompt: prompt, targetAgent: getMentionedAgent(prompt) },
      event => events.push(event)
    );

    assert.equal(fetch.mock.callCount(), 1);
    assert.deepEqual(recordedAgents, [agent]);
    assert.deepEqual(events.map(event => [event.type, event.agent?.id]), [
      ['agent_start', agent], ['agent_message', agent], [update, undefined], ['done', undefined],
    ]);
  });
}

const updatedPrd = '# Revised PRD\nSupport three selectable themes.';
const updatedArchitecture = '# Updated architecture';
const stageReplies = {
  mike: JSON.stringify({
    intent: 'create_new', summary: '沿用现有文档，继续实现',
    runEmma: false, runBob: false, runAlex: true,
  }),
  emma: JSON.stringify({ chatSummary: '将主题切换写入 PRD', prdMarkdown: updatedPrd, handoff: 'alex' }),
  bob: JSON.stringify({ chatSummary: '已补齐架构', architectureMarkdown: updatedArchitecture, collections: [] }),
  alex: '<file path="index.html"><button>Theme</button></file>',
};

const handoffCases = [
  {
    title: 'Emma hands a theme request to Alex on an existing app',
    prompt: '@Emma 要支持主题切换，多套主题切换更好看',
    input: { existingFiles: { 'index.html': '<h1>Existing app</h1>' } },
    agents: ['emma', 'alex'],
    expectedPrd: updatedPrd,
    expectedArchitecture: baseInput.existingArchitecture,
  },
  {
    title: 'Emma requests architecture before implementation when the app has no files',
    prompt: '@Emma 要支持主题切换，多套主题切换更好看',
    input: { existingArchitecture: '' },
    agents: ['emma', 'bob', 'alex'],
    expectedPrd: updatedPrd,
    expectedArchitecture: updatedArchitecture,
  },
  {
    title: 'Mike resumes from existing artifacts without rewriting them',
    prompt: '@Mike 基于现有 PRD 和架构继续实现',
    input: {},
    agents: ['mike', 'alex'],
    expectedPrd: baseInput.existingPrd,
    expectedArchitecture: baseInput.existingArchitecture,
  },
];

for (const scenario of handoffCases) {
  test(scenario.title, async (t) => {
    const events = [];
    const persisted = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const messages = JSON.parse(init.body).messages;
      const agent = messages[0].content.match(/^You are (\w+)/)?.[1].toLowerCase();
      if (agent === 'mike') {
        const project = JSON.parse(messages[1].content);
        assert.equal(project.hasExistingPrd, true);
        assert.equal(project.hasExistingArchitecture, true);
      }
      if (agent === 'emma') assert.match(messages[0].content, /required "handoff"/);
      if (agent === 'bob' || agent === 'alex') assert.ok(messages[1].content.includes(scenario.expectedPrd));
      if (agent === 'alex') assert.ok(messages[1].content.includes(scenario.expectedArchitecture));
      return Response.json({ choices: [{ message: { content: stageReplies[agent] } }] });
    });
    t.mock.method(pool, 'query', async (sql, parameters) => {
      if (sql.includes('INSERT INTO messages')) persisted.push(parameters[2]);
      return { rows: [] };
    });

    await runMultiAgentPipeline({
      ...baseInput, ...scenario.input,
      userPrompt: scenario.prompt, targetAgent: getMentionedAgent(scenario.prompt),
    }, event => events.push(event));

    assert.deepEqual(persisted, scenario.agents);
    assert.deepEqual(events.filter(event => event.type === 'agent_start').map(event => event.agent.id), scenario.agents);
    assert.ok(events.some(event => event.type === 'files_update' && event.versionNumber === 1));
    assert.equal(events.at(-1).type, 'done');
  });
}
