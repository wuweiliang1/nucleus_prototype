export type WorkspaceView = 'preview' | 'code' | 'blueprint' | 'brainstorm';

export interface WorkspaceLocation {
  projectId: string;
  view: WorkspaceView;
  meetingId: string | null;
}

export function readWorkspaceLocation({ pathname, search }: Pick<Location, 'pathname' | 'search'>): WorkspaceLocation | null {
  const match = /^\/studio\/([a-z0-9_-]+)\/?$/i.exec(pathname);
  if (!match) return null;

  const params = new URLSearchParams(search);
  const view = params.get('view');
  const meeting = params.get('meeting');
  return {
    projectId: match[1],
    view: view === 'code' || view === 'blueprint' || view === 'brainstorm' ? view : 'preview',
    meetingId: meeting && /^[a-z0-9_-]+$/i.test(meeting) ? meeting : null,
  };
}

export function workspaceUrl(workspace: WorkspaceLocation | null): string {
  if (!workspace) return '/';

  const params = new URLSearchParams();
  if (workspace.view !== 'preview') params.set('view', workspace.view);
  if (workspace.meetingId) params.set('meeting', workspace.meetingId);
  const query = params.toString();
  return `/studio/${encodeURIComponent(workspace.projectId)}${query ? `?${query}` : ''}`;
}
