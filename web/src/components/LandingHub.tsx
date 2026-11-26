import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Atom,
  ExternalLink,
  Flame,
  FolderKanban,
  GitFork,
  LogOut,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import type { ProjectSummary, User } from '../types';

const TEMPLATES = [
  {
    title: '全栈团队看板 (Kanban)',
    tag: 'Cloud DB',
    prompt:
      '构建一个现代线性风格的团队任务看板应用，支持 Todo / In Progress / Done 三列拖拽或状态切换、优先级标签、搜索筛选、新增和编辑任务，并通过 NucleusDB 实现云端持久化。',
  },
  {
    title: '个人极简记账与预算分析',
    tag: '数据可视化',
    prompt:
      '构建一个高颜值的个人收支记账本，支持记录收入和支出分类、月度预算进度条、按分类统计的 SVG 可视化图表和明细列表，所有账单通过 NucleusDB 持久化存储。',
  },
  {
    title: '实时团队匿名投票与想法墙',
    tag: '多人协作',
    prompt:
      '构建一个产品需求投票与想法墙应用，用户可以提交新点子、按热度排序、点击点赞投票、按标签筛选，所有数据实时保存在 NucleusDB 云端。',
  },
  {
    title: '番茄钟与习惯打卡追踪器',
    tag: '效率工具',
    prompt:
      '构建一个极客风番茄工作法计时器 + 每日习惯打卡追踪器，支持 25 分钟专注倒计时、自定义习惯列表、每日打卡状态记录和连续打卡统计，数据持久化到 NucleusDB。',
  },
];

interface Props {
  user: User | null;
  onRequireAuth: () => void;
  onLogout: () => void;
  onOpenProject: (projectId: string, initialPrompt?: { text: string; raceMode: boolean }) => void;
}

export function LandingHub({ user, onRequireAuth, onLogout, onOpenProject }: Props) {
  const [prompt, setPrompt] = useState('');
  const [raceMode, setRaceMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [myProjects, setMyProjects] = useState<ProjectSummary[]>([]);
  const [showcase, setShowcase] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    api.listShowcase().then((r) => setShowcase(r.projects)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      api.listProjects().then((r) => setMyProjects(r.projects)).catch(() => {});
    } else {
      setMyProjects([]);
    }
  }, [user]);

  async function handleStart(textToRun?: string) {
    const finalPrompt = (textToRun ?? prompt).trim();
    if (!finalPrompt) return;
    if (!user) {
      onRequireAuth();
      return;
    }
    setCreating(true);
    try {
      const title = finalPrompt.slice(0, 22);
      const res = await api.createProject(title, finalPrompt.slice(0, 140));
      onOpenProject(res.project.id, { text: finalPrompt, raceMode });
    } finally {
      setCreating(false);
    }
  }

  async function handleRemix(id: string) {
    if (!user) {
      onRequireAuth();
      return;
    }
    const res = await api.remixProject(id);
    onOpenProject(res.projectId);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.deleteProject(id);
    setMyProjects((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="min-h-screen nucleus-grid-bg text-zinc-100">
      {/* Top Navbar */}
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-lg shadow-indigo-500/25">
            <Atom className="h-4.5 w-4.5" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">Nucleus</span>
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
            AI-Native Studio
          </span>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>{user.name}</span>
              </div>
              <button
                onClick={onLogout}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出
              </button>
            </>
          ) : (
            <button
              onClick={onRequireAuth}
              className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 cursor-pointer"
            >
              登录 / 访客体验
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="mx-auto max-w-5xl px-6 pt-12 pb-20">
        <div className="text-center mb-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3.5 py-1 text-xs text-zinc-300">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>Mike · Emma · Bob · Alex 多智能体协作 + 生产级 PostgreSQL Cloud</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-4">
            从一句话想法到
            <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              {' '}可运行的云端全栈应用
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-zinc-400 leading-relaxed">
            不只是静态原型：Nucleus 调度虚拟研发团队自动产出 PRD、系统架构与多文件代码，内置实时点选编辑、双模型 Race Mode 赛马对比，以及开箱即用的云端数据库与一键发布。
          </p>
        </div>

        {/* Main Prompt Box */}
        <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/90 p-3 shadow-2xl shadow-indigo-950/30">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleStart();
              }
            }}
            rows={3}
            placeholder="描述你想构建的应用，例如：帮我做一个带云端数据持久化的团队任务看板，支持搜索、优先级和统计面板..."
            className="w-full resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5 px-1">
            <button
              type="button"
              onClick={() => setRaceMode((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
                raceMode
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              Race Mode（双方案并行 PK）{raceMode ? '· 已开启' : ''}
            </button>

            <button
              onClick={() => handleStart()}
              disabled={creating || !prompt.trim()}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-40 cursor-pointer"
            >
              {creating ? '初始化工作台...' : '启动 AI 团队构建'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Starter Templates */}
        <div className="mx-auto mt-6 max-w-3xl">
          <div className="mb-2.5 text-xs font-medium text-zinc-500">或者直接试一个精选模板：</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.title}
                onClick={() => {
                  setPrompt(tpl.prompt);
                  handleStart(tpl.prompt);
                }}
                className="group flex flex-col rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3.5 text-left hover:border-indigo-500/50 hover:bg-zinc-900/70 transition cursor-pointer"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200 group-hover:text-white">
                    {tpl.title}
                  </span>
                  <span className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-[10px] text-indigo-300">
                    {tpl.tag}
                  </span>
                </div>
                <p className="line-clamp-2 text-[11px] text-zinc-500 leading-relaxed">
                  {tpl.prompt}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* My Projects */}
        {user && myProjects.length > 0 && (
          <section className="mt-14">
            <div className="mb-4 flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">我的工作台项目 ({myProjects.length})</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {myProjects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => onOpenProject(proj.id)}
                  className="group relative flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-4 hover:border-indigo-500/50 transition cursor-pointer"
                >
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold text-zinc-100 group-hover:text-white">
                        {proj.title}
                      </h3>
                      <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                        v{proj.current_version}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-zinc-500">
                      {proj.description || '点击进入 Studio 继续与 AI 团队协作'}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-2.5 text-[11px] text-zinc-500">
                    <span>{new Date(proj.updated_at).toLocaleDateString()}</span>
                    <div className="flex items-center gap-2">
                      {proj.published_slug && (
                        <a
                          href={`/p/${proj.published_slug}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-emerald-400 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          已发布
                        </a>
                      )}
                      <button
                        onClick={(e) => handleDelete(proj.id, e)}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400 cursor-pointer"
                        title="删除项目"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Public Showcase */}
        {showcase.length > 0 && (
          <section className="mt-14">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">社区已发布应用（支持一键 Remix）</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {showcase.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-white truncate mb-1">{item.title}</h3>
                    <p className="line-clamp-2 text-xs text-zinc-500 mb-3">
                      {item.description || '由 Nucleus Multi-Agent 构建'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t border-zinc-800/60 pt-2.5 text-xs">
                    <span className="text-[11px] text-zinc-500">by {item.author_name || 'Builder'}</span>
                    <div className="flex items-center gap-2">
                      {item.published_slug && (
                        <a
                          href={`/p/${item.published_slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900"
                        >
                          <ExternalLink className="h-3 w-3" />
                          体验
                        </a>
                      )}
                      <button
                        onClick={() => handleRemix(item.id)}
                        className="flex items-center gap-1 rounded-md bg-indigo-600/20 border border-indigo-500/30 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-600/30 cursor-pointer"
                      >
                        <GitFork className="h-3 w-3" />
                        Remix
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
