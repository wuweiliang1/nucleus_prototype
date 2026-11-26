import { useEffect, useState } from 'react';
import { Check, FileCode2, Save } from 'lucide-react';

interface Props {
  files: Record<string, string>;
  onSaveFiles: (files: Record<string, string>) => Promise<void>;
}

export function CodeExplorer({ files, onSaveFiles }: Props) {
  const fileNames = Object.keys(files);
  const [activeFile, setActiveFile] = useState<string>(fileNames[0] || '');
  const [draft, setDraft] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (!activeFile || !(activeFile in files)) {
      const first = Object.keys(files)[0] || '';
      setActiveFile(first);
      setDraft(first ? files[first] : '');
      setDirty(false);
    } else if (!dirty) {
      setDraft(files[activeFile] || '');
    }
  }, [files, activeFile, dirty]);

  function selectFile(name: string) {
    setActiveFile(name);
    setDraft(files[name] || '');
    setDirty(false);
  }

  async function handleSave() {
    if (!activeFile) return;
    setSaving(true);
    try {
      await onSaveFiles({ ...files, [activeFile]: draft });
      setDirty(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  if (fileNames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        发送需求后，Alex 生成的多文件源码将显示在这里
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#0d0d10]">
      {/* File Tree */}
      <div className="w-52 shrink-0 border-r border-zinc-800/80 bg-zinc-950/60 p-3">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Project Files ({fileNames.length})
        </div>
        <div className="space-y-1">
          {fileNames.map((name) => (
            <button
              key={name}
              onClick={() => selectFile(name)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-mono transition cursor-pointer ${
                activeFile === name
                  ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2 bg-zinc-950/40">
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-300">
            <span>{activeFile}</span>
            {dirty && <span className="h-2 w-2 rounded-full bg-amber-400" title="未保存修改" />}
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer"
          >
            {savedToast ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Save className="h-3.5 w-3.5" />}
            {savedToast ? '已保存并刷新' : saving ? '保存中...' : '保存修改'}
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          className="flex-1 w-full resize-none bg-[#0b0b0e] p-4 font-mono text-xs leading-relaxed text-zinc-200 focus:outline-none"
        />
      </div>
    </div>
  );
}
