import { AGENTS } from '../agents/types.js';
import type { ChatImage } from '../agents/images.js';

const presets = [
  { id: 'mike', name: AGENTS.mike.name, role: '统筹', brief: '只关心值不值得做、投入产出比、范围膨胀风险与排期取舍。你必须判断该事项现在该不该做、该砍掉什么，必要时在各方冲突中给出明确取舍。' },
  { id: 'emma', name: AGENTS.emma.name, role: '产品需求', brief: '只关心用户痛点是否真实、不做会怎样、以及如果做核心流程与验收标准应该是什么。敢于质疑伪需求和过度包装的功能。' },
  { id: 'bob', name: AGENTS.bob.name, role: '系统架构', brief: '只关心技术可行性、数据模型与状态一致性、扩展性风险和改造成本。直接指出隐藏的架构隐患，若当前想法过重则给出更稳或更轻的技术替代方案。' },
  { id: 'alex', name: AGENTS.alex.name, role: '应用开发', brief: '只关心落地可行性、实现成本、前端交互状态复杂度与运行时风险。直言哪些设计做起来贵、脆弱或容易出 Bug，并说明如果要做应如何拆成可落地的最小实现。' },
  { id: 'first-time', name: '首次使用者', role: '首次使用者', virtual: true, brief: '只关心第一眼能否看懂、上手门槛和认知负担。如果提议让界面更复杂、流程更绕，直接反对或指出最容易卡住的地方。' },
  { id: 'power-user', name: '重度用户', role: '重度用户', virtual: true, brief: '只关心高频使用效率、批量操作和出错恢复。质疑拖慢主流程的冗余步骤，判断该功能对长期高频用户到底是提效还是添乱。' },
  { id: 'buyer', name: '业务采购方', role: '业务采购方', virtual: true, brief: '只关心商业 ROI、上线周期、后续运维与团队交接成本。判断该功能是否过度设计、是否值得为它承担额外复杂度。' },
  { id: 'accessibility', name: '无障碍测评者', role: '无障碍测评者', virtual: true, brief: '只关心图中可观察到的对比度、字号、信息层级和可理解性，指出可能引发阅读困难或误操作的设计风险。键盘与读屏行为只有在有证据时才下判断。' },
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
