import crypto from 'node:crypto';
import { Router } from 'express';
import { runMultiAgentPipeline } from '../agents/orchestrator.js';
import { parseChatImages, type ChatImage } from '../agents/images.js';
import { getMentionedAgent } from '../agents/mentions.js';
import { AGENTS, type SchemaCollection, type SseEvent } from '../agents/types.js';
import { requireAuth } from '../auth.js';
import { claimMinutes, finishHandoff } from '../brainstorm/store.js';
import { BrainstormError } from '../brainstorm/types.js';
import { query } from '../db.js';
import { buildRunnableHtml } from '../runtime/bundler.js';

export const chatRouter = Router();

// Multi-agent chat SSE endpoint
chatRouter.post('/:id/chat', requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  let prompt = String(req.body?.prompt || '').trim();
  const minutesId: unknown = req.body?.brainstormMinutesId;
  if (minutesId !== undefined && (typeof minutesId !== 'string' || !minutesId.length || minutesId.length > 60)) {
    res.status(400).json({ error: '会议纪要 ID 无效' });
    return;
  }
  const targetAgent = minutesId ? 'mike' : getMentionedAgent(prompt);
  const selectedElement = minutesId ? null : req.body?.selectedElement || null;
  const runtimeError = minutesId ? null : req.body?.runtimeError || null;

  let images: ChatImage[];
  try {
    images = minutesId ? [] : parseChatImages(req.body?.images);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '图片格式无效' });
    return;
  }

  if (!prompt && !images.length && !minutesId) {
    res.status(400).json({ error: '请输入消息或添加图片' });
    return;
  }

  const projRes = await query<{
    id: string;
    files: Record<string, string>;
    prd_md: string;
    architecture_md: string;
    schema_json: SchemaCollection[];
  }>(
    'SELECT id, files, prd_md, architecture_md, schema_json FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, req.user!.id]
  );

  if (projRes.rows.length === 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const project = projRes.rows[0];

  let handoff: Awaited<ReturnType<typeof claimMinutes>> | undefined;
  try {
    if (typeof minutesId === 'string') {
      handoff = await claimMinutes(projectId, minutesId);
      prompt = `@Mike 请根据已确认的 BrainStorm 纪要「${handoff.topic}」推进已定事项。`;
    }
    await query(
      `INSERT INTO messages (id, project_id, role, agent_name, agent_title, content, meta)
       VALUES ($1, $2, 'user', 'user', 'User', $3, $4::jsonb)`,
      [
        crypto.randomUUID(), projectId, prompt,
        JSON.stringify({
          selectedElement, runtimeError, targetAgent, ...(images.length && { images }),
          ...(handoff && { brainstormMinutesId: minutesId, brainstormSessionId: handoff.session_id }),
        }),
      ]
    );
  } catch (error) {
    if (handoff && typeof minutesId === 'string') await finishHandoff(minutesId, handoff.token, 'failed').catch(() => {});
    res.status(error instanceof BrainstormError ? error.status : 503)
      .json({ error: error instanceof BrainstormError ? error.message : '暂时无法保存消息，请重试' });
    return;
  }

  // Switch to SSE streaming
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Keepalive heartbeat every 8s to prevent CLB / proxy 60s idle timeout during long LLM calls
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(': keepalive\n\n');
    }
  }, 8000);

  let activeAgent = AGENTS[targetAgent ?? 'mike'];
  const emit = (event: SseEvent) => {
    if (event.type === 'agent_start') activeAgent = event.agent;
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const input = {
      projectId,
      userPrompt: prompt || '请根据附图构建或完善应用，参考图中的布局、文案和视觉风格。',
      images,
      existingFiles: project.files || {},
      existingPrd: project.prd_md || '',
      existingArchitecture: project.architecture_md || '',
      existingSchema: Array.isArray(project.schema_json) ? project.schema_json : [],
      brainstormMinutes: handoff?.markdown,
      targetAgent,
      selectedElement,
      runtimeError,
    };

    await runMultiAgentPipeline(input, event => {
      if (!handoff || event.type !== 'done') emit(event);
    });
    if (handoff && typeof minutesId === 'string') {
      await finishHandoff(minutesId, handoff.token, 'done');
      emit({ type: 'done', projectId });
    }
  } catch (err) {
    if (handoff && typeof minutesId === 'string') await finishHandoff(minutesId, handoff.token, 'failed').catch(() => {});
    const errMsg = err instanceof Error ? err.message : 'Agent execution failed';
    const agent = activeAgent;
    console.error(`[Nucleus] Chat error on project ${projectId}:`, errMsg);
    await query(
      `INSERT INTO messages (id, project_id, role, agent_name, agent_title, content, meta)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6::jsonb)`,
      [
        crypto.randomUUID(),
        projectId,
        agent.id,
        agent.title,
        `执行遇到异常：${errMsg}`,
        JSON.stringify({ isError: true }),
      ]
    ).catch(() => {});
    emit({
      type: 'error',
      message: errMsg,
      agent,
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

// Preview HTML endpoint (supports rendering arbitrary files or current project files with Inspector enabled)
chatRouter.post('/:id/preview-bundle', requireAuth, async (req, res) => {
  try {
    const files = (req.body?.files || {}) as Record<string, string>;
    const enableInspector = req.body?.enableInspector !== false;
    const html = buildRunnableHtml({
      projectId: String(req.params.id),
      files,
      apiOrigin: '',
      enableInspector,
    });
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build preview' });
  }
});
