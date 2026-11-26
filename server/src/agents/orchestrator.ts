import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { callLlm, extractJsonObject } from '../llm.js';
import {
  ALEX_ENGINEER_PROMPT,
  BOB_ARCHITECT_PROMPT,
  EMMA_PRD_PROMPT,
  MIKE_ROUTER_PROMPT,
} from './prompts.js';
import {
  AGENTS,
  type AgentId,
  type OrchestrateInput,
  type RaceCandidate,
  type SchemaCollection,
  type SseEvent,
} from './types.js';

function parseAlexOutput(raw: string): {
  chatSummary: string;
  versionSummary: string;
  files: Record<string, string>;
} {
  const files: Record<string, string> = {};
  const fileRegex = /<file\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/gi;
  let match: RegExpExecArray | null;
  while ((match = fileRegex.exec(raw)) !== null) {
    const filePath = match[1].trim();
    let content = match[2].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    // Strip accidental markdown fence inside <file>
    const fence = content.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
    if (fence) content = fence[1];
    if (filePath && content) {
      files[filePath] = content;
    }
  }

  if (Object.keys(files).length > 0) {
    const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
    const versionMatch = raw.match(/<version>([\s\S]*?)<\/version>/i);
    return {
      chatSummary: summaryMatch?.[1]?.trim() || '已完成应用代码构建并写入工作区。',
      versionSummary: versionMatch?.[1]?.trim().slice(0, 60) || '应用更新',
      files,
    };
  }

  // Fallback: try JSON if model still responded in JSON
  const parsed = extractJsonObject<{
    chatSummary?: string;
    versionSummary?: string;
    files?: Record<string, string>;
  }>(raw);
  if (!parsed.files || Object.keys(parsed.files).length === 0) {
    throw new Error('Alex 未返回有效的代码文件，请重试');
  }
  return {
    chatSummary: parsed.chatSummary || '已完成应用代码构建并写入工作区。',
    versionSummary: parsed.versionSummary || '应用更新',
    files: parsed.files,
  };
}

async function saveAgentMessage(
  projectId: string,
  agentId: AgentId,
  content: string,
  meta: Record<string, unknown> = {}
) {
  const agent = AGENTS[agentId];
  await query(
    `INSERT INTO messages (id, project_id, role, agent_name, agent_title, content, meta)
     VALUES ($1, $2, 'assistant', $3, $4, $5, $6::jsonb)`,
    [crypto.randomUUID(), projectId, agent.id, agent.title, content, JSON.stringify(meta)]
  );
}

export async function runMultiAgentPipeline(
  input: OrchestrateInput,
  emit: (ev: SseEvent) => void
): Promise<void> {
  const hasFiles = Object.keys(input.existingFiles).length > 0;

  // 1. Mike (Team Lead) — Route & plan
  emit({ type: 'agent_start', agent: AGENTS.mike, step: '分析需求并编排团队协作计划...' });

  const routerRaw = await callLlm(
    [
      { role: 'system', content: MIKE_ROUTER_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          userPrompt: input.userPrompt,
          hasExistingFiles: hasFiles,
          existingFileNames: Object.keys(input.existingFiles),
          selectedElement: input.selectedElement || null,
          runtimeError: input.runtimeError || null,
        }),
      },
    ],
    { temperature: 0.2, maxTokens: 1000, jsonMode: true }
  );

  const plan = extractJsonObject<{
    intent: string;
    projectTitle?: string;
    summary: string;
    runEmma: boolean;
    runBob: boolean;
    runAlex: boolean;
  }>(routerRaw);

  if (!hasFiles) {
    plan.runEmma = true;
    plan.runBob = true;
    plan.runAlex = true;
  }

  await saveAgentMessage(input.projectId, 'mike', plan.summary, {
    intent: plan.intent,
    pipeline: [
      plan.runEmma ? 'Emma' : null,
      plan.runBob ? 'Bob' : null,
      plan.runAlex ? 'Alex' : null,
    ].filter(Boolean),
  });

  emit({
    type: 'agent_message',
    agent: AGENTS.mike,
    content: plan.summary,
    meta: { intent: plan.intent },
  });

  if (plan.projectTitle && !hasFiles) {
    await query('UPDATE projects SET title = $1, updated_at = NOW() WHERE id = $2', [
      plan.projectTitle.slice(0, 60),
      input.projectId,
    ]);
  }

  let prdMd = input.existingPrd;
  let architectureMd = input.existingArchitecture;
  let schemaJson: SchemaCollection[] = [];

  // 2. Emma (PM) — PRD
  if (plan.runEmma) {
    emit({ type: 'agent_start', agent: AGENTS.emma, step: '撰写结构化产品需求文档 (PRD)...' });
    const emmaRaw = await callLlm(
      [
        { role: 'system', content: EMMA_PRD_PROMPT },
        {
          role: 'user',
          content: `User request:\n${input.userPrompt}\n\nExisting PRD (if any):\n${prdMd || 'None'}`,
        },
      ],
      { temperature: 0.4, maxTokens: 3000, jsonMode: true }
    );
    const emma = extractJsonObject<{ chatSummary: string; prdMarkdown: string }>(emmaRaw);
    prdMd = emma.prdMarkdown || prdMd;

    await query('UPDATE projects SET prd_md = $1, updated_at = NOW() WHERE id = $2', [
      prdMd,
      input.projectId,
    ]);
    await saveAgentMessage(input.projectId, 'emma', emma.chatSummary, { artifact: 'prd' });
    emit({ type: 'agent_message', agent: AGENTS.emma, content: emma.chatSummary, meta: { artifact: 'prd' } });
    emit({ type: 'artifact_update', prdMd });
  }

  // 3. Bob (Architect) — Architecture & Cloud DB Schema
  if (plan.runBob) {
    emit({ type: 'agent_start', agent: AGENTS.bob, step: '设计系统架构与 Nucleus Cloud 数据模型...' });
    const bobRaw = await callLlm(
      [
        { role: 'system', content: BOB_ARCHITECT_PROMPT },
        {
          role: 'user',
          content: `User request:\n${input.userPrompt}\n\nPRD:\n${prdMd}\n\nExisting Architecture:\n${architectureMd || 'None'}`,
        },
      ],
      { temperature: 0.3, maxTokens: 3000, jsonMode: true }
    );
    const bob = extractJsonObject<{
      chatSummary: string;
      architectureMarkdown: string;
      collections?: SchemaCollection[];
    }>(bobRaw);
    architectureMd = bob.architectureMarkdown || architectureMd;
    schemaJson = Array.isArray(bob.collections) ? bob.collections : [];

    await query(
      'UPDATE projects SET architecture_md = $1, schema_json = $2::jsonb, updated_at = NOW() WHERE id = $3',
      [architectureMd, JSON.stringify(schemaJson), input.projectId]
    );
    await saveAgentMessage(input.projectId, 'bob', bob.chatSummary, {
      artifact: 'architecture',
      collections: schemaJson.map((c) => c.name),
    });
    emit({
      type: 'agent_message',
      agent: AGENTS.bob,
      content: bob.chatSummary,
      meta: { artifact: 'architecture', collections: schemaJson.map((c) => c.name) },
    });
    emit({ type: 'artifact_update', architectureMd, schemaJson });
  }

  // 4. Alex (Full-Stack Engineer) — Code generation / iteration / visual edit / auto-fix
  if (plan.runAlex) {
    const stepText = input.runtimeError
      ? '分析运行时错误堆栈并自动修复代码...'
      : input.selectedElement
        ? `定位元素 ${input.selectedElement.selector} 并精准修改...`
        : hasFiles
          ? '基于当前代码进行增量功能开发...'
          : '编写多文件全栈应用代码并接入 NucleusDB...';

    emit({ type: 'agent_start', agent: AGENTS.alex, step: stepText });

    const alexContextParts = [
      `User Request:\n${input.userPrompt}`,
      prdMd ? `PRD:\n${prdMd}` : '',
      architectureMd ? `Architecture & Cloud Schema:\n${architectureMd}` : '',
      schemaJson.length > 0 ? `Defined NucleusDB Collections:\n${JSON.stringify(schemaJson, null, 2)}` : '',
      input.selectedElement
        ? `VISUAL SELECT-TO-EDIT TARGET:\nSelector: ${input.selectedElement.selector}\nTag: ${input.selectedElement.tagName}\nText: ${input.selectedElement.text}\nHTML Snippet:\n${input.selectedElement.snippet}\nFocus your edits specifically on this element and its related styling/behavior while preserving everything else.`
        : '',
      input.runtimeError
        ? `RUNTIME ERROR TO FIX:\nMessage: ${input.runtimeError.message}\nStack:\n${input.runtimeError.stack || 'N/A'}\nFix the root cause cleanly.`
        : '',
      hasFiles ? `Existing Project Files:\n${JSON.stringify(input.existingFiles)}` : '',
    ].filter(Boolean);

    const alexRaw = await callLlm(
      [
        { role: 'system', content: ALEX_ENGINEER_PROMPT },
        { role: 'user', content: alexContextParts.join('\n\n---\n\n') },
      ],
      { temperature: 0.35, maxTokens: 32000, jsonMode: false }
    );

    const alex = parseAlexOutput(alexRaw);

    const mergedFiles: Record<string, string> = {
      ...input.existingFiles,
      ...(alex.files || {}),
    };

    const versionRes = await query<{ current_version: number }>(
      'SELECT current_version FROM projects WHERE id = $1',
      [input.projectId]
    );
    const nextVersion = (versionRes.rows[0]?.current_version || 0) + 1;
    const versionSummary = alex.versionSummary || `v${nextVersion} 更新`;

    await query(
      `UPDATE projects
       SET files = $1::jsonb, current_version = $2, description = COALESCE(NULLIF(description, ''), $3), updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(mergedFiles), nextVersion, input.userPrompt.slice(0, 160), input.projectId]
    );

    await query(
      `INSERT INTO project_versions (id, project_id, version_number, summary, agent_name, files, prd_md, architecture_md)
       VALUES ($1, $2, $3, $4, 'alex', $5::jsonb, $6, $7)`,
      [
        crypto.randomUUID(),
        input.projectId,
        nextVersion,
        versionSummary,
        JSON.stringify(mergedFiles),
        prdMd,
        architectureMd,
      ]
    );

    await saveAgentMessage(input.projectId, 'alex', alex.chatSummary, {
      versionNumber: nextVersion,
      fileNames: Object.keys(mergedFiles),
    });

    emit({
      type: 'agent_message',
      agent: AGENTS.alex,
      content: alex.chatSummary,
      meta: { versionNumber: nextVersion, fileNames: Object.keys(mergedFiles) },
    });
    emit({
      type: 'files_update',
      files: mergedFiles,
      versionNumber: nextVersion,
      summary: versionSummary,
    });
  }

  emit({ type: 'done', projectId: input.projectId });
}

export async function runRaceModePipeline(
  input: OrchestrateInput,
  emit: (ev: SseEvent) => void
): Promise<void> {
  emit({
    type: 'agent_start',
    agent: AGENTS.mike,
    step: '启动 Race Mode：并行调度双赛道模型进行方案赛马 PK...',
  });

  const mikeIntro =
    '已开启 **Race Mode（双方案赛马模式）**！我将同时调度两条独立赛道并行生成完整应用，生成后你可以左右分屏实时交互体验，挑选最满意的一版合入主分支。';
  await saveAgentMessage(input.projectId, 'mike', mikeIntro, { mode: 'race' });
  emit({ type: 'agent_message', agent: AGENTS.mike, content: mikeIntro, meta: { mode: 'race' } });

  const tracks = [
    {
      track: 'A' as const,
      id: 'track-a',
      label: '方案 A · 极简现代 SaaS',
      model: config.llm.model,
      styleDirection:
        'Clean modern SaaS aesthetic (Linear/Vercel style): crisp neutral surfaces, indigo accents, refined typography, generous whitespace, structured dashboard layout.',
      temperature: 0.35,
    },
    {
      track: 'B' as const,
      id: 'track-b',
      label: '方案 B · 高质感暗色/视觉流',
      model: config.llm.raceModel || config.llm.model,
      styleDirection:
        'Bold dark glassmorphism / Neo-studio aesthetic: rich slate-950 canvas, subtle glowing borders, vibrant emerald/cyan accents, tactile micro-interactions and visual data cards.',
      temperature: 0.65,
    },
  ];

  const runTrack = async (t: (typeof tracks)[number]): Promise<RaceCandidate> => {
    emit({
      type: 'race_progress',
      track: t.track,
      status: 'running',
      label: t.label,
      model: t.model,
    });
    const started = Date.now();
    const buildPrompt = [
      `User Request:\n${input.userPrompt}`,
      `VISUAL DIRECTION FOR THIS RACE TRACK:\n${t.styleDirection}`,
      input.existingPrd ? `Existing PRD:\n${input.existingPrd}` : '',
      Object.keys(input.existingFiles).length > 0
        ? `Existing Files (you may redesign/upgrade freely):\n${JSON.stringify(input.existingFiles)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n---\n\n');

    let raw: string;
    let usedModel = t.model;
    try {
      raw = await callLlm(
        [
          { role: 'system', content: ALEX_ENGINEER_PROMPT },
          { role: 'user', content: buildPrompt },
        ],
        { model: t.model, temperature: t.temperature, maxTokens: 32000, jsonMode: false }
      );
    } catch {
      // Fallback to primary model if secondary race model is unavailable
      usedModel = config.llm.model;
      raw = await callLlm(
        [
          { role: 'system', content: ALEX_ENGINEER_PROMPT },
          { role: 'user', content: buildPrompt },
        ],
        { model: usedModel, temperature: t.temperature, maxTokens: 32000, jsonMode: false }
      );
    }

    const parsed = parseAlexOutput(raw);

    const durationMs = Date.now() - started;
    emit({
      type: 'race_progress',
      track: t.track,
      status: 'done',
      label: t.label,
      model: usedModel,
      durationMs,
    });

    return {
      id: t.id,
      label: t.label,
      model: usedModel,
      styleDirection: t.styleDirection,
      summary: parsed.chatSummary || t.label,
      files: parsed.files || {},
      durationMs,
    };
  };

  const candidates = await Promise.all(tracks.map(runTrack));
  const sessionId = crypto.randomUUID();

  await query(
    `INSERT INTO race_sessions (id, project_id, prompt, candidates)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [sessionId, input.projectId, input.userPrompt, JSON.stringify(candidates)]
  );

  const summaryMsg = `双赛道均已构建完成！\n- **${candidates[0].label}**（${candidates[0].model}，${(candidates[0].durationMs / 1000).toFixed(1)}s）\n- **${candidates[1].label}**（${candidates[1].model}，${(candidates[1].durationMs / 1000).toFixed(1)}s）\n请在右侧分屏预览中体验并点击「采纳此方案」。`;
  await saveAgentMessage(input.projectId, 'alex', summaryMsg, { raceSessionId: sessionId });
  emit({ type: 'agent_message', agent: AGENTS.alex, content: summaryMsg, meta: { raceSessionId: sessionId } });
  emit({ type: 'race_ready', sessionId, candidates });
  emit({ type: 'done', projectId: input.projectId });
}
