import { AGENTS } from '../agents/types.js';
import type { ChatImage } from '../agents/images.js';

const presets = [
  { id: 'mike', name: AGENTS.mike.name, role: '统筹', brief: '厘清目标、约束和决策，比较优先级与取舍。' },
  { id: 'emma', name: AGENTS.emma.name, role: '产品需求', brief: '从用户场景、可验收需求和产品范围出发。' },
  { id: 'bob', name: AGENTS.bob.name, role: '系统架构', brief: '从架构、数据和实现成本出发，给出技术取舍。' },
  { id: 'alex', name: AGENTS.alex.name, role: '应用开发', brief: '从可操作性、界面状态和最小可行实现出发。' },
  { id: 'first-time', name: '首次使用者', role: '首次使用者', virtual: true, brief: '关注第一眼能否弄懂产品、下一步和操作反馈。' },
  { id: 'power-user', name: '重度用户', role: '重度用户', virtual: true, brief: '关注重复使用效率、批量操作和恢复路径。' },
  { id: 'buyer', name: '业务采购方', role: '业务采购方', virtual: true, brief: '关注业务价值、上线成本、维护和交接。' },
  { id: 'accessibility', name: '无障碍测评者', role: '无障碍测评者', virtual: true, brief: '关注图中可观察到的对比度、字号、信息层级和可理解性。键盘与读屏行为只有在有证据时才下判断。' },
] as const;

export const roles = new Map<string, (typeof presets)[number]>(presets.map(role => [role.id, role]));
export const participantOptions = presets.map(role => ({
  id: role.id,
  name: role.name,
  role: role.role,
  virtual: 'virtual' in role,
}));

export function selectParticipants(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 ||
      new Set(value).size !== value.length) {
    throw new BrainstormError(400, '请选择 1 至 6 位不同的参会角色');
  }
  let alias = 0;
  return value.map((id: unknown) => {
    const role = participantOptions.find(option => option.id === id);
    if (!role) throw new BrainstormError(400, '参会角色无效');
    return { ...role, name: role.virtual ? `测评者 ${String.fromCharCode(65 + alias++)}` : role.name };
  });
}

export type Participant = (typeof participantOptions)[number];
export type BrainstormMode = 'human' | 'ai';
export type Status = 'waiting' | 'running' | 'paused' | 'ready' | 'drafting' | 'review' | 'closed';

export interface Snapshot {
  title: string;
  description: string;
  version: number;
  prd: string;
  architecture: string;
}

export interface SessionRow {
  id: string;
  project_id: string;
  topic: string;
  mode: BrainstormMode;
  participants: Participant[];
  snapshot: Snapshot;
  images: ChatImage[];
  round_limit: number | null;
  round: number;
  cursor: number;
  status: Status;
  stop_requested: 'pause' | 'finish' | null;
  error: string | null;
  revision: number;
  lease_token: string | null;
  lease_until: Date | null;
  created_at: Date;
}

export interface Turn {
  id: number;
  round: number;
  participant_id: string;
  kind: 'human' | 'speak' | 'pass';
  content: string;
  images: ChatImage[];
}

export interface MinutesRow {
  id: string;
  author_id: string;
  markdown: string;
  confirmed_at: Date | null;
  handoff_status: 'running' | 'done' | 'failed' | null;
}

export class BrainstormError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
