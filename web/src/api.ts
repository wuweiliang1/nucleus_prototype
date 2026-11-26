import type {
  ChatMessageItem,
  ProjectDetail,
  ProjectSummary,
  ProjectVersion,
  RuntimeErrorContext,
  SelectedElementContext,
  SseEvent,
  User,
} from './types';

const TOKEN_KEY = 'nucleus_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
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
  async getProject(id: string): Promise<{
    project: ProjectDetail;
    messages: ChatMessageItem[];
    versions: ProjectVersion[];
  }> {
    return apiFetch(`/api/projects/${id}`);
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
  async selectRaceWinner(
    projectId: string,
    sessionId: string,
    index: number
  ): Promise<{ files: Record<string, string>; currentVersion: number; winnerLabel: string }> {
    return apiFetch(`/api/projects/${projectId}/race/${sessionId}/select`, {
      method: 'POST',
      body: JSON.stringify({ index }),
    });
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
      raceMode?: boolean;
      selectedElement?: SelectedElementContext | null;
      runtimeError?: RuntimeErrorContext | null;
    },
    onEvent: (event: SseEvent) => void
  ): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`/api/projects/${projectId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Stream failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as SseEvent;
          onEvent(parsed);
        } catch {
          // ignore malformed keepalive
        }
      }
    }
  },
};
