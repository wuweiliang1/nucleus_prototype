import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, FileText, MessageSquare, MessagesSquare, Plus, UsersRound } from 'lucide-react';
import { api, ApiRequestError } from '../api';
import {
  downloadMinutes, type BrainstormAction, type BrainstormBrief, type BrainstormDetail,
  type BrainstormMode, type BrainstormParticipant,
} from '../brainstorm';
import type { ChatDraft, ChatImage } from '../types';
import { PromptComposer } from './PromptComposer';
import './BrainstormPane.css';

const emptyDraft: ChatDraft = { text: '', images: [] };
const stateLabels = {
  waiting: '等你接话', running: '讨论中', paused: '已暂停', ready: '讨论结束',
  drafting: '正在起草', review: '待确认纪要', closed: '已归档',
};
const modeLabels = { human: '人类参会', ai: 'AI 圆桌' };

function imageStrip(images: ChatImage[] = []) {
  if (!images.length) return null;
  return <div className="meeting-images">{images.map((image, index) => (
    <img key={`${image.name}-${index}`} src={image.dataUrl} alt={image.name} loading="lazy" />
  ))}</div>;
}

interface Props {
  projectId: string;
  sessionId: string | null;
  onSelect: (id: string | null) => void;
  onHandoff: (id: string, topic: string) => void;
  handoffDisabled: boolean;
}

export function BrainstormPane({ projectId, sessionId, onSelect, onHandoff, handoffDisabled }: Props) {
  const [rooms, setRooms] = useState<BrainstormBrief[]>([]);
  const [options, setOptions] = useState<BrainstormParticipant[]>([]);
  const [detail, setDetail] = useState<BrainstormDetail | null>(null);
  const [mode, setMode] = useState<BrainstormMode>('human');
  const [roundLimit, setRoundLimit] = useState(3);
  const [selection, setSelection] = useState<string[]>(['mike', 'emma', 'alex']);
  const [setup, setSetup] = useState<ChatDraft>(emptyDraft);
  const [reply, setReply] = useState<ChatDraft>(emptyDraft);
  const [author, setAuthor] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [connectionLost, setConnectionLost] = useState(false);
  const [missingSessionId, setMissingSessionId] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const requestId = useRef('');
  const locked = useRef(false);
  const refresh = useRef<(() => void) | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const room = detail?.room.id === sessionId ? detail.room : null;
  const minutes = room ? detail?.minutes : null;
  const authorId = room?.participants.some(person => person.id === author)
    ? author : room?.participants.find(person => person.id === 'mike')?.id ?? room?.participants[0]?.id ?? '';

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    api.listBrainstorms(projectId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setRooms(result.rooms);
      setOptions(result.participants);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法读取会议列表');
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false);
    });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    setDetail(null);
    setAuthor('');
    setReply(emptyDraft);
    setError('');
    setConnectionLost(false);
    setMissingSessionId(null);
    if (!sessionId) {
      refresh.current = null;
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let current: BrainstormDetail | null = null;
    let fetching = false;
    let dirty = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      dirty = true;
      if (fetching || signal.aborted) return;
      fetching = true;
      try {
        while (dirty && !signal.aborted) {
          dirty = false;
          const after = current?.turns.at(-1)?.id ?? (current ? 0 : undefined);
          const update = await api.getBrainstorm(projectId, sessionId!, after, signal);
          if (signal.aborted) return;
          current = current ? {
            room: { ...current.room, ...update.room },
            turns: [...current.turns, ...update.turns],
            minutes: update.minutes,
          } : update;
          setDetail(current);
          setConnectionLost(false);
          const summary = update.room;
          setRooms(previous => {
            const index = previous.findIndex(entry => entry.id === summary.id);
            return index === -1 ? [summary, ...previous] : previous.map(entry => entry.id === summary.id ? summary : entry);
          });
        }
      } catch (error) {
        if (!signal.aborted) {
          if (error instanceof ApiRequestError && error.status === 404) {
            setMissingSessionId(sessionId);
            controller.abort();
            return;
          }
          setConnectionLost(true);
          clearTimeout(retry);
          retry = setTimeout(() => void load(), 2000);
        }
      } finally {
        fetching = false;
      }
    }

    let reconnect: ReturnType<typeof setTimeout> | undefined;
    async function watch() {
      await load();
      if (signal.aborted) return;
      await api.watchBrainstorm(projectId, sessionId!, current?.room.revision ?? 0, signal, () => void load()).catch(() => {});
      if (signal.aborted) return;
      setConnectionLost(true);
      reconnect = setTimeout(() => void watch(), 2000);
    }
    refresh.current = () => void load();
    void watch();
    return () => {
      controller.abort();
      clearTimeout(retry);
      clearTimeout(reconnect);
      refresh.current = null;
    };
  }, [projectId, sessionId]);

  useEffect(() => setMarkdown(minutes?.markdown ?? ''), [minutes?.id, minutes?.markdown]);
  useEffect(() => {
    const log = transcript.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [detail?.turns.length, sessionId]);

  async function operate(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try { await work(); }
    catch (err) { setError(err instanceof Error ? err.message : '操作未完成，请重试'); }
    finally { locked.current = false; setPending(false); }
  }

  function start(draft: ChatDraft) {
    if (!draft.text || !selection.length) { setError('请输入议题并选择参会者'); return; }
    void operate(async () => {
      requestId.current ||= crypto.randomUUID();
      const result = await api.createBrainstorm(projectId, {
        requestId: requestId.current, mode, roundLimit, topic: draft.text, images: draft.images, participants: selection,
      });
      requestId.current = '';
      setSetup(emptyDraft);
      onSelect(result.id);
    });
  }

  function command(action: BrainstormAction, clearReply = false) {
    if (!sessionId) return;
    void operate(async () => {
      await api.brainstormAction(projectId, sessionId, action);
      if (clearReply) setReply(emptyDraft);
      refresh.current?.();
    });
  }

  const canDraft = room && ['waiting', 'paused', 'ready'].includes(room.status);
  const isRunning = room?.status === 'running';
  const currentSpeaker = isRunning && room.participants[room.cursor];
  const ModeIcon = mode === 'human' ? UsersRound : MessagesSquare;

  return (
    <div className="meeting-workspace">
      <aside className="meeting-history">
        <div className="meeting-list-title">
          <h2>BrainStorm</h2>
          <button className="meeting-button" type="button" disabled={pending} onClick={() => onSelect(null)}><Plus size={15} />新建会议</button>
        </div>
        <h3>历史会议</h3>
        {listLoading ? <p>正在读取会议…</p> : rooms.length === 0 ? <p>还没有会议</p> : null}
        <ul>
          {rooms.map(item => (
            <li key={item.id}>
              <button type="button" aria-current={sessionId === item.id ? 'true' : undefined}
                disabled={pending} onClick={() => onSelect(item.id)}>
                <strong>{item.topic}</strong>
                <span>{modeLabels[item.mode]} · {stateLabels[item.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {!sessionId ? (
        <section className="meeting-setup">
          <div className="meeting-heading"><h2>新建 BrainStorm</h2><p>选择参会者，围绕一个议题收集意见或评审界面。</p></div>
          <div className="meeting-people-label"><h3>参会角色</h3><span>已选 {selection.length}/6 · 按选择顺序发言</span></div>
          <div className="meeting-people">
            {options.map(person => (
              <label key={person.id}>
                <input type="checkbox" checked={selection.includes(person.id)} disabled={pending || (selection.length === 6 && !selection.includes(person.id))}
                  onChange={event => {
                    const checked = event.target.checked;
                    setSelection(previous => checked ? [...previous, person.id] : previous.filter(id => id !== person.id));
                  }} />
                <strong>{person.name}</strong>
                <span>{person.virtual ? '虚拟测评' : person.role}</span>
              </label>
            ))}
          </div>
          <h3>议题与参考图</h3>
          <div className="meeting-composer">
            <PromptComposer draft={setup} setDraft={setSetup} onSend={start} variant="brainstorm"
              ariaLabel="会议议题" placeholder="例如，上传首页截图，让首次使用者指出第一步哪里不清楚"
              disabled={pending || options.length === 0}
              footerTools={<>
                <label className="meeting-option meeting-mode" title="会议模式">
                  <ModeIcon className="meeting-mode-icon" size={14} aria-hidden="true" />
                  <select aria-label="会议模式" value={mode} disabled={pending}
                    onChange={event => setMode(event.target.value === 'ai' ? 'ai' : 'human')}>
                    <option value="human">{modeLabels.human}</option>
                    <option value="ai">{modeLabels.ai}</option>
                  </select>
                  <ChevronDown className="meeting-option-chevron" size={12} aria-hidden="true" />
                </label>
                {mode === 'ai' && <label className="meeting-option" title="轮数">
                  <select aria-label="轮数" value={roundLimit} disabled={pending}
                    onChange={event => setRoundLimit(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} 轮</option>)}
                  </select>
                  <ChevronDown className="meeting-option-chevron" size={12} aria-hidden="true" />
                </label>}
              </>}
              renderSubmit={disabled => <button className="meeting-button primary" type="submit"
                disabled={disabled || !setup.text.trim() || !selection.length}>开始讨论 <ArrowRight size={16} aria-hidden="true" /></button>} />
          </div>
          {error && <p className="meeting-error" role="alert">{error}</p>}
        </section>
      ) : sessionId === missingSessionId ? (
        <div className="meeting-loading"><p role="alert">这场会议不存在或无法访问。</p></div>
      ) : !room || !detail ? (
        <div className="meeting-loading" role="status">{connectionLost ? '正在重新连接会议…' : '正在读取会议…'}</div>
      ) : (
        <section className="meeting-room">
          <header className="meeting-room-header">
            <div>
              <p>{modeLabels[room.mode]} · 第 {room.round}{room.mode === 'ai' ? ` / ${room.round_limit}` : ''} 轮 · 项目 v{room.base_version}</p>
              <h2>{room.topic}</h2>
            </div>
            <span className="meeting-status" role="status">
              {connectionLost ? '正在重连' : room.stop_requested ? '当前发言结束后停止' : stateLabels[room.status]}
            </span>
          </header>
          <div className="meeting-room-body">
            <div className="meeting-thread" ref={transcript}>
              {!!room.images?.length && <div className="meeting-evidence"><span>议题参考图</span>{imageStrip(room.images)}</div>}
              {detail.turns.map((turn, index) => {
                const participant = room.participants.find(person => person.id === turn.participant_id);
                const name = turn.kind === 'human' ? '你' : participant?.name ?? '参会者';
                return <div key={turn.id} className={`meeting-turn${turn.kind === 'human' ? ' human-turn' : ''}`}>
                  {(index === 0 || detail.turns[index - 1].round !== turn.round) && (
                    <div className="meeting-round-label">第 {turn.round} 轮</div>
                  )}
                  {turn.kind === 'pass' ? <p className="meeting-pass">{name} 跳过发言</p> : (
                    <article>
                      <header>{name}{participant?.virtual && <span>虚拟测评</span>}</header>
                      <div>{turn.content}</div>
                      {imageStrip(turn.images)}
                    </article>
                  )}
                </div>;
              })}
              {currentSpeaker && <p className="meeting-speaking" role="status"><MessageSquare size={15} />{currentSpeaker.name} 正在思考</p>}
              {room.status === 'drafting' && <p className="meeting-speaking" role="status"><FileText size={15} />正在起草会议纪要</p>}
            </div>
            <aside className="meeting-attendees">
              <h3><UsersRound size={16} />参会者</h3>
              {room.mode === 'human' && <div><strong>你</strong><span>项目所有者</span></div>}
              {room.participants.map(person => <div key={person.id}>
                <strong>{person.name}</strong><span>{person.virtual ? `虚拟测评 · ${person.role}` : person.role}</span>
              </div>)}
            </aside>
          </div>
          <div className="meeting-actions">
            {(error || room.error) && <p className="meeting-error" role="alert">{error || room.error}</p>}
            {room.status === 'waiting' && room.mode === 'human' && (
              <div className="meeting-composer">
                <PromptComposer draft={reply} setDraft={setReply} variant="brainstorm" ariaLabel="会议发言"
                  placeholder="补充意见，或上传下一轮要看的截图" disabled={pending}
                  onSend={draft => command({ type: 'next', expectedRound: room.round, text: draft.text, images: draft.images }, true)}
                  renderSubmit={disabled => <button className="meeting-button primary" type="submit" disabled={disabled}>发言并开启下一轮</button>} />
              </div>
            )}
            {room.status === 'review' && minutes && (
              <div className="meeting-minutes-editor">
                <label htmlFor="meeting-minutes">会议纪要草稿</label>
                <textarea id="meeting-minutes" value={markdown} maxLength={20000} rows={7} onChange={event => setMarkdown(event.target.value)} />
                <div className="meeting-controls">
                  <button type="button" className="meeting-button" disabled={pending} onClick={() => command({ type: 'return' })}>返回讨论</button>
                  <button type="button" className="meeting-button primary" disabled={pending || !markdown.trim()}
                    onClick={() => command({ type: 'save', markdown })}>确认保存纪要</button>
                </div>
              </div>
            )}
            {room.status === 'closed' && minutes && (
              <div className="meeting-minutes-editor">
                <h3>会议纪要</h3>
                <pre>{minutes.markdown}</pre>
                <div className="meeting-controls">
                  <button type="button" className="meeting-button" onClick={() => downloadMinutes(minutes.id, minutes.markdown)}>下载 Markdown</button>
                  <button type="button" className="meeting-button primary"
                    disabled={handoffDisabled || minutes.handoff_status === 'done' || minutes.handoff_status === 'running'}
                    onClick={() => onHandoff(minutes.id, room.topic)}>
                    {minutes.handoff_status === 'done' ? '已交给 Mike' : minutes.handoff_status === 'running' ? '交接中…' : '交给 Mike'}
                  </button>
                </div>
              </div>
            )}
            <div className="meeting-controls">
              {isRunning && (
                <>
                  <button type="button" className="meeting-button" disabled={pending || !!room.stop_requested}
                    onClick={() => command({ type: 'pause' })}>暂停</button>
                  <button type="button" className="meeting-button" disabled={pending || room.stop_requested === 'finish'}
                    onClick={() => command({ type: 'finish' })}>结束讨论</button>
                </>
              )}
              {room.status === 'paused' && <button type="button" className="meeting-button" disabled={pending}
                onClick={() => command({ type: 'resume' })}>继续讨论</button>}
              {((room.status === 'waiting' && room.mode === 'human') || (room.status === 'ready' && room.mode === 'ai' && room.round < 5)) && (
                <button type="button" className="meeting-button" disabled={pending}
                  onClick={() => command({ type: 'next', expectedRound: room.round })}>
                  {room.mode === 'ai' ? '再讨论一轮' : '下一轮'}
                </button>
              )}
              {canDraft && (
                <div className="meeting-draft-controls">
                  <label>执笔人<select aria-label="执笔人" value={authorId} onChange={event => setAuthor(event.target.value)}>
                    {room.participants.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
                  </select></label>
                  <button type="button" className="meeting-button" disabled={pending || !authorId}
                    onClick={() => command({ type: 'draft', author: authorId })}>起草纪要</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
