import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Flame,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AgentProfile,
  ChatMessageItem,
  RaceProgress,
  SelectedElementContext,
} from '../types';

const AGENT_COLORS: Record<string, { bg: string; badge: string; label: string }> = {
  mike: { bg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', badge: 'text-indigo-400', label: 'Mike · Team Lead' },
  emma: { bg: 'bg-pink-500/20 text-pink-300 border-pink-500/40', badge: 'text-pink-400', label: 'Emma · Product Manager' },
  bob: { bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', badge: 'text-emerald-400', label: 'Bob · System Architect' },
  alex: { bg: 'bg-sky-500/20 text-sky-300 border-sky-500/40', badge: 'text-sky-400', label: 'Alex · Full-Stack Engineer' },
};

interface Props {
  messages: ChatMessageItem[];
  isRunning: boolean;
  activeAgent: { agent: AgentProfile; step: string } | null;
  raceProgress: Record<'A' | 'B', RaceProgress | null>;
  selectedElement: SelectedElementContext | null;
  onClearSelectedElement: () => void;
  onSend: (prompt: string, raceMode: boolean) => void;
}

export function AgentChatPanel({
  messages,
  isRunning,
  activeAgent,
  raceProgress,
  selectedElement,
  onClearSelectedElement,
  onSend,
}: Props) {
  const [input, setInput] = useState('');
  const [raceMode, setRaceMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeAgent, raceProgress]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isRunning) return;
    setInput('');
    onSend(text, raceMode);
  }

  function insertMention(agent: string) {
    setInput((prev) => (prev.startsWith(`@${agent} `) ? prev : `@${agent} ${prev}`));
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950 border-r border-zinc-800/80">
      {/* Team Roster Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2.5 bg-zinc-950/90">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-200">AI Team</span>
          <div className="flex -space-x-1.5">
            {(['mike', 'emma', 'bob', 'alex'] as const).map((id) => (
              <span
                key={id}
                title={AGENT_COLORS[id].label}
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold uppercase ${AGENT_COLORS[id].bg}`}
              >
                {id[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(['Emma', 'Bob', 'Alex'] as const).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => insertMention(name)}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 cursor-pointer"
            >
              @{name}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isRunning && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-5 text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-indigo-400" />
            <p className="text-xs text-zinc-300 font-medium mb-1">Nucleus 虚拟团队已就绪</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              描述你想构建的应用，Mike 将自动统筹 Emma（PRD）、Bob（架构与 Cloud DB）、Alex（全栈编码）接力交付。
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-indigo-600/90 px-3.5 py-2.5 text-xs leading-relaxed text-white shadow-sm">
                  {Boolean(msg.meta?.selectedElement) && (
                    <div className="mb-1.5 inline-flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-indigo-100">
                      <Crosshair className="h-3 w-3" />
                      {(msg.meta?.selectedElement as SelectedElementContext).selector}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            );
          }

          const style = AGENT_COLORS[msg.agent_name] || AGENT_COLORS.mike;
          return (
            <div key={msg.id} className="flex gap-2.5">
              <div
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold uppercase ${style.bg}`}
              >
                {msg.agent_name[0] || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`text-[11px] font-semibold ${style.badge}`}>{style.label}</span>
                  {typeof msg.meta?.versionNumber === 'number' && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                      v{String(msg.meta.versionNumber)}
                    </span>
                  )}
                </div>
                <div className="rounded-xl rounded-tl-sm border border-zinc-800/80 bg-zinc-900/70 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {/* Active Agent Live Status */}
        {isRunning && activeAgent && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-indigo-300">
                  {activeAgent.agent.name} · {activeAgent.agent.title}
                </div>
                <div className="text-[11px] text-zinc-300 truncate">{activeAgent.step}</div>
              </div>
            </div>
          </div>
        )}

        {/* Race Mode Live Track Progress */}
        {isRunning && (raceProgress.A || raceProgress.B) && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <Flame className="h-3.5 w-3.5" />
              Race Mode 双赛道并行构建中
            </div>
            {(['A', 'B'] as const).map((t) => {
              const p = raceProgress[t];
              if (!p) return null;
              return (
                <div
                  key={t}
                  className="flex items-center justify-between rounded-lg bg-zinc-900/80 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="truncate">
                    <span className="font-medium text-zinc-200">{p.label}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-zinc-500">{p.model}</span>
                  </div>
                  {p.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400 shrink-0" />
                  ) : (
                    <span className="font-mono text-[10px] text-emerald-400 shrink-0">
                      ✓ {p.durationMs ? `${(p.durationMs / 1000).toFixed(1)}s` : 'Done'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="border-t border-zinc-800/80 p-3 bg-zinc-950">
        {selectedElement && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">
            <div className="flex items-center gap-1.5 truncate">
              <Crosshair className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
              <span className="font-mono font-semibold">{selectedElement.selector}</span>
              {selectedElement.text && (
                <span className="truncate text-indigo-300/70">“{selectedElement.text}”</span>
              )}
            </div>
            <button
              type="button"
              onClick={onClearSelectedElement}
              className="ml-2 rounded p-0.5 hover:bg-indigo-500/20 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 focus-within:border-indigo-500/70 transition">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            rows={2}
            placeholder={
              selectedElement
                ? `描述你想如何修改 ${selectedElement.selector}...`
                : '描述新需求、增量迭代，或 @Emma / @Alex 定向沟通...'
            }
            disabled={isRunning}
            className="w-full resize-none bg-transparent px-1.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none disabled:opacity-50"
          />

          <div className="mt-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setRaceMode((v) => !v)}
              title="开启后并行调用双模型生成两版界面左右 PK"
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                raceMode
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              Race Mode {raceMode ? 'ON' : ''}
            </button>

            <button
              type="submit"
              disabled={isRunning || !input.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer"
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              发送
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
