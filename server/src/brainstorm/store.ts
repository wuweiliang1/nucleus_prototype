import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { inTransaction, query } from '../db.js';
import type { ChatImage } from '../agents/images.js';
import { BrainstormError, type BrainstormMode, type MinutesRow, type Participant, type SessionRow, type Snapshot, type Turn } from './types.js';

export const LEASE_TIME = "INTERVAL '60 seconds'";
const briefFields = 'id, topic, mode, status, round, round_limit, created_at';
const turnFields = 'id, round, participant_id, kind, content, images';

export async function recoverRoom(projectId: string, id?: string) {
  await query(
    `UPDATE brainstorm_sessions
     SET status = CASE WHEN status = 'drafting' OR stop_requested = 'finish' THEN 'ready' ELSE 'paused' END,
         error = '会议执行已中断，请继续讨论或重新生成纪要。', stop_requested = NULL,
         lease_token = NULL, lease_until = NULL, revision = revision + 1, updated_at = NOW()
     WHERE project_id = $1 AND ($2::text IS NULL OR id = $2)
       AND status IN ('running', 'drafting') AND lease_until < NOW()`,
    [projectId, id ?? null]
  );
}

async function getRoom(client: PoolClient, projectId: string, id: string) {
  const { rows } = await client.query<SessionRow>(
    'SELECT * FROM brainstorm_sessions WHERE project_id = $1 AND id = $2 FOR UPDATE',
    [projectId, id]
  );
  if (!rows[0]) throw new BrainstormError(404, '会议不存在');
  return rows[0];
}

export async function createRoom(projectId: string, data: {
  id: string; topic: string; mode: BrainstormMode; participants: Participant[];
  snapshot: Snapshot; images: ChatImage[]; roundLimit: number | null;
}) {
  return inTransaction(async client => {
    const token = crypto.randomUUID();
    const { rows } = await client.query<SessionRow>(
      `INSERT INTO brainstorm_sessions
         (id, project_id, topic, mode, participants, snapshot, images, round_limit, status, lease_token, lease_until)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, 'running', $9, NOW() + ${LEASE_TIME})
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [data.id, projectId, data.topic, data.mode, JSON.stringify(data.participants), JSON.stringify(data.snapshot),
        JSON.stringify(data.images), data.roundLimit, token]
    );
    if (!rows[0]) return { room: await getRoom(client, projectId, data.id), token: null };
    if (data.mode === 'human') {
      await client.query(
        "INSERT INTO brainstorm_turns (session_id, round, participant_id, kind, content) VALUES ($1, 1, 'human', 'human', $2)",
        [data.id, data.topic]
      );
    }
    return { room: rows[0], token };
  });
}

export async function listRooms(projectId: string) {
  await recoverRoom(projectId);
  const { rows } = await query(`SELECT ${briefFields} FROM brainstorm_sessions WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return rows;
}

export async function listMinutes(projectId: string) {
  const { rows } = await query<MinutesRow & { session_id: string; topic: string; author_name: string | null; base_version: number }>(
    `SELECT m.id, m.session_id, m.author_id, m.markdown, m.confirmed_at,
            CASE WHEN m.handoff_status = 'running' AND m.handoff_started_at < NOW() - INTERVAL '60 minutes'
                 THEN 'failed' ELSE m.handoff_status END AS handoff_status,
            s.topic, (s.snapshot->>'version')::integer AS base_version,
            (SELECT member->>'name' FROM jsonb_array_elements(s.participants) member
              WHERE member->>'id' = m.author_id) AS author_name
     FROM brainstorm_minutes m JOIN brainstorm_sessions s ON s.id = m.session_id
     WHERE s.project_id = $1 AND m.confirmed_at IS NOT NULL ORDER BY m.confirmed_at DESC`, [projectId]
  );
  return rows;
}

export async function roomDetail(projectId: string, id: string, after: number, includeImages: boolean) {
  await recoverRoom(projectId, id);
  const { rows } = await query(
    `SELECT ${briefFields}, participants, (snapshot->>'version')::integer AS base_version, cursor, stop_requested, error, revision
      ${includeImages ? ', images' : ''}
     FROM brainstorm_sessions WHERE project_id = $1 AND id = $2`, [projectId, id]
  );
  const room = rows[0];
  if (!room) throw new BrainstormError(404, '会议不存在');
  const [turns, minutes] = await Promise.all([
    query<Turn>(
      `SELECT ${turnFields} FROM brainstorm_turns WHERE session_id = $1 AND id > $2 ORDER BY id`, [id, after]
    ),
    query<MinutesRow>(
      `SELECT id, author_id, markdown, confirmed_at,
        CASE WHEN handoff_status = 'running' AND handoff_started_at < NOW() - INTERVAL '60 minutes'
              THEN 'failed' ELSE handoff_status END AS handoff_status
       FROM brainstorm_minutes WHERE session_id = $1`, [id]
    ),
  ]);
  return { room, turns: turns.rows, minutes: minutes.rows[0] ?? null };
}

export type RoomAction =
  | { type: 'next'; expectedRound: number; text: string; images: ChatImage[] }
  | { type: 'resume' | 'pause' | 'finish' | 'return' }
  | { type: 'draft'; author: string }
  | { type: 'save'; markdown: string };

export async function changeRoom(projectId: string, id: string, action: RoomAction) {
  await recoverRoom(projectId, id);
  return inTransaction(async client => {
    const room = await getRoom(client, projectId, id);
    let token: string | null = null;
    let author: string | undefined;
    switch (action.type) {
      case 'next': {
        const canAdvance = room.mode === 'human' ? room.status === 'waiting'
          : room.status === 'ready' && room.round < 5 && !action.text && !action.images.length;
        if (!canAdvance || room.round !== action.expectedRound) {
          throw new BrainstormError(409, '当前轮次已变化，请刷新会议后继续');
        }
        token = crypto.randomUUID();
        await client.query(
          `UPDATE brainstorm_sessions SET round = round + 1, cursor = 0, status = 'running', error = NULL,
            round_limit = CASE WHEN mode = 'ai' THEN round + 1 ELSE round_limit END,
            lease_token = $2, lease_until = NOW() + ${LEASE_TIME} WHERE id = $1`, [id, token]
        );
        if (action.text || action.images.length) {
          await client.query(
            `INSERT INTO brainstorm_turns (session_id, round, participant_id, kind, content, images)
             VALUES ($1, $2, 'human', 'human', $3, $4::jsonb)`,
            [id, room.round + 1, action.text, JSON.stringify(action.images)]
          );
        }
        break;
      }
      case 'resume':
        if (room.status !== 'paused') throw new BrainstormError(409, '只有暂停的会议可以继续');
        token = crypto.randomUUID();
        await client.query(
          `UPDATE brainstorm_sessions SET status = 'running', stop_requested = NULL, error = NULL,
            lease_token = $2, lease_until = NOW() + ${LEASE_TIME} WHERE id = $1`, [id, token]
        );
        break;
      case 'pause':
      case 'finish':
        if (room.status === 'running') {
          if (room.stop_requested === 'finish') return { token, author };
          await client.query('UPDATE brainstorm_sessions SET stop_requested = $2 WHERE id = $1', [id, action.type]);
        } else if (action.type === 'finish' && ['waiting', 'paused', 'ready'].includes(room.status)) {
          await client.query("UPDATE brainstorm_sessions SET status = 'ready', stop_requested = NULL, error = NULL WHERE id = $1", [id]);
        } else {
          throw new BrainstormError(409, '当前会议状态无法执行此操作');
        }
        break;
      case 'draft':
        if (!['waiting', 'paused', 'ready'].includes(room.status)) throw new BrainstormError(409, '请在发言结束或暂停后起草纪要');
        if (!room.participants.some(person => person.id === action.author)) {
          throw new BrainstormError(400, '请选择一位在场参与者执笔');
        }
        author = action.author;
        token = crypto.randomUUID();
        await client.query(
          `UPDATE brainstorm_sessions SET status = 'drafting', stop_requested = NULL, error = NULL,
            lease_token = $2, lease_until = NOW() + ${LEASE_TIME} WHERE id = $1`, [id, token]
        );
        break;
      case 'return':
        if (room.status !== 'review') throw new BrainstormError(409, '只有未确认的纪要可以返回讨论');
        await client.query('DELETE FROM brainstorm_minutes WHERE session_id = $1 AND confirmed_at IS NULL', [id]);
        await client.query('UPDATE brainstorm_sessions SET status = $2, stop_requested = NULL WHERE id = $1', [
          id, room.cursor < room.participants.length ? 'paused' : room.mode === 'human' ? 'waiting' : 'ready',
        ]);
        break;
      case 'save':
        if (room.status === 'closed') return { token, author };
        if (room.status !== 'review') throw new BrainstormError(409, '请先生成纪要草稿');
        await client.query('UPDATE brainstorm_minutes SET markdown = $2, confirmed_at = NOW() WHERE session_id = $1', [id, action.markdown]);
        await client.query("UPDATE brainstorm_sessions SET status = 'closed' WHERE id = $1", [id]);
        break;
    }
    await client.query('UPDATE brainstorm_sessions SET revision = revision + 1, updated_at = NOW() WHERE id = $1', [id]);
    return { token, author };
  });
}

export async function claimMinutes(projectId: string, id: string) {
  const token = crypto.randomUUID();
  return inTransaction(async client => {
    const { rows } = await client.query<{ markdown: string; topic: string; session_id: string }>(
      `UPDATE brainstorm_minutes m SET handoff_status = 'running', handoff_token = $3, handoff_started_at = NOW()
       FROM brainstorm_sessions s WHERE m.session_id = s.id AND s.project_id = $1
         AND m.id = $2 AND m.confirmed_at IS NOT NULL AND s.status = 'closed'
         AND (m.handoff_status IS NULL OR m.handoff_status = 'failed'
           OR (m.handoff_status = 'running' AND m.handoff_started_at < NOW() - INTERVAL '60 minutes'))
       RETURNING m.markdown, s.topic, s.id AS session_id`, [projectId, id, token]
    );
    if (!rows[0]) {
      const existing = await client.query(
        'SELECT 1 FROM brainstorm_minutes m JOIN brainstorm_sessions s ON s.id = m.session_id WHERE s.project_id = $1 AND m.id = $2 AND m.confirmed_at IS NOT NULL',
        [projectId, id]
      );
      if (!existing.rowCount) throw new BrainstormError(404, '已确认的会议纪要不存在');
      throw new BrainstormError(409, '这份纪要已交接或正在交接');
    }
    await client.query('UPDATE brainstorm_sessions SET revision = revision + 1 WHERE id = $1', [rows[0].session_id]);
    return { ...rows[0], token };
  });
}

export async function finishHandoff(id: string, token: string, status: 'failed' | 'done') {
  await query(
    `WITH changed AS (
       UPDATE brainstorm_minutes SET handoff_status = $3, handoff_token = NULL
       WHERE id = $1 AND handoff_token = $2 RETURNING session_id
     )
     UPDATE brainstorm_sessions SET revision = revision + 1 WHERE id IN (SELECT session_id FROM changed)`,
    [id, token, status]
  );
}
