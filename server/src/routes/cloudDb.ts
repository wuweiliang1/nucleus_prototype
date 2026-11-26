import crypto from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';

export const cloudDbRouter = Router();

function sanitizeCollection(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
}

// List items in a project's collection
cloudDbRouter.get('/:projectId/collections/:collection', async (req, res) => {
  try {
    const { projectId } = req.params;
    const collection = sanitizeCollection(req.params.collection);
    const result = await query<{
      id: string;
      payload: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, payload, created_at, updated_at
       FROM app_data
       WHERE project_id = $1 AND collection = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [projectId, collection]
    );
    const items = result.rows.map((row) => ({
      ...row.payload,
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list collection' });
  }
});

// Add item to a project's collection
cloudDbRouter.post('/:projectId/collections/:collection', async (req, res) => {
  try {
    const { projectId } = req.params;
    const collection = sanitizeCollection(req.params.collection);
    const payload = typeof req.body === 'object' && req.body !== null ? { ...req.body } : {};
    delete payload.id;

    const id = crypto.randomUUID();
    const result = await query<{ created_at: string; updated_at: string }>(
      `INSERT INTO app_data (id, project_id, collection, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING created_at, updated_at`,
      [id, projectId, collection, JSON.stringify(payload)]
    );
    const row = result.rows[0];
    res.status(201).json({
      item: {
        ...payload,
        id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create item' });
  }
});

// Patch item
cloudDbRouter.patch('/:projectId/collections/:collection/:itemId', async (req, res) => {
  try {
    const { projectId, itemId } = req.params;
    const collection = sanitizeCollection(req.params.collection);
    const patch = typeof req.body === 'object' && req.body !== null ? { ...req.body } : {};
    delete patch.id;

    const result = await query<{
      id: string;
      payload: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE app_data
       SET payload = payload || $1::jsonb, updated_at = NOW()
       WHERE id = $2 AND project_id = $3 AND collection = $4
       RETURNING id, payload, created_at, updated_at`,
      [JSON.stringify(patch), itemId, projectId, collection]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const row = result.rows[0];
    res.json({
      item: {
        ...row.payload,
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update item' });
  }
});

// Delete item
cloudDbRouter.delete('/:projectId/collections/:collection/:itemId', async (req, res) => {
  try {
    const { projectId, itemId } = req.params;
    const collection = sanitizeCollection(req.params.collection);
    await query(
      'DELETE FROM app_data WHERE id = $1 AND project_id = $2 AND collection = $3',
      [itemId, projectId, collection]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete item' });
  }
});

// Inspect all collections for a project (used by Nucleus Studio Cloud Data Explorer)
cloudDbRouter.get('/:projectId/inspect', async (req, res) => {
  try {
    const { projectId } = req.params;
    const result = await query<{
      id: string;
      collection: string;
      payload: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, collection, payload, created_at, updated_at
       FROM app_data
       WHERE project_id = $1
       ORDER BY collection ASC, created_at DESC
       LIMIT 300`,
      [projectId]
    );
    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const row of result.rows) {
      if (!grouped[row.collection]) grouped[row.collection] = [];
      grouped[row.collection].push({
        id: row.id,
        ...row.payload,
        createdAt: row.created_at,
      });
    }
    res.json({ collections: grouped, totalRows: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to inspect data' });
  }
});
