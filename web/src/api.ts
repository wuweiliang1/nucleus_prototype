import type {
  ChatImage,
  ChatMessageItem,
  ProjectDetail,
  ProjectSummary,
  ProjectVersion,
  RuntimeErrorContext,
  SelectedElementContext,
  SseEvent,
  User,
} from './types';
import type { ArchivedMinutes, BrainstormAction, BrainstormBrief, BrainstormDetail, BrainstormMode, BrainstormParticipant } from './brainstorm';

const TOKEN_KEY = 'nucleus_auth_token';

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiRequestError(data.error || `Request failed (${res.status})`, res.status);
  }
  return res;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

async function streamEvents<T>(
  path: string, init: RequestInit, onEvent: (event: T) => boolean | void, onActivity?: () => void,
) {
  const res = await request(path, init);
  if (!res.body) throw new Error('服务器没有返回事件流');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (data && onEvent(JSON.parse(data.slice(6)) as T)) return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class ChatStreamInterruptedError extends Error {
  constructor() {
    super('执行连接已中断，请重新打开项目查看最近保存的结果。');
  }
}

export const api = {
  // Auth
  async me(): Promise<{ user: User }> {
    return apiFetch('/api/auth/me');
  },
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(data.token);
    return data;
  },
  async register(name: string, email: string, password: string): Promise<{ token: string; user: User }> {
    const data = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    setStoredToken(data.token);
    return data;
  },
  async guestLogin(): Promise<{ token: string; user: User }> {
    const data = await apiFetch<{ token: string; user: User }>('/api/auth/guest', {
      method: 'POST',
    });
    setStoredToken(data.token);
    return data;
  },

  // Projects
  async listProjects(): Promise<{ projects: ProjectSummary[] }> {
    return apiFetch('/api/projects');
  },
  async listShowcase(): Promise<{ projects: ProjectSummary[] }> {
    return apiFetch('/api/projects/public/showcase');
  },
  async createProject(title: string, description = ''): Promise<{ project: ProjectDetail }> {
    return apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    });
  },
  async getProject(id: string, signal?: AbortSignal): Promise<{
    project: ProjectDetail;
    messages: ChatMessageItem[];
    versions: ProjectVersion[];
  }> {
    return apiFetch(`/api/projects/${id}`, { signal });
  },
  async deleteProject(id: string): Promise<void> {
    await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
  },
  async remixProject(id: string): Promise<{ projectId: string }> {
    return apiFetch(`/api/projects/${id}/remix`, { method: 'POST' });
  },
  async saveFiles(id: string, files: Record<string, string>): Promise<{ currentVersion: number }> {
    return apiFetch(`/api/projects/${id}/files`, {
      method: 'PUT',
      body: JSON.stringify({ files }),
    });
  },
  async rollback(id: string, versionNumber: number): Promise<{ files: Record<string, string>; currentVersion: number }> {
    return apiFetch(`/api/projects/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ versionNumber }),
    });
  },
  async publishProject(id: string, slug?: string): Promise<{ slug: string; url: string }> {
    return apiFetch(`/api/projects/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ slug }),
    });
  },
  async buildPreviewBundle(
    id: string,
    files: Record<string, string>,
    enableInspector = true
  ): Promise<{ html: string }> {
    return apiFetch(`/api/projects/${id}/preview-bundle`, {
      method: 'POST',
      body: JSON.stringify({ files, enableInspector }),
    });
  },
  listBrainstorms(projectId: string, signal?: AbortSignal): Promise<{ rooms: BrainstormBrief[]; participants: BrainstormParticipant[] }> {
    return apiFetch(`/api/projects/${projectId}/brainstorms`, { signal });
  },
  createBrainstorm(projectId: string, data: {
    requestId: string; mode: BrainstormMode; topic: string; participants: string[]; roundLimit: number; images: ChatImage[];
  }): Promise<{ id: string }> {
    return apiFetch(`/api/projects/${projectId}/brainstorms`, { method: 'POST', body: JSON.stringify(data) });
  },
  getBrainstorm(projectId: string, sessionId: string, after?: number, signal?: AbortSignal): Promise<BrainstormDetail> {
    const suffix = after === undefined ? '' : `?after=${after}&incremental=1`;
    return apiFetch(`/api/projects/${projectId}/brainstorms/${sessionId}${suffix}`, { signal });
  },
  brainstormAction(projectId: string, sessionId: string, action: BrainstormAction): Promise<{ ok: true }> {
    return apiFetch(`/api/projects/${projectId}/brainstorms/${sessionId}/actions`, {
      method: 'POST', body: JSON.stringify(action),
    });
  },
  watchBrainstorm(projectId: string, sessionId: string, since: number, signal: AbortSignal, onChange: () => void) {
    return streamEvents<{ type: 'changed' }>(
      `/api/projects/${projectId}/brainstorms/${sessionId}/events?since=${since}`, { signal }, onChange
    );
  },
  listBrainstormMinutes(projectId: string, signal?: AbortSignal): Promise<{ minutes: ArchivedMinutes[] }> {
    return apiFetch(`/api/projects/${projectId}/brainstorms/minutes`, { signal });
  },
  async inspectCloudData(projectId: string): Promise<{
    collections: Record<string, Array<Record<string, unknown>>>;
    totalRows: number;
  }> {
    return apiFetch(`/api/runtime/${projectId}/inspect`);
  },
  async downloadExportZip(projectId: string, title: string): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`/api/projects/${projectId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'nucleus-app'}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // SSE Multi-Agent chat
  async streamChat(
    projectId: string,
    payload: {
      prompt: string;
      images?: ChatImage[];
      selectedElement?: SelectedElementContext | null;
      runtimeError?: RuntimeErrorContext | null;
      brainstormMinutesId?: string;
    },
    onEvent: (event: SseEvent) => void
  ): Promise<void> {
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 40_000);
    }

    let reachedTerminalEvent = false;
    resetIdleTimer();
    try {
      await streamEvents<SseEvent>(
        `/api/projects/${projectId}/chat`, { method: 'POST', body: JSON.stringify(payload), signal: controller.signal },
        event => {
          reachedTerminalEvent = event.type === 'done' || event.type === 'error';
          onEvent(event);
          return reachedTerminalEvent;
        }, resetIdleTimer,
      );
      if (!reachedTerminalEvent) throw new ChatStreamInterruptedError();
    } catch (error) {
      if (controller.signal.aborted || error instanceof TypeError || error instanceof DOMException) {
        throw new ChatStreamInterruptedError();
      }
      throw error;
    } finally {
      clearTimeout(idleTimer);
    }
  },
};
