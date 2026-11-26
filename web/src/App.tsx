import { useEffect, useRef, useState } from 'react';
import { api, getStoredToken, setStoredToken } from './api';
import { AuthModal } from './components/AuthModal';
import { LandingHub } from './components/LandingHub';
import { StudioWorkspace } from './components/StudioWorkspace';
import type { ChatDraft, User } from './types';
import { readWorkspaceLocation, workspaceUrl, type WorkspaceLocation } from './workspaceLocation';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [workspace, setWorkspace] = useState(() => readWorkspaceLocation(window.location));
  const pendingPrompt = useRef<{ projectId: string; draft: ChatDraft } | null>(null);

  useEffect(() => {
    function syncLocation() {
      const next = readWorkspaceLocation(window.location);
      if (pendingPrompt.current?.projectId !== next?.projectId) pendingPrompt.current = null;
      setWorkspace(next);
    }
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setStoredToken(null))
      .finally(() => setAuthChecked(true));
  }, []);

  function navigate(next: WorkspaceLocation | null, replace = false) {
    const url = workspaceUrl(next);
    if (url === window.location.pathname + window.location.search) return;
    if (pendingPrompt.current?.projectId !== next?.projectId) pendingPrompt.current = null;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setWorkspace(next);
  }

  function openProject(projectId: string, draft?: ChatDraft) {
    pendingPrompt.current = draft ? { projectId, draft } : null;
    navigate({ projectId, view: 'preview', meetingId: null });
  }

  function handleLogout() {
    setStoredToken(null);
    setUser(null);
    pendingPrompt.current = null;
    navigate(null, true);
  }

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b] text-xs text-zinc-500">
        Initializing Nucleus Studio...
      </div>
    );
  }

  if (workspace && user) {
    return (
      <StudioWorkspace
        key={workspace.projectId}
        projectId={workspace.projectId}
        view={workspace.view}
        meetingId={workspace.meetingId}
        initialPrompt={pendingPrompt.current?.projectId === workspace.projectId ? pendingPrompt.current.draft : undefined}
        onUseInitialPrompt={() => { pendingPrompt.current = null; }}
        onWorkspaceChange={(changes, replace) => {
          const current = readWorkspaceLocation(window.location);
          if (current?.projectId === workspace.projectId) navigate({ ...current, ...changes }, replace);
        }}
        onBack={() => navigate(null)}
      />
    );
  }

  return (
    <>
      <LandingHub
        user={user}
        onRequireAuth={() => setShowAuth(true)}
        onLogout={handleLogout}
        onOpenProject={openProject}
      />
      {(showAuth || workspace) && (
        <AuthModal
          onSuccess={(u) => {
            setUser(u);
            setShowAuth(false);
          }}
          onClose={() => {
            setShowAuth(false);
            if (workspace) navigate(null, true);
          }}
        />
      )}
    </>
  );
}
