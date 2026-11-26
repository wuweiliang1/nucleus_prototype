import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Crosshair,
  Monitor,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { api } from '../api';
import type {
  RuntimeErrorContext,
  SelectedElementContext,
} from '../types';

interface Props {
  projectId: string;
  files: Record<string, string>;
  onElementSelected: (el: SelectedElementContext) => void;
  onAutoFixError: (err: RuntimeErrorContext) => void;
}

export function PreviewPane({
  projectId,
  files,
  onElementSelected,
  onAutoFixError,
}: Props) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [inspectMode, setInspectMode] = useState(false);
  const [srcDoc, setSrcDoc] = useState('');
  const [runtimeError, setRuntimeError] = useState<RuntimeErrorContext | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const hasFiles = Object.keys(files).length > 0;

  // Build single preview bundle
  useEffect(() => {
    let cancelled = false;
    if (!hasFiles) {
      setSrcDoc('');
      return;
    }
    setRuntimeError(null);
    api
      .buildPreviewBundle(projectId, files, true)
      .then((res) => {
        if (!cancelled) setSrcDoc(res.html);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, files, hasFiles, refreshKey]);

  // Sync inspect mode to iframe
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'NUCLEUS_TOGGLE_INSPECT', enabled: inspectMode },
      '*'
    );
  }, [inspectMode, srcDoc]);

  // Listen for iframe messages (Select-to-Edit & Runtime Error)
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'NUCLEUS_ELEMENT_SELECTED') {
        setInspectMode(false);
        onElementSelected({
          selector: ev.data.selector,
          tagName: ev.data.tagName,
          text: ev.data.text,
          snippet: ev.data.snippet,
        });
      } else if (ev.data.type === 'NUCLEUS_RUNTIME_ERROR') {
        setRuntimeError({
          message: ev.data.message,
          stack: ev.data.stack,
        });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onElementSelected]);

  return (
    <div className="flex h-full flex-col bg-[#0c0c0f]">
      {/* Preview Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/70 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-zinc-900 p-0.5 border border-zinc-800">
            <button
              onClick={() => setViewport('desktop')}
              title="桌面视图"
              className={`rounded-md p-1.5 cursor-pointer ${
                viewport === 'desktop' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewport('mobile')}
              title="移动端视图"
              className={`rounded-md p-1.5 cursor-pointer ${
                viewport === 'mobile' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={!hasFiles}
            title="刷新预览"
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          onClick={() => setInspectMode((v) => !v)}
          disabled={!hasFiles}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition cursor-pointer disabled:opacity-40 ${
            inspectMode
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-indigo-500/50 hover:text-white'
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" />
          {inspectMode ? '请在画面中点击要修改的元素...' : '点选编辑 (Select-to-Edit)'}
        </button>
      </div>

      {/* Runtime Error Auto-Fix Banner */}
      {runtimeError && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs">
          <div className="flex items-center gap-2 text-rose-200 truncate">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span className="truncate font-mono">运行时异常: {runtimeError.message}</span>
          </div>
          <button
            onClick={() => {
              const err = runtimeError;
              setRuntimeError(null);
              onAutoFixError(err);
            }}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-500 cursor-pointer"
          >
            <Wrench className="h-3 w-3" />
            一键让 Alex 修复
          </button>
        </div>
      )}

      {/* Iframe Canvas */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-3">
        {!hasFiles ? (
          <div className="text-center max-w-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-indigo-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-medium text-zinc-200 mb-1">实时可视化预览区</h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              应用生成后将在此即时运行，自带生产级 PostgreSQL 云端数据持久化、点选可视化编辑和一键公网发布。
            </p>
          </div>
        ) : (
          <div
            className={`h-full overflow-hidden rounded-xl border border-zinc-800 bg-white shadow-2xl transition-all duration-200 ${
              viewport === 'mobile' ? 'w-[390px] max-w-full' : 'w-full'
            }`}
          >
            <iframe
              ref={iframeRef}
              key={refreshKey}
              title="Nucleus App Preview"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="h-full w-full border-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}
