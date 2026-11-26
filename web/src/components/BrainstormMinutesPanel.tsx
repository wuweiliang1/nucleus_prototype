import { useEffect, useState } from 'react';
import { api } from '../api';
import { downloadMinutes, type ArchivedMinutes } from '../brainstorm';
import './BrainstormPane.css';

interface Props {
  projectId: string;
  onOpenRoom: (id: string) => void;
  onHandoff: (id: string, topic: string) => void;
  handoffDisabled: boolean;
}

export function BrainstormMinutesPanel({ projectId, onOpenRoom, onHandoff, handoffDisabled }: Props) {
  const [minutes, setMinutes] = useState<ArchivedMinutes[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setMinutes(null);
    setError('');
    api.listBrainstormMinutes(projectId, controller.signal).then(({ minutes }) => {
      if (!controller.signal.aborted) setMinutes(minutes);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '无法读取会议纪要');
    });
    return () => controller.abort();
  }, [projectId]);

  return <section className="meeting-archive" aria-label="会议纪要归档">
    {error ? <p className="meeting-error" role="alert">{error}</p>
      : minutes === null ? <p role="status">正在读取会议纪要…</p>
      : minutes.length === 0 ? <p>已确认的纪要会显示在这里。</p> : null}
    {minutes?.map(note => <article key={note.id}>
      <h3>{note.topic}</h3>
      <p>{note.author_name ?? '参会者'} · 项目 v{note.base_version}
        {note.confirmed_at && ` · ${new Date(note.confirmed_at).toLocaleString('zh-CN')}`}
      </p>
      <details>
        <summary className="cursor-pointer py-2 text-sm">查看纪要</summary>
        <pre>{note.markdown}</pre>
      </details>
      <div className="meeting-controls">
        <button type="button" className="meeting-button" onClick={() => onOpenRoom(note.session_id)}>打开会议</button>
        <button type="button" className="meeting-button" onClick={() => downloadMinutes(note.id, note.markdown)}>下载 Markdown</button>
        <button type="button" className="meeting-button primary"
          disabled={handoffDisabled || note.handoff_status === 'running' || note.handoff_status === 'done'}
          onClick={() => onHandoff(note.id, note.topic)}>
          {note.handoff_status === 'done' ? '已交给 Mike' : note.handoff_status === 'running' ? '交接中…' : '交给 Mike'}
        </button>
      </div>
    </article>)}
  </section>;
}
