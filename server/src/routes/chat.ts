import crypto from 'node:crypto';
import { Router } from 'express';
import { runMultiAgentPipeline, runRaceModePipeline } from '../agents/orchestrator.js';
import type { RaceCandidate, SseEvent } from '../agents/types.js';
import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import { buildRunnableHtml } from '../runtime/bundler.js';

export const chatRouter = Router();

// Multi-agent chat & Race Mode SSE endpoint
chatRouter.post('/:id/chat', requireAuth, async (req, res) => {
  const projectId = String(req.params.id);
  const prompt = String(req.body?.prompt || '').trim();
  const raceMode = Boolean(req.body?.raceMode);
  const selectedElement = req.body?.selectedElement || null;
  const runtimeError = req.body?.runtimeError || null;

  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  const projRes = await query<{
    id: string;
    files: Record<string, string>;
    prd_md: string;
    architecture_md: string;
  }>(
    'SELECT id, files, prd_md, architecture_md FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, req.user!.id]
  );

  if (projRes.rows.length === 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const project = projRes.rows[0];

  // Persist user message
  await query(
    `INSERT INTO messages (id, project_id, role, agent_name, agent_title, content, meta)
     VALUES ($1, $2, 'user', 'user', 'User', $3, $4::jsonb)`,
    [
      crypto.randomUUID(),
      projectId,
      prompt,
      JSON.stringify({ raceMode, selectedElement, runtimeError }),
    ]
  );

  // Switch to SSE streaming
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const emit = (event: SseEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const input = {
      projectId,
      userPrompt: prompt,
      existingFiles: project.files || {},
      existingPrd: project.prd_md || '',
      existingArchitecture: project.architecture_md || '',
      selectedElement,
      runtimeError,
    };

    if (raceMode) {
      await runRaceModePipeline(input, emit);
    } else {
      await runMultiAgentPipeline(input, emit);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Agent execution failed';
    await query(
      `INSERT INTO messages (id, project_id, role, agent_name, agent_title, content, meta)
       VALUES ($1, $2, 'assistant', 'mike', 'Team Lead', $3, $4::jsonb)`,
      [
        crypto.randomUUID(),
        projectId,
        `执行遇到异常：${errMsg}`,
        JSON.stringify({ isError: true }),
      ]
    ).catch(() => {});
    emit({
      type: 'error',
      message: errMsg,
    });
  } finally {
    res.end();
  }
});

// Adopt a winner from Race Mode
chatRouter.post('/:id/race/:sessionId/select', requireAuth, async (req, res) => {
  try {
    const { id: projectId, sessionId } = req.params;
    const index = Number(req.body?.index);

    const projRes = await query<{ current_version: number; prd_md: string; architecture_md: string }>(
      'SELECT current_version, prd_md, architecture_md FROM projects WHERE id = $1 AND user_id = $2',
      [projectId, req.user!.id]
    );
    if (projRes.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const raceRes = await query<{ candidates: RaceCandidate[] }>(
      'SELECT candidates FROM race_sessions WHERE id = $1 AND project_id = $2',
      [sessionId, projectId]
    );
    if (raceRes.rows.length === 0) {
      res.status(404).json({ error: 'Race session not found' });
      return;
    }

    const winner = raceRes.rows[0].candidates[index];
    if (!winner) {
      res.status(400).json({ error: 'Invalid candidate index' });
      return;
    }

    const nextVersion = projRes.rows[0].current_version + 1;
    await query(
      'UPDATE projects SET files = $1::jsonb, current_version = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(winner.files), nextVersion, projectId]
    );
    await query(
      `INSERT INTO project_versions (id, project_id, version_number, summary, agent_name, files, prd_md, architecture_md)
       VALUES ($1, $2, $3, $4, 'alex', $5::jsonb, $6, $7)`,
      [
        crypto.randomUUID(),
        projectId,
        nextVersion,
        `Race Mode 胜出: ${winner.label}`,
        JSON.stringify(winner.files),
        projRes.rows[0].prd_md,
        projRes.rows[0].architecture_md,
      ]
    );
    await query('UPDATE race_sessions SET selected_index = $1 WHERE id = $2', [index, sessionId]);

    res.json({
      files: winner.files,
      currentVersion: nextVersion,
      winnerLabel: winner.label,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to select race winner' });
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
