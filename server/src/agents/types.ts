export type AgentId = 'mike' | 'emma' | 'bob' | 'alex';

export interface AgentProfile {
  id: AgentId;
  name: string;
  title: string;
  color: string;
  avatar: string;
}

export const AGENTS: Record<AgentId, AgentProfile> = {
  mike: {
    id: 'mike',
    name: 'Mike',
    title: 'Team Lead',
    color: '#818cf8',
    avatar: 'M',
  },
  emma: {
    id: 'emma',
    name: 'Emma',
    title: 'Product Manager',
    color: '#f472b6',
    avatar: 'E',
  },
  bob: {
    id: 'bob',
    name: 'Bob',
    title: 'System Architect',
    color: '#34d399',
    avatar: 'B',
  },
  alex: {
    id: 'alex',
    name: 'Alex',
    title: 'Full-Stack Engineer',
    color: '#38bdf8',
    avatar: 'A',
  },
};

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

export interface OrchestrateInput {
  projectId: string;
  userPrompt: string;
  existingFiles: Record<string, string>;
  existingPrd: string;
  existingArchitecture: string;
  selectedElement?: SelectedElementContext | null;
  runtimeError?: RuntimeErrorContext | null;
}

export interface SchemaCollection {
  name: string;
  description: string;
  fields: Array<{ name: string; type: string; description: string }>;
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

export type SseEvent =
  | { type: 'agent_start'; agent: AgentProfile; step: string }
  | { type: 'agent_message'; agent: AgentProfile; content: string; meta?: Record<string, unknown> }
  | { type: 'artifact_update'; prdMd?: string; architectureMd?: string; schemaJson?: SchemaCollection[] }
  | { type: 'files_update'; files: Record<string, string>; versionNumber: number; summary: string }
  | { type: 'race_progress'; track: 'A' | 'B'; status: 'running' | 'done' | 'error'; label: string; model: string; durationMs?: number; error?: string }
  | { type: 'race_ready'; sessionId: string; candidates: RaceCandidate[] }
  | { type: 'done'; projectId: string }
  | { type: 'error'; message: string };
