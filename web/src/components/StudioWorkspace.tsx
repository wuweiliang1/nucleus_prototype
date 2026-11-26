import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Code2,
  Download,
  Eye,
  FileText,
  Globe,
  History,
  MessagesSquare,
  RotateCcw,
} from 'lucide-react';
import { api, ChatStreamInterruptedError } from '../api';
import type { WorkspaceLocation, WorkspaceView } from '../workspaceLocation';
import type {
  AgentProfile,
  ChatDraft,
  ChatMessageItem,
  ProjectDetail,
  ProjectVersion,
  RuntimeErrorContext,
  SelectedElementContext,
} from '../types';
import { AgentChatPanel } from './AgentChatPanel';
import { BlueprintPane } from './BlueprintPane';
import { BrainstormPane } from './BrainstormPane';
import { CodeExplorer } from './CodeExplorer';
import { PreviewPane } from './PreviewPane';
import { NucleusMark } from './NucleusMark';
import { PublishModal } from './PublishModal';

interface Props {
  projectId: string;
  view: WorkspaceView;
  meetingId: string | null;
  initialPrompt?: ChatDraft | null;
  onUseInitialPrompt: () => void;
  onWorkspaceChange: (changes: Partial<Pick<WorkspaceLocation, 'view' | 'meetingId'>>, replace?: boolean) => void;
  onBack: () => void;
}

export function StudioWorkspace({ projectId, view: rightTab, meetingId, initialPrompt, onUseInitialPrompt, onWorkspaceChange, onBack }: Props) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [activeAgent, setActiveAgent] = useState<{ agent: AgentProfile; step: string } | null>(null);
  const [selectedElement, setSelectedElement] = useState<SelectedElementContext | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const initialTriggeredRef = useRef(false);
  const mountedRef = useRef(false);

  const loadProject = useCallback(async (signal?: AbortSignal) => {
    const data = await api.getProject(projectId, signal);
    if (signal?.aborted) return;
    setProject(data.project);
    setMessages(data.messages);
    setVersions(data.versions);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    mountedRef.current = true;
    void loadProject(controller.signal).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [loadProject, loadAttempt]);

  const handleSend = useCallback(
    async (
      { text: promptText, images }: ChatDraft,
      options?: { runtimeError?: RuntimeErrorContext; skipSelection?: boolean; brainstormMinutesId?: string }
    ) => {
      if (isRunning) return;
      const runtimeError = options?.runtimeError ?? null;
      const elementCtx = runtimeError || options?.skipSelection ? null : selectedElement;
      setSelectedElement(null);
      setIsRunning(true);
      setActiveAgent(null);

      // Optimistic user message
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: 'user',
          agent_name: 'user',
          agent_title: 'User',
          content: promptText,
          meta: {
            ...(elementCtx && { selectedElement: elementCtx }),
            ...(images.length > 0 && { images }),
          },
        },
      ]);

      let respondingAgent: AgentProfile | undefined;
      try {
        await api.streamChat(
          projectId,
          {
            prompt: promptText,
            images,
            selectedElement: elementCtx,
            runtimeError,
            brainstormMinutesId: options?.brainstormMinutesId,
          },
          (ev) => {
            if (!mountedRef.current) return;
            if (ev.type === 'agent_start') {
              respondingAgent = ev.agent;
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
              onWorkspaceChange({ view: 'preview' }, true);
            } else if (ev.type === 'error') {
              setMessages((prev) => [
                ...prev,
                {
                  id: `err-${Date.now()}`,
                  role: 'assistant',
                  agent_name: ev.agent?.id ?? 'mike',
                  agent_title: ev.agent?.title ?? 'Team Lead',
                  content: `执行遇到异常：${ev.message}`,
                },
              ]);
            }
          }
        );
        if (mountedRef.current) await loadProject();
      } catch (err) {
        if (!mountedRef.current) return;
        const synced = err instanceof ChatStreamInterruptedError &&
          await loadProject(AbortSignal.timeout(8000)).then(() => true, () => false);
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            agent_name: respondingAgent?.id ?? 'mike',
            agent_title: respondingAgent?.title ?? 'Team Lead',
            content: synced
              ? '执行连接已中断，已重新读取最近保存的结果。请检查版本后再重试。'
              : `请求失败：${err instanceof Error ? err.message : '未知错误'}`,
          },
        ]);
      } finally {
        setIsRunning(false);
        setActiveAgent(null);
      }
    },
    [isRunning, projectId, selectedElement, loadProject, onWorkspaceChange]
  );

  function openBrainstorm(id: string) {
    onWorkspaceChange({ view: 'brainstorm', meetingId: id });
  }

  function handoffMinutes(id: string, topic: string) {
    if (isRunning) return;
    onWorkspaceChange({ view: 'preview' });
    void handleSend({ text: `@Mike 请根据已确认的 BrainStorm 纪要「${topic}」推进已定事项。`, images: [] },
      { skipSelection: true, brainstormMinutesId: id });
  }

  // Trigger initial prompt when arriving from LandingHub
  useEffect(() => {
    if (project && initialPrompt && !initialTriggeredRef.current && messages.length === 0) {
      initialTriggeredRef.current = true;
      onUseInitialPrompt();
      handleSend(initialPrompt);
    }
  }, [project, initialPrompt, messages.length, handleSend, onUseInitialPrompt]);

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

  if (loadError) {
    return (
      <main className="grid h-screen place-content-center gap-3 bg-[#09090b] p-5 text-zinc-100">
        <p role="alert" className="text-sm">无法打开工作区。请确认链接有效，且当前账号有权访问。</p>
        <div className="flex gap-2 text-xs">
          <button type="button" className="rounded-lg border border-zinc-700 px-3 py-2" onClick={onBack}>返回工作台</button>
          <button type="button" className="rounded-lg bg-zinc-800 px-3 py-2" onClick={() => {
            setLoadError(false);
            setLoadAttempt(attempt => attempt + 1);
          }}>重新加载</button>
        </div>
      </main>
    );
  }

  if (!project) {
    return <main role="status" className="grid h-screen place-content-center bg-[#09090b] text-sm text-zinc-400">正在加载工作区…</main>;
  }

  return (
    <div className="flex h-screen flex-col bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Top Bar */}
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800/90 bg-zinc-950 px-3 py-1 lg:flex-nowrap">
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
            <NucleusMark />
            <span className="truncate max-w-[90px] text-sm font-semibold text-white sm:max-w-[160px]">
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
        <div className="order-last flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-zinc-900 p-0.5 border border-zinc-800 lg:order-none lg:w-auto lg:shrink-0">
          <button
            aria-pressed={rightTab === 'preview'}
            onClick={() => onWorkspaceChange({ view: 'preview' })}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'preview' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
          <button
            aria-pressed={rightTab === 'code'}
            onClick={() => onWorkspaceChange({ view: 'code' })}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'code' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            Code
          </button>
          <button
            aria-pressed={rightTab === 'blueprint'}
            onClick={() => onWorkspaceChange({ view: 'blueprint' })}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              rightTab === 'blueprint' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            PRD & DB
          </button>
          <button
            aria-pressed={rightTab === 'brainstorm'}
            onClick={() => onWorkspaceChange({ view: 'brainstorm' })}
            className={`flex whitespace-nowrap items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer ${
              rightTab === 'brainstorm' ? 'bg-lime-400/10 text-lime-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            BrainStorm
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowHistory((v) => !v)}
              aria-label={`版本 (${versions.length})`}
              className="flex whitespace-nowrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">版本 ({versions.length})</span>
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
            aria-label="导出 ZIP"
            disabled={!project || Object.keys(project.files || {}).length === 0}
            className="flex whitespace-nowrap items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导出 ZIP</span>
          </button>

          <button
            onClick={() => setShowPublish(true)}
            aria-label={project?.published_slug ? '已发布' : '发布上线'}
            disabled={!project || Object.keys(project.files || {}).length === 0}
            className="flex whitespace-nowrap items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{project?.published_slug ? '已发布' : '发布上线'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Body */}
      {rightTab === 'brainstorm' ? (
        <BrainstormPane projectId={projectId} sessionId={meetingId} onSelect={id => onWorkspaceChange({ meetingId: id })}
          onHandoff={handoffMinutes} handoffDisabled={isRunning} />
      ) : <div className="flex flex-1 min-h-0">
        {/* Left: Multi-Agent Chat */}
        <div className="w-[380px] lg:w-[410px] shrink-0 h-full">
          <AgentChatPanel
            messages={messages}
            isRunning={isRunning}
            activeAgent={activeAgent}
            selectedElement={selectedElement}
            onClearSelectedElement={() => setSelectedElement(null)}
            onSend={handleSend}
            onOpenBrainstorm={openBrainstorm}
            onContinueFromPrd={(summary) => handleSend({
              text: `@Mike 请基于已保存的 PRD 实现最近补充的需求，并复用现有架构和代码。最近的 PRD 更新摘要：${summary}`,
              images: [],
            }, { skipSelection: true })}
          />
        </div>

        {/* Right: Workspace View */}
        <div className="flex-1 min-w-0 h-full">
          {rightTab === 'preview' && (
            <PreviewPane
              projectId={projectId}
              files={project?.files || {}}
              onElementSelected={(el) => setSelectedElement(el)}
              onAutoFixError={(err) =>
                handleSend({ text: `请修复预览中出现的运行时错误：${err.message}`, images: [] }, { runtimeError: err })
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
              onOpenBrainstorm={openBrainstorm}
              onHandoff={handoffMinutes}
              handoffDisabled={isRunning}
            />
          )}
        </div>
      </div>}

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
