import { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2, Rocket, X } from 'lucide-react';
import { api } from '../api';

interface Props {
  projectId: string;
  currentSlug: string | null;
  onPublished: (slug: string) => void;
  onClose: () => void;
}

export function PublishModal({ projectId, currentSlug, onPublished, onClose }: Props) {
  const [slug, setSlug] = useState(currentSlug || '');
  const [publishedUrl, setPublishedUrl] = useState(
    currentSlug ? `${window.location.origin}/p/${currentSlug}` : ''
  );
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function handlePublish() {
    setLoading(true);
    setError('');
    try {
      const res = await api.publishProject(projectId, slug || undefined);
      setSlug(res.slug);
      setPublishedUrl(res.url);
      onPublished(res.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!publishedUrl) return;
    navigator.clipboard.writeText(publishedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">发布到 Nucleus Cloud</h3>
            <p className="text-xs text-zinc-400">
              生成独立公开访问 URL，内置 PostgreSQL Cloud DB 自动生效
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-zinc-400">自定义访问路径（可选）</label>
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
              <span className="px-3 py-2 text-xs text-zinc-500 border-r border-zinc-800 bg-zinc-950/60">
                {window.location.origin}/p/
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="留空自动生成，例如 my-kanban"
                disabled={Boolean(currentSlug)}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none disabled:opacity-60"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          {publishedUrl && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5">
              <div className="mb-1.5 text-xs font-medium text-emerald-400">应用已在线运行</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 border border-zinc-800">
                  {publishedUrl}
                </code>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  打开
                </a>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-900 cursor-pointer"
            >
              关闭
            </button>
            <button
              onClick={handlePublish}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              {publishedUrl ? '更新线上版本' : '立即发布上线'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
