import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ChartNoAxesColumn,
  ExternalLink,
  GitFork,
  LayoutGrid,
  LogOut,
  Timer,
  Trash2,
  Wallet,
} from 'lucide-react';
import { WORKSPACE_AGENTS } from '../agents';
import { api } from '../api';
import type { ChatDraft, ProjectSummary, User } from '../types';
import { PromptComposer } from './PromptComposer';
import { NucleusMark } from './NucleusMark';
import './LandingHub.css';

const TEMPLATES = [
  {
    title: '团队任务看板',
    icon: LayoutGrid,
    prompt:
      '构建一个现代线性风格的团队任务看板应用，支持 Todo / In Progress / Done 三列拖拽或状态切换、优先级标签、搜索筛选、新增和编辑任务，并通过 NucleusDB 实现云端持久化。',
  },
  {
    title: '个人记账本',
    icon: Wallet,
    prompt:
      '构建一个高颜值的个人收支记账本，支持记录收入和支出分类、月度预算进度条、按分类统计的 SVG 可视化图表和明细列表，所有账单通过 NucleusDB 持久化存储。',
  },
  {
    title: '团队投票墙',
    icon: ChartNoAxesColumn,
    prompt:
      '构建一个产品需求投票与想法墙应用，用户可以提交新点子、按热度排序、点击点赞投票、按标签筛选，所有数据实时保存在 NucleusDB 云端。',
  },
  {
    title: '番茄钟',
    icon: Timer,
    prompt:
      '构建一个极客风番茄工作法计时器 + 每日习惯打卡追踪器，支持 25 分钟专注倒计时、自定义习惯列表、每日打卡状态记录和连续打卡统计，数据持久化到 NucleusDB。',
  },
];

const SHOWCASE_COVERS = new Map([
  ['soleusforce', '/showcase/soleusforce.webp'],
  ['app-a1216bcc', '/showcase/team-kanban.webp'],
]);

interface Props {
  user: User | null;
  onRequireAuth: () => void;
  onLogout: () => void;
  onOpenProject: (projectId: string, initialPrompt?: ChatDraft) => void;
}

export function LandingHub({ user, onRequireAuth, onLogout, onOpenProject }: Props) {
  const [draft, setDraft] = useState<ChatDraft>({ text: '', images: [] });
  const [creating, setCreating] = useState(false);
  const [myProjects, setMyProjects] = useState<ProjectSummary[]>([]);
  const [showcase, setShowcase] = useState<ProjectSummary[]>([]);
  const [actionError, setActionError] = useState('');
  const [remixingId, setRemixingId] = useState<string | null>(null);

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

  async function handleStart({ text, images }: ChatDraft) {
    if (creating || (!text && !images.length)) return;
    if (!user) {
      onRequireAuth();
      return;
    }
    setCreating(true);
    setActionError('');
    try {
      const title = text.slice(0, 22) || '图片参考应用';
      const res = await api.createProject(title, text.slice(0, 140));
      onOpenProject(res.project.id, { text, images });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleRemix(id: string) {
    if (remixingId) return;
    if (!user) {
      onRequireAuth();
      return;
    }
    setRemixingId(id);
    setActionError('');
    try {
      const res = await api.remixProject(id);
      onOpenProject(res.projectId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Remix 失败');
    } finally {
      setRemixingId(null);
    }
  }

  async function handleDelete(id: string) {
    setActionError('');
    try {
      await api.deleteProject(id);
      setMyProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '删除项目失败');
    }
  }

  return (
    <div className="landing-dashboard" id="workbench">
      <header className="dashboard-header">
        <div className="dashboard-shell dashboard-bar">
          <a href="#workbench" className="dashboard-brand" aria-label="Nucleus 首页">
            <NucleusMark />
            <span>Nucleus</span>
          </a>
          <nav className="dashboard-nav" aria-label="首页导航">
            <a className="nav-workbench" href="#workbench">工作台</a>
            <a className="nav-templates" href="#templates">模板</a>
            {user && myProjects.length > 0 && <a className="nav-projects" href="#projects">我的项目</a>}
            {showcase.length > 0 && <a className="nav-showcase" href="#showcase">社区</a>}
          </nav>
          <div className="dashboard-account">
            {user ? (
              <>
                <span className="dashboard-user" title={user.name}>{user.name}</span>
                <button type="button" className="dashboard-control" onClick={onLogout}>
                  <LogOut size={16} strokeWidth={1.65} />退出
                </button>
              </>
            ) : (
              <button type="button" className="dashboard-control" onClick={onRequireAuth}>
                登录 / 访客体验
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="dashboard-shell dashboard-main">
        <section aria-labelledby="dashboard-title">
          <div className="dashboard-intro">
            <h1 id="dashboard-title">把想法变成应用</h1>
            <p>描述需求或上传参考图，团队会生成可预览的应用。</p>
          </div>

          <div className="dashboard-build">
            <PromptComposer
              draft={draft}
              setDraft={setDraft}
              onSend={handleStart}
              disabled={creating}
              variant="landing"
              placeholder="做一个能筛选任务的团队看板"
              renderSubmit={(disabled) => (
                <div className="dashboard-submit">
                  <kbd>Ctrl / ⌘ + Enter</kbd>
                  <button type="submit" disabled={disabled} className="dashboard-primary">
                    {creating ? '正在创建…' : '开始构建'}
                    <ArrowRight size={18} strokeWidth={1.8} />
                  </button>
                </div>
              )}
            />

            <aside className="dashboard-roster" aria-labelledby="team-title">
              <h2 id="team-title">构建团队</h2>
              <ul>
                {WORKSPACE_AGENTS.map(({ name, role }) => (
                  <li key={name}>
                    <span className="agent-initial" aria-hidden="true">{name[0]}</span>
                    <span className="agent-name">{name}</span>
                    <span className="agent-role">{role}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>

        {actionError && <p className="dashboard-error" role="alert">{actionError}</p>}

        <section className="dashboard-section" id="templates" aria-labelledby="template-title">
          <h2 id="template-title">从模板开始</h2>
          <div className="dashboard-templates">
            {TEMPLATES.map(({ title, icon: Icon, prompt }) => (
              <button
                key={title}
                type="button"
                disabled={creating}
                className="dashboard-template"
                onClick={() => {
                  const template = { text: prompt, images: [] };
                  setDraft(template);
                  void handleStart(template);
                }}
              >
                <Icon className="template-icon" size={24} strokeWidth={1.6} />
                <span>{title}</span>
                <ArrowRight className="template-arrow" size={17} strokeWidth={1.65} />
              </button>
            ))}
          </div>
        </section>

        {user && myProjects.length > 0 && (
          <section className="dashboard-section" id="projects" aria-labelledby="project-title">
            <h2 id="project-title">我的项目 <span className="dashboard-count">{myProjects.length}</span></h2>
            <div className="dashboard-projects">
              {myProjects.map((project) => (
                <article key={project.id} className="dashboard-card dashboard-project">
                  <div className="dashboard-project-header">
                    <h3>
                      <button type="button" className="dashboard-project-open" onClick={() => onOpenProject(project.id)}>
                        {project.title}
                      </button>
                    </h3>
                    <span className="dashboard-meta">v{project.current_version}</span>
                  </div>
                  {project.description && <p>{project.description}</p>}
                  <div className="dashboard-card-footer">
                    <time className="dashboard-meta" dateTime={project.updated_at}>
                      {new Date(project.updated_at).toLocaleDateString('zh-CN')}
                    </time>
                    <div className="dashboard-card-actions">
                      {project.published_slug && (
                        <a className="dashboard-control" href={`/p/${project.published_slug}`} target="_blank" rel="noreferrer">
                          已发布 <ExternalLink size={16} strokeWidth={1.65} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="dashboard-control dashboard-icon"
                        onClick={() => handleDelete(project.id)}
                        aria-label={`删除项目 ${project.title}`}
                        title="删除项目"
                      >
                        <Trash2 size={16} strokeWidth={1.65} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {showcase.length > 0 && (
          <section className="dashboard-section" id="showcase" aria-labelledby="showcase-title">
            <h2 id="showcase-title">社区应用</h2>
            <div className="dashboard-showcase">
              {showcase.map((project) => {
                const url = project.published_slug ? `/p/${project.published_slug}` : '';
                const cover = project.published_slug ? SHOWCASE_COVERS.get(project.published_slug) : undefined;
                return (
                  <article key={project.id} className="dashboard-card showcase-card">
                    {url && cover && (
                      <a className="showcase-preview" href={url} target="_blank" rel="noreferrer" aria-label={`预览 ${project.title}`}>
                        <span className="showcase-preview-bar" aria-hidden="true" />
                        <img src={cover} alt="" loading="lazy" width="640" height="343" />
                      </a>
                    )}
                    <div className="showcase-copy">
                      <h3>{project.title}</h3>
                      {project.description && <p>{project.description}</p>}
                      <div className="dashboard-card-footer">
                        {project.author_name && <span className="dashboard-meta">{project.author_name}</span>}
                        <div className="dashboard-card-actions">
                          {url && (
                            <a className="dashboard-control dashboard-icon" href={url} target="_blank" rel="noreferrer" aria-label={`打开 ${project.title}`} title="打开应用">
                              <ExternalLink size={16} strokeWidth={1.65} />
                            </a>
                          )}
                          <button type="button" className="dashboard-control dashboard-remix" disabled={remixingId !== null} onClick={() => handleRemix(project.id)}>
                            <GitFork size={16} strokeWidth={1.65} />
                            {remixingId === project.id ? 'Remix 中…' : 'Remix'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
