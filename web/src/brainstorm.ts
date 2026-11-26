import type { ChatImage } from './types';

export interface BrainstormParticipant {
  id: string;
  name: string;
  role: string;
  virtual: boolean;
}

export type BrainstormMode = 'human' | 'ai';
export type BrainstormStatus = 'waiting' | 'running' | 'paused' | 'ready' | 'drafting' | 'review' | 'closed';

export interface BrainstormBrief {
  id: string;
  topic: string;
  mode: BrainstormMode;
  status: BrainstormStatus;
  round: number;
  round_limit: number | null;
  created_at: string;
}

export interface BrainstormRoom extends BrainstormBrief {
  participants: BrainstormParticipant[];
  base_version: number;
  cursor: number;
  images?: ChatImage[];
  stop_requested: 'pause' | 'finish' | null;
  error: string | null;
  revision: number;
}

export interface BrainstormTurn {
  id: number;
  round: number;
  participant_id: string;
  kind: 'human' | 'speak' | 'pass';
  content: string;
  images: ChatImage[];
}

export interface BrainstormMinutes {
  id: string;
  author_id: string;
  markdown: string;
  confirmed_at: string | null;
  handoff_status: 'running' | 'done' | 'failed' | null;
}

export interface ArchivedMinutes extends BrainstormMinutes {
  session_id: string;
  topic: string;
  author_name: string | null;
  base_version: number;
}

export interface BrainstormDetail {
  room: BrainstormRoom;
  turns: BrainstormTurn[];
  minutes: BrainstormMinutes | null;
}

export type BrainstormAction =
  | { type: 'next'; expectedRound: number; text?: string; images?: ChatImage[] }
  | { type: 'resume' | 'pause' | 'finish' | 'return' }
  | { type: 'draft'; author: string }
  | { type: 'save'; markdown: string };

export function downloadMinutes(id: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `会议纪要-${id}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
