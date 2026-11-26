import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { parseChatImages } from '../agents/images.js';
import { requireAuth } from '../auth.js';
import { startRoomWork } from '../brainstorm/runner.js';
import { changeRoom, createRoom, listMinutes, listRooms, recoverRoom, roomDetail, type RoomAction } from '../brainstorm/store.js';
import { BrainstormError, participantOptions, selectParticipants } from '../brainstorm/types.js';
import { query } from '../db.js';

export const brainstormRouter = Router({ mergeParams: true });
brainstormRouter.use(requireAuth);
brainstormRouter.use(async (req, res, next) => {
  try {
    const owned = await query('SELECT 1 FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    if (!owned.rowCount) {
      res.status(404).json({ error: '项目不存在' });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  } catch {
    res.status(503).json({ error: '暂时无法访问会议，请重试' });
  }
});

function endpoint(run: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    void run(req, res).catch(error => {
      if (error instanceof BrainstormError) {
        res.status(error.status).json({ error: error.message });
      } else {
        console.error('[BrainStorm] request failed', error instanceof Error ? error.name : 'Error');
        res.status(500).json({ error: '会议操作未完成，请重试' });
      }
    });
  };
}

function text(value: unknown, limit: number, label: string, required = false) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if ((required && !clean) || clean.length > limit) {
    throw new BrainstormError(400, `${label}${required && !clean ? '不能为空' : `最多 ${limit} 字`}`);
  }
  return clean;
}

function inputs(value: unknown) {
  try { return parseChatImages(value); }
  catch (error) {
    throw new BrainstormError(400, error instanceof Error ? error.message : '图片格式无效');
  }
}

function natural(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number < 2147483647 ? number : 0;
}

brainstormRouter.get('/', endpoint(async (req, res) => {
  res.json({ rooms: await listRooms(String(req.params.id)), participants: participantOptions });
}));

brainstormRouter.get('/minutes', endpoint(async (req, res) => {
  res.json({ minutes: await listMinutes(String(req.params.id)) });
}));

brainstormRouter.post('/', endpoint(async (req, res) => {
  const projectId = String(req.params.id);
  const { mode } = req.body ?? {};
  if (mode !== 'human' && mode !== 'ai') throw new BrainstormError(400, '请选择会议模式');
  const roundLimit = mode === 'ai' ? (req.body.roundLimit ?? 3) : null;
  if (roundLimit !== null && (!Number.isInteger(roundLimit) || roundLimit < 1 || roundLimit > 5)) {
    throw new BrainstormError(400, 'AI 圆桌支持 1 至 5 轮');
  }
  const id: unknown = req.body.requestId ?? crypto.randomUUID();
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new BrainstormError(400, '会议请求 ID 无效');
  }
  const topic = text(req.body.topic, 4000, '议题', true);
  const participants = selectParticipants(req.body.participants);
  const images = inputs(req.body.images);
  const { rows: [project] } = await query<{
    title: string; description: string; current_version: number; prd_md: string; architecture_md: string;
  }>('SELECT title, description, current_version, prd_md, architecture_md FROM projects WHERE id = $1', [projectId]);
  if (!project) throw new BrainstormError(404, '项目不存在');
  const { room, token } = await createRoom(projectId, {
    id, topic, mode, roundLimit, participants, images,
    snapshot: {
      title: project.title, description: project.description, version: project.current_version,
      prd: project.prd_md.slice(0, 12000), architecture: project.architecture_md.slice(0, 12000),
    },
  });
  if (token) startRoomWork(room.id, token);
  res.status(token ? 201 : 200).json({ id: room.id });
}));

brainstormRouter.get('/:sessionId', endpoint(async (req, res) => {
  res.json(await roomDetail(
    String(req.params.id), String(req.params.sessionId), natural(req.query.after), req.query.incremental !== '1'
  ));
}));

function parseAction(body: Request['body']): RoomAction {
  switch (body?.type) {
    case 'next':
      return {
        type: 'next', expectedRound: natural(body.expectedRound),
        text: text(body.text, 4000, '发言'), images: inputs(body.images),
      };
    case 'draft': return { type: 'draft', author: text(body.author, 60, '执笔人', true) };
    case 'save': return { type: 'save', markdown: text(body.markdown, 20000, '纪要', true) };
    case 'resume':
    case 'pause':
    case 'finish':
    case 'return':
      return { type: body.type };
    default:
      throw new BrainstormError(400, '未知的会议操作');
  }
}

brainstormRouter.post('/:sessionId/actions', endpoint(async (req, res) => {
  const id = String(req.params.sessionId);
  const { token, author } = await changeRoom(String(req.params.id), id, parseAction(req.body));
  if (token) startRoomWork(id, token, author);
  res.json({ ok: true });
}));

brainstormRouter.get('/:sessionId/events', endpoint(async (req, res) => {
  const project = String(req.params.id);
  const id = String(req.params.sessionId);
  const readState = () => query<{ revision: number; expired: boolean }>(
    'SELECT revision, lease_until < NOW() AS expired FROM brainstorm_sessions WHERE project_id = $1 AND id = $2',
    [project, id]
  );
  const { rows: [current] } = await readState();
  if (!current) throw new BrainstormError(404, '会议不存在');
  if (res.destroyed) return;
  let revision = natural(req.query.since);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let lastWrite = Date.now();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.on('close', () => { closed = true; clearTimeout(timer); });

  function update(state: { revision: number }) {
    if (closed) return;
    if (state.revision !== revision) {
      revision = state.revision;
      res.write(`data: ${JSON.stringify({ type: 'changed', revision })}\n\n`);
      lastWrite = Date.now();
    } else if (Date.now() - lastWrite >= 8000) {
      res.write(': keepalive\n\n');
      lastWrite = Date.now();
    }
  }

  async function poll() {
    if (closed || res.destroyed) return;
    try {
      let { rows: [state] } = await readState();
      if (state?.expired) {
        await recoverRoom(project, id);
        ({ rows: [state] } = await readState());
      }
      if (!state) { res.end(); return; }
      update(state);
      if (!closed) timer = setTimeout(() => void poll(), 1200);
    } catch {
      if (!closed) res.end();
    }
  }
  update(current);
  timer = setTimeout(() => void poll(), 1200);
}));
