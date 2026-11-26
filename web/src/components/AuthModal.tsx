import { useState } from 'react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';
import { NucleusMark } from './NucleusMark';

interface Props {
  onSuccess: (user: User) => void;
  onClose?: () => void;
}

export function AuthModal({ onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(name, email, password);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest() {
    setError('');
    setLoading(true);
    try {
      const res = await api.guestLogin();
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '访客登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="auth-title" className="relative max-h-full w-full max-w-md overflow-auto rounded-xl border border-[#3f454a] bg-[#16191c] p-6 shadow-xl">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭登录窗口"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="mb-6 flex items-center gap-3">
          <span className="text-2xl"><NucleusMark /></span>
          <div>
            <h2 id="auth-title" className="text-lg font-semibold text-white">进入 Nucleus</h2>
            <p className="text-xs text-zinc-400">登录后即可保存和管理项目</p>
          </div>
        </div>

        <button
          onClick={handleGuest}
          disabled={loading}
          className="mb-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-(--nucleus-accent) px-4 py-2.5 text-sm font-semibold text-[#131809] hover:bg-[#e0f7a4] disabled:opacity-50"
        >
          以访客身份进入
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-zinc-500">
          <div className="h-px flex-1 bg-zinc-800" />
          <span>或使用邮箱账号</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-lg bg-zinc-900 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-md py-1.5 font-medium transition ${
              mode === 'login' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`rounded-md py-1.5 font-medium transition ${
              mode === 'register' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            注册账号
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-xs text-zinc-400">昵称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的名字"
                required
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-(--nucleus-accent) focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-zinc-400">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="builder@nucleus.dev"
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-(--nucleus-accent) focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              minLength={6}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-(--nucleus-accent) focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            {mode === 'login' ? '邮箱登录' : '注册并进入'}
          </button>
        </form>
      </div>
    </div>
  );
}
