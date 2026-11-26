export interface User {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  current_version: number;
  published_slug: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  author_name?: string;
}

export interface SchemaCollection {
  name: string;
  description: string;
  fields: Array<{ name: string; type: string; description: string }>;
}

export interface ProjectDetail extends ProjectSummary {
  prd_md: string;
  architecture_md: string;
  schema_json: SchemaCollection[];
  files: Record<string, string>;
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  agent_name: string;
  agent_title: string;
  content: string;
  meta?: Record<string, unknown>;
  created_at?: string;
}

export interface ProjectVersion {
  id: string;
  version_number: number;
  summary: string;
  agent_name: string;
  created_at: string;
}

export interface SelectedElementContext {
  selector: string;
  tagName: string;
  text: string;
  snippet: string;
}

export interface RuntimeErrorContext {
  message: string;
  stack?: string;
}

export interface AgentProfile {
  id: 'mike' | 'emma' | 'bob' | 'alex';
  name: string;
  title: string;
  color: string;
  avatar: string;
}

export interface RaceCandidate {
  id: string;
  label: string;
  model: string;
  styleDirection: string;
  summary: string;
  files: Record<string, string>;
  durationMs: number;
}

export interface RaceProgress {
  track: 'A' | 'B';
  status: 'running' | 'done' | 'error';
  label: string;
  model: string;
  durationMs?: number;
  error?: string;
}

export type SseEvent =
  | { type: 'agent_start'; agent: AgentProfile; step: string }
  | { type: 'agent_message'; agent: AgentProfile; content: string; meta?: Record<string, unknown> }
  | { type: 'artifact_update'; prdMd?: string; architectureMd?: string; schemaJson?: SchemaCollection[] }
  | { type: 'files_update'; files: Record<string, string>; versionNumber: number; summary: string }
  | ({ type: 'race_progress' } & RaceProgress)
  | { type: 'race_ready'; sessionId: string; candidates: RaceCandidate[] }
  | { type: 'done'; projectId: string }
  | { type: 'error'; message: string };
