import { useState } from 'react';
import { Atom, Loader2, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-lg shadow-indigo-500/25">
            <Atom className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">进入 Nucleus Studio</h2>
            <p className="text-xs text-zinc-400">登录以持久化保存你的多智能体应用与 Cloud 数据</p>
          </div>
        </div>

        <button
          onClick={handleGuest}
          disabled={loading}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          一键访客免注册体验（立即可用）
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
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
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
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
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
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
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
