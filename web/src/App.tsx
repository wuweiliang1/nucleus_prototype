import { useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from './api';
import { AuthModal } from './components/AuthModal';
import { LandingHub } from './components/LandingHub';
import { StudioWorkspace } from './components/StudioWorkspace';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [activeProject, setActiveProject] = useState<{
    id: string;
    initialPrompt?: { text: string; raceMode: boolean } | null;
  } | null>(null);

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

  function handleLogout() {
    setStoredToken(null);
    setUser(null);
    setActiveProject(null);
  }

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b] text-xs text-zinc-500">
        Initializing Nucleus Studio...
      </div>
    );
  }

  if (activeProject && user) {
    return (
      <StudioWorkspace
        projectId={activeProject.id}
        initialPrompt={activeProject.initialPrompt}
        onBack={() => setActiveProject(null)}
      />
    );
  }

  return (
    <>
      <LandingHub
        user={user}
        onRequireAuth={() => setShowAuth(true)}
        onLogout={handleLogout}
        onOpenProject={(id, initialPrompt) => setActiveProject({ id, initialPrompt })}
      />
      {showAuth && (
        <AuthModal
          onSuccess={(u) => {
            setUser(u);
            setShowAuth(false);
          }}
          onClose={() => setShowAuth(false)}
        />
      )}
    </>
  );
}
