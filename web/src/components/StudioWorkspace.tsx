import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Atom,
  Code2,
  Download,
  Eye,
  FileText,
  Globe,
  History,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api';
import type {
  AgentProfile,
  ChatMessageItem,
  ProjectDetail,
  ProjectVersion,
  RaceCandidate,
  RaceProgress,
  RuntimeErrorContext,
  SelectedElementContext,
} from '../types';
import { AgentChatPanel } from './AgentChatPanel';
import { BlueprintPane } from './BlueprintPane';
import { CodeExplorer } from './CodeExplorer';
import { PreviewPane } from './PreviewPane';
import { PublishModal } from './PublishModal';

interface Props {
  projectId: string;
  initialPrompt?: { text: string; raceMode: boolean } | null;
  onBack: () => void;
}

export function StudioWorkspace({ projectId, initialPrompt, onBack }: Props) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [rightTab, setRightTab] = useState<'preview' | 'code' | 'blueprint'>('preview');
  const [isRunning, setIsRunning] = useState(false);
  const [activeAgent, setActiveAgent] = useState<{ agent: AgentProfile; step: string } | null>(null);
  const [raceProgress, setRaceProgress] = useState<Record<'A' | 'B', RaceProgress | null>>({
    A: null,
    B: null,
  });
  const [raceSession, setRaceSession] = useState<{
    sessionId: string;
    candidates: RaceCandidate[];
  } | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedElementContext | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const initialTriggeredRef = useRef(false);

  const loadProject = useCallback(async () => {
    const data = await api.getProject(projectId);
    setProject(data.project);
    setMessages(data.messages);
    setVersions(data.versions);
  }, [projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const handleSend = useCallback(
    async (
      promptText: string,
      raceMode: boolean,
      overrideError?: RuntimeErrorContext | null
    ) => {
      if (isRunning) return;
      const elementCtx = overrideError ? null : selectedElement;
      setSelectedElement(null);
      setIsRunning(true);
      setActiveAgent(null);
      setRaceProgress({ A: null, B: null });
      if (raceMode) setRightTab('preview');

      // Optimistic user message
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          agent_name: 'user',
          agent_title: 'User',
          content: promptText,
          meta: elementCtx ? { selectedElement: elementCtx } : {},
        },
      ]);

      try {
        await api.streamChat(
          projectId,
          {
            prompt: promptText,
            raceMode,
            selectedElement: elementCtx,
            runtimeError: overrideError || null,
          },
          (ev) => {
            if (ev.type === 'agent_start') {
              setActiveAgent({ agent: ev.agent, step: ev.step });
            } else if (ev.type === 'agent_message') {
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  agent_name: ev.agent.id,
                  agent_title: ev.agent.title,
                  content: ev.content,
                  meta: ev.meta,
                },
              ]);
            } else if (ev.type === 'artifact_update') {
              setProject((prev) =>
                prev
                  ? {
                      ...prev,
                      prd_md: ev.prdMd ?? prev.prd_md,
                      architecture_md: ev.architectureMd ?? prev.architecture_md,
                      schema_json: ev.schemaJson ?? prev.schema_json,
                    }
                  : prev
              );
            } else if (ev.type === 'files_update') {
              setProject((prev) =>
                prev
                  ? {
                      ...prev,
                      files: ev.files,
                      current_version: ev.versionNumber,
                    }
                  : prev
              );
              setRightTab('preview');
            } else if (ev.type === 'race_progress') {
              setRaceProgress((prev) => ({ ...prev, [ev.track]: ev }));
            } else if (ev.type === 'race_ready') {
              setRaceSession({ sessionId: ev.sessionId, candidates: ev.candidates });
              setRightTab('preview');
            } else if (ev.type === 'error') {
              setMessages((prev) => [
                ...prev,
                {
                  id: `err-${Date.now()}`,
                  role: 'assistant',
                  agent_name: 'mike',
                  agent_title: 'Team Lead',
                  content: `执行遇到异常：${ev.message}`,
                },
              ]);
            }
          }
        );
        await loadProject();
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            agent_name: 'mike',
            agent_title: 'Team Lead',
            content: `请求失败：${err instanceof Error ? err.message : '未知错误'}`,
          },
        ]);
      } finally {
        setIsRunning(false);
        setActiveAgent(null);
      }
    },
    [isRunning, projectId, selectedElement, loadProject]
  );

  // Trigger initial prompt when arriving from LandingHub
  useEffect(() => {
    if (project && initialPrompt && !initialTriggeredRef.current && messages.length === 0) {
      initialTriggeredRef.current = true;
      handleSend(initialPrompt.text, initialPrompt.raceMode);
    }
  }, [project, initialPrompt, messages.length, handleSend]);

  async function handleSaveFiles(files: Record<string, string>) {
    const res = await api.saveFiles(projectId, files);
    setProject((prev) => (prev ? { ...prev, files, current_version: res.currentVersion } : prev));
    await loadProject();
  }

  async function handleRollback(versionNumber: number) {
    const res = await api.rollback(projectId, versionNumber);
    setProject((prev) =>
      prev ? { ...prev, files: res.files, current_version: res.currentVersion } : prev
    );
    setShowHistory(false);
    await loadProject();
  }

  async function handleSelectRaceWinner(index: number) {
    if (!raceSession) return;
    const res = await api.selectRaceWinner(projectId, raceSession.sessionId, index);
    setProject((prev) =>
      prev ? { ...prev, files: res.files, current_version: res.currentVersion } : prev
    );
    setRaceSession(null);
    await loadProject();
  }

  return (
    <div className="flex h-screen flex-col bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Top Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-800/90 bg-zinc-950 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="flex shrink-0 whitespace-nowrap items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            工作台
          </button>
          <div className="h-4 w-px shrink-0 bg-zinc-800" />
          <div className="flex items-center gap-2 min-w-0">
            <Atom className="h-4 w-4 text-indigo-400 shrink-0" />
            <span className="truncate max-w-[160px] text-sm font-semibold text-white">
              {project?.title || '加载中...'}
            </span>
            {project && project.current_version > 0 && (
              <span className="shrink-0 rounded-md bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                v{project.current_version}
              </span>
            )}
          </div>
        </div>

        {/* Center Tabs */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
          <button
            onClick={() => setRightTab('preview')}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'preview' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
          <button
            onClick={() => setRightTab('code')}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'code' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            Code
          </button>
          <button
            onClick={() => setRightTab('blueprint')}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'blueprint' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            PRD & DB
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex whitespace-nowrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              <History className="h-3.5 w-3.5" />
              版本 ({versions.length})
            </button>
            {showHistory && (
              <div className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
                <div className="px-2 py-1.5 text-[11px] font-semibold text-zinc-400">
                  版本快照（点击一键回滚）
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {versions.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-zinc-500">暂无版本记录</div>
                  ) : (
                    versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => handleRollback(v.version_number)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs hover:bg-zinc-900 cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium text-zinc-200 truncate">
                            v{v.version_number} · {v.summary}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {new Date(v.created_at).toLocaleString()}
                          </div>
                        </div>
                        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => project && api.downloadExportZip(project.id, project.title)}
            disabled={!project || Object.keys(project.files || {}).length === 0}
            className="flex whitespace-nowrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            导出 ZIP
          </button>

          <button
            onClick={() => setShowPublish(true)}
            disabled={!project || Object.keys(project.files || {}).length === 0}
            className="flex whitespace-nowrap items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" />
            {project?.published_slug ? '已发布' : '发布上线'}
          </button>
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Multi-Agent Chat */}
        <div className="w-[380px] lg:w-[410px] shrink-0 h-full">
          <AgentChatPanel
            messages={messages}
            isRunning={isRunning}
            activeAgent={activeAgent}
            raceProgress={raceProgress}
            selectedElement={selectedElement}
            onClearSelectedElement={() => setSelectedElement(null)}
            onSend={(text, race) => handleSend(text, race)}
          />
        </div>

        {/* Right: Workspace View */}
        <div className="flex-1 min-w-0 h-full">
          {rightTab === 'preview' && (
            <PreviewPane
              projectId={projectId}
              files={project?.files || {}}
              raceSession={raceSession}
              onSelectRaceWinner={handleSelectRaceWinner}
              onDismissRace={() => setRaceSession(null)}
              onElementSelected={(el) => setSelectedElement(el)}
              onAutoFixError={(err) =>
                handleSend(`请修复预览中出现的运行时错误：${err.message}`, false, err)
              }
            />
          )}
          {rightTab === 'code' && (
            <CodeExplorer files={project?.files || {}} onSaveFiles={handleSaveFiles} />
          )}
          {rightTab === 'blueprint' && (
            <BlueprintPane
              projectId={projectId}
              prdMd={project?.prd_md || ''}
              architectureMd={project?.architecture_md || ''}
              schemaJson={project?.schema_json || []}
            />
          )}
        </div>
      </div>

      {showPublish && project && (
        <PublishModal
          projectId={project.id}
          currentSlug={project.published_slug}
          onPublished={(slug) =>
            setProject((prev) => (prev ? { ...prev, published_slug: slug, is_public: true } : prev))
          }
          onClose={() => setShowPublish(false)}
        />
      )}
    </div>
  );
}
