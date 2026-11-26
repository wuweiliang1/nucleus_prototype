import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ChatImage } from '../agents/images.js';
import { jsonObject } from '../agents/outputs.js';
import { inTransaction, query } from '../db.js';
import { callLlm, userMessage } from '../llm.js';
import { LEASE_TIME } from './store.js';
import { roles, type SessionRow, type Turn } from './types.js';

const activeLease = 'id = $1 AND lease_token = $2 AND lease_until >= NOW()';

async function release(client: PoolClient, room: SessionRow, status: 'paused' | 'waiting' | 'ready' | 'review') {
  await client.query(
    `UPDATE brainstorm_sessions SET status = $2, stop_requested = NULL, lease_token = NULL, lease_until = NULL,
      revision = revision + 1, updated_at = NOW() WHERE id = $1`, [room.id, status]
  );
}

async function nextSeat(id: string, token: string) {
  return inTransaction(async client => {
    const { rows: [room] } = await client.query<SessionRow>(
      `SELECT * FROM brainstorm_sessions WHERE ${activeLease} AND status = 'running' FOR UPDATE`, [id, token]
    );
    if (!room) return null;
    if (room.stop_requested) {
      await release(client, room, room.stop_requested === 'finish' ? 'ready' : 'paused');
      return null;
    }
    if (room.cursor < room.participants.length) return room;
    if (room.mode === 'human') {
      await release(client, room, 'waiting');
      return null;
    }
    const spoken = await client.query(
      "SELECT 1 FROM brainstorm_turns WHERE session_id = $1 AND round = $2 AND kind = 'speak' LIMIT 1",
      [id, room.round]
    );
    if (room.round >= (room.round_limit ?? 3) || !spoken.rowCount) {
      await release(client, room, 'ready');
      return null;
    }
    const advanced = await client.query<SessionRow>(
      `UPDATE brainstorm_sessions SET round = round + 1, cursor = 0,
        revision = revision + 1, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]
    );
    return advanced.rows[0];
  });
}

async function meetingContext(room: SessionRow, fullTranscript: boolean) {
  const results = await Promise.all([
    query<Pick<Turn, 'round' | 'participant_id' | 'kind' | 'content'>>(
      `SELECT round, participant_id, kind, content FROM brainstorm_turns WHERE session_id = $1 AND kind <> 'pass'
       ORDER BY id DESC ${fullTranscript ? 'LIMIT 161' : 'LIMIT 24'}`, [room.id]
    ),
    query<{ images: ChatImage[] }>(
      "SELECT images FROM brainstorm_turns WHERE session_id = $1 AND images <> '[]'::jsonb ORDER BY id DESC LIMIT 1", [room.id]
    ),
  ]);
  const displayNames = new Map<string, string>(room.participants.map(person => [person.id, person.name]));
  const transcript = results[0].rows.slice(0, 160).reverse().map(turn => ({
    round: turn.round, speaker: turn.kind === 'human' ? '项目所有者' : displayNames.get(turn.participant_id),
    text: turn.content,
  }));
  const images = results[1].rows[0]?.images ?? room.images;
  return userMessage(JSON.stringify({
    topic: room.topic,
    projectAtStart: room.snapshot,
    round: room.round,
    participants: room.participants.map(({ name, role, virtual }) => ({ name, role, virtual })),
    transcript,
    ...(fullTranscript && results[0].rows.length > 160 && { earlierTurnsOmitted: true }),
    screenshotCount: images.length,
  }), images);
}

function parseTurn(raw: string): { kind: 'speak' | 'pass'; content: string } {
  const value = jsonObject(raw);
  if (value.action === 'pass') return { kind: 'pass', content: '' };
  if (value.action !== 'speak' || typeof value.content !== 'string' || !value.content.trim()) {
    throw new Error('测评角色未返回有效的发言或跳过结果');
  }
  return { kind: 'speak', content: value.content.trim().slice(0, 1600) };
}

async function runDiscussion(id: string, token: string) {
  while (true) {
    const room = await nextSeat(id, token);
    if (!room) return;
    const member = room.participants[room.cursor];
    const brief = roles.get(member.id)?.brief ?? '';
    const { value } = await callLlm([
      {
        role: 'system',
        content: `你是 Nucleus BrainStorm 会议中的 ${member.name}（${member.role}）。${brief}
你正在讨论产品，不执行代码修改、外部访问或项目发布。读议题和此前发言，提供一条能推进讨论的新意见，可以具体回应其他发言。
重复或缺乏有用信息时选择跳过。虚拟测评判断是角色模拟，不能声称做过真实测试或代表真实用户。
图片存在时只针对可观察证据，图片缺失时不得声称看到了界面。用议题的语言简洁回应。
只输出 JSON。发言格式 {"action":"speak","content":"具体意见"}，跳过格式 {"action":"pass"}。`,
      },
      await meetingContext(room, false),
    ], { stage: member.name, temperature: 0.45, maxTokens: 850, jsonMode: true }, parseTurn);

    const recorded = await inTransaction(async client => {
      const updated = await client.query(
        `UPDATE brainstorm_sessions SET cursor = cursor + 1, revision = revision + 1, updated_at = NOW()
         WHERE ${activeLease} AND status = 'running' AND round = $3 AND cursor = $4`,
        [id, token, room.round, room.cursor]
      );
      if (!updated.rowCount) return false;
      await client.query(
        'INSERT INTO brainstorm_turns (session_id, round, participant_id, kind, content) VALUES ($1, $2, $3, $4, $5)',
        [id, room.round, member.id, value.kind, value.content]
      );
      return true;
    });
    if (!recorded) return;
  }
}

async function draftMinutes(id: string, token: string, author: string) {
  const { rows: [room] } = await query<SessionRow>(
    `SELECT * FROM brainstorm_sessions WHERE ${activeLease} AND status = 'drafting'`, [id, token]
  );
  if (!room) return;
  const member = room.participants.find(person => person.id === author);
  if (!member) throw new Error('执笔人不在会议中');
  const { value } = await callLlm([
    {
      role: 'system',
      content: `你是会议执笔人 ${member.name}（${member.role}）。基于这场 BrainStorm 的材料草拟纪要，使用议题语言。
区分已确认结论、主要分歧、待验证问题和后续行动。用户明确确认过的内容才是已确认结论；建议、AI 共识和未验证的判断要如实标识。
行动项记录讨论过的执行目标、责任人或验收条件，没有明确的信息留待确认。不要发明数据、真实用户访谈或决策。
若 earlierTurnsOmitted 为真，在纪要末尾注明较早的部分发言未纳入本次摘要。
只输出 JSON {"markdown":"# 会议纪要\\n\\n## 议题\\n…\\n## 已确认结论\\n…\\n## 主要分歧\\n…\\n## 待验证问题\\n…\\n## 后续行动\\n…"}。`,
    },
    await meetingContext(room, true),
  ], { stage: `${member.name} · 纪要`, temperature: 0.25, maxTokens: 2600, jsonMode: true }, raw => {
    const { markdown } = jsonObject(raw);
    if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('模型未生成有效的纪要');
    return markdown.trim().slice(0, 20000);
  });

  await inTransaction(async client => {
    const locked = await client.query(`SELECT 1 FROM brainstorm_sessions WHERE ${activeLease} AND status = 'drafting' FOR UPDATE`, [id, token]);
    if (!locked.rowCount) return;
    await client.query(
      'INSERT INTO brainstorm_minutes (id, session_id, author_id, markdown) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), id, author, value]
    );
    await release(client, room, 'review');
  });
}

export function startRoomWork(id: string, token: string, author?: string) {
  const heartbeat = setInterval(() => {
    void query(`UPDATE brainstorm_sessions SET lease_until = NOW() + ${LEASE_TIME} WHERE ${activeLease}`, [id, token])
      .catch(error => console.warn('[BrainStorm] lease renewal failed', id, error instanceof Error ? error.name : 'Error'));
  }, 15000);
  heartbeat.unref();

  const work = author ? draftMinutes(id, token, author) : runDiscussion(id, token);
  void work.catch(async error => {
    console.warn('[BrainStorm] execution failed', id, author ? 'minutes' : 'discussion', error instanceof Error ? error.name : 'Error');
    await query(
      `UPDATE brainstorm_sessions SET status = CASE WHEN status = 'drafting' OR stop_requested = 'finish' THEN 'ready' ELSE 'paused' END,
       error = $3, stop_requested = NULL, lease_token = NULL, lease_until = NULL, revision = revision + 1, updated_at = NOW()
       WHERE ${activeLease}`, [id, token, author ? '纪要未能生成，可以重新起草。' : '当前发言未完成，请继续讨论以重试这个席位。']
    ).catch(() => {});
  }).finally(() => clearInterval(heartbeat));
}
