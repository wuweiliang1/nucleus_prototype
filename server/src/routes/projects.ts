import crypto from 'node:crypto';
import { Router } from 'express';
import JSZip from 'jszip';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { query } from '../db.js';

export const projectsRouter = Router();

// Public showcase (published apps)
projectsRouter.get('/public/showcase', async (_req, res) => {
  try {
    const result = await query(
      `SELECT p.id, p.title, p.description, p.published_slug, p.current_version, p.updated_at, u.name AS author_name
       FROM projects p
       JOIN users u ON u.id = p.user_id
       WHERE p.is_public = TRUE AND p.published_slug IS NOT NULL
       ORDER BY p.updated_at DESC
       LIMIT 12`
    );
    res.json({ projects: result.rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch showcase' });
  }
});

// List current user's projects
projectsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, title, description, current_version, published_slug, is_public, created_at, updated_at
       FROM projects
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user!.id]
    );
    res.json({ projects: result.rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list projects' });
  }
});

// Create project
projectsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const title = String(req.body?.title || '未命名应用').trim().slice(0, 80);
    const description = String(req.body?.description || '').trim().slice(0, 300);

    await query(
      `INSERT INTO projects (id, user_id, title, description)
       VALUES ($1, $2, $3, $4)`,
      [id, req.user!.id, title, description]
    );

    const created = await query('SELECT * FROM projects WHERE id = $1', [id]);
    res.status(201).json({ project: created.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create project' });
  }
});

// Get full project details + messages + versions
projectsRouter.get('/:id', requireAuth, async (req, res) => {
  try {
    const projectRes = await query('SELECT * FROM projects WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user!.id,
    ]);
    if (projectRes.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const [messagesRes, versionsRes] = await Promise.all([
      query(
        `SELECT id, role, agent_name, agent_title, content, meta, created_at
         FROM messages
         WHERE project_id = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      ),
      query(
        `SELECT id, version_number, summary, agent_name, created_at
         FROM project_versions
         WHERE project_id = $1
         ORDER BY version_number DESC`,
        [req.params.id]
      ),
    ]);

    res.json({
      project: projectRes.rows[0],
      messages: messagesRes.rows,
      versions: versionsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load project' });
  }
});

// Save manual file edit
projectsRouter.put('/:id/files', requireAuth, async (req, res) => {
  try {
    const files = req.body?.files;
    if (!files || typeof files !== 'object') {
      res.status(400).json({ error: 'Invalid files payload' });
      return;
    }
    const check = await query<{ current_version: number; prd_md: string; architecture_md: string }>(
      'SELECT current_version, prd_md, architecture_md FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const nextVersion = check.rows[0].current_version + 1;
    await query(
      'UPDATE projects SET files = $1::jsonb, current_version = $2, updated_at = NOW() WHERE id = $3',
      [JSON.stringify(files), nextVersion, req.params.id]
    );
    await query(
      `INSERT INTO project_versions (id, project_id, version_number, summary, agent_name, files, prd_md, architecture_md)
       VALUES ($1, $2, $3, $4, 'user', $5::jsonb, $6, $7)`,
      [
        crypto.randomUUID(),
        req.params.id,
        nextVersion,
        `手动编辑源码 (v${nextVersion})`,
        JSON.stringify(files),
        check.rows[0].prd_md,
        check.rows[0].architecture_md,
      ]
    );
    res.json({ ok: true, currentVersion: nextVersion });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save files' });
  }
});

// Rollback to a specific version
projectsRouter.post('/:id/rollback', requireAuth, async (req, res) => {
  try {
    const versionNumber = Number(req.body?.versionNumber);
    const ownerCheck = await query<{ current_version: number }>(
      'SELECT current_version FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (ownerCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const verRes = await query<{
      files: Record<string, string>;
      prd_md: string;
      architecture_md: string;
    }>(
      `SELECT files, prd_md, architecture_md
       FROM project_versions
       WHERE project_id = $1 AND version_number = $2`,
      [req.params.id, versionNumber]
    );
    if (verRes.rows.length === 0) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }
    const target = verRes.rows[0];
    const nextVersion = ownerCheck.rows[0].current_version + 1;

    await query(
      `UPDATE projects
       SET files = $1::jsonb, prd_md = $2, architecture_md = $3, current_version = $4, updated_at = NOW()
       WHERE id = $5`,
      [JSON.stringify(target.files), target.prd_md, target.architecture_md, nextVersion, req.params.id]
    );
    await query(
      `INSERT INTO project_versions (id, project_id, version_number, summary, agent_name, files, prd_md, architecture_md)
       VALUES ($1, $2, $3, $4, 'system', $5::jsonb, $6, $7)`,
      [
        crypto.randomUUID(),
        req.params.id,
        nextVersion,
        `回滚至 v${versionNumber}`,
        JSON.stringify(target.files),
        target.prd_md,
        target.architecture_md,
      ]
    );

    res.json({ files: target.files, currentVersion: nextVersion });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rollback failed' });
  }
});

// Publish app to public URL /p/:slug
projectsRouter.post('/:id/publish', requireAuth, async (req, res) => {
  try {
    const projRes = await query<{ id: string; title: string; published_slug: string | null }>(
      'SELECT id, title, published_slug FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (projRes.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const existingSlug = projRes.rows[0].published_slug;
    const rawCustom = String(req.body?.slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 36);

    const slug = existingSlug || rawCustom || `app-${crypto.randomBytes(4).toString('hex')}`;

    await query(
      'UPDATE projects SET published_slug = $1, is_public = TRUE, updated_at = NOW() WHERE id = $2',
      [slug, req.params.id]
    );

    const baseUrl = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    res.json({
      slug,
      url: `${baseUrl}/p/${slug}`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Publish failed' });
  }
});

// Remix (fork) a public project into current user's workspace
projectsRouter.post('/:id/remix', requireAuth, async (req, res) => {
  try {
    const srcRes = await query(
      'SELECT title, description, prd_md, architecture_md, schema_json, files FROM projects WHERE id = $1 AND (is_public = TRUE OR user_id = $2)',
      [req.params.id, req.user!.id]
    );
    if (srcRes.rows.length === 0) {
      res.status(404).json({ error: 'Source project not found' });
      return;
    }
    const src = srcRes.rows[0];
    const newId = crypto.randomUUID();
    await query(
      `INSERT INTO projects (id, user_id, title, description, prd_md, architecture_md, schema_json, files, current_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 1)`,
      [
        newId,
        req.user!.id,
        `${src.title} (Remix)`,
        src.description,
        src.prd_md,
        src.architecture_md,
        JSON.stringify(src.schema_json || []),
        JSON.stringify(src.files || {}),
      ]
    );
    await query(
      `INSERT INTO project_versions (id, project_id, version_number, summary, agent_name, files, prd_md, architecture_md)
       VALUES ($1, $2, 1, 'Remix 初始化', 'system', $3::jsonb, $4, $5)`,
      [crypto.randomUUID(), newId, JSON.stringify(src.files || {}), src.prd_md, src.architecture_md]
    );
    res.status(201).json({ projectId: newId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Remix failed' });
  }
});

// Export project files as ZIP
projectsRouter.get('/:id/export', requireAuth, async (req, res) => {
  try {
    const projRes = await query<{ title: string; files: Record<string, string>; prd_md: string }>(
      'SELECT title, files, prd_md FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id]
    );
    if (projRes.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { title, files, prd_md } = projRes.rows[0];
    const zip = new JSZip();
    for (const [filename, content] of Object.entries(files || {})) {
      zip.file(filename, content);
    }
    if (prd_md) {
      zip.file('PRD.md', prd_md);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const safeName = title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'nucleus-app';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
  }
});

// Delete project
projectsRouter.delete('/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});
