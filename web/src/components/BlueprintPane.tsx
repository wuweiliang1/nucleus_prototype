import { useEffect, useState } from 'react';
import { Database, FileText, Layers, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { SchemaCollection } from '../types';

interface Props {
  projectId: string;
  prdMd: string;
  architectureMd: string;
  schemaJson: SchemaCollection[];
}

export function BlueprintPane({ projectId, prdMd, architectureMd, schemaJson }: Props) {
  const [subTab, setSubTab] = useState<'prd' | 'arch' | 'cloud'>('prd');
  const [cloudData, setCloudData] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [totalRows, setTotalRows] = useState(0);
  const [loadingData, setLoadingData] = useState(false);

  async function refreshCloudData() {
    setLoadingData(true);
    try {
      const res = await api.inspectCloudData(projectId);
      setCloudData(res.collections);
      setTotalRows(res.totalRows);
    } catch {
      // ignore
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (subTab === 'cloud') {
      refreshCloudData();
    }
  }, [subTab, projectId]);

  const collectionNames = Object.keys(cloudData);

  return (
    <div className="flex h-full flex-col bg-[#0b0b0e]">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2 bg-zinc-950/60">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSubTab('prd')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              subTab === 'prd' ? 'bg-pink-500/15 text-pink-300 border border-pink-500/30' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Emma · PRD 需求文档
          </button>
          <button
            onClick={() => setSubTab('arch')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              subTab === 'arch' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Bob · 系统架构
          </button>
          <button
            onClick={() => setSubTab('cloud')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              subTab === 'cloud' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Nucleus Cloud DB ({totalRows})
          </button>
        </div>

        {subTab === 'cloud' && (
          <button
            onClick={refreshCloudData}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${loadingData ? 'animate-spin' : ''}`} />
            刷新数据
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {subTab === 'prd' && (
          <div className="mx-auto max-w-3xl">
            {prdMd ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-200 bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-5">
                {prdMd}
              </pre>
            ) : (
              <div className="text-center text-sm text-zinc-500 py-16">
                Emma 尚未生成 PRD，发送需求后自动产出结构化文档
              </div>
            )}
          </div>
        )}

        {subTab === 'arch' && (
          <div className="mx-auto max-w-3xl space-y-5">
            {architectureMd ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-zinc-200 bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-5">
                {architectureMd}
              </pre>
            ) : (
              <div className="text-center text-sm text-zinc-500 py-12">
                Bob 尚未生成架构蓝图
              </div>
            )}

            {schemaJson && schemaJson.length > 0 && (
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Cloud DB 集合定义
                </h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {schemaJson.map((col) => (
                    <div
                      key={col.name}
                      className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4"
                    >
                      <div className="mb-1 font-mono text-xs font-semibold text-emerald-400">
                        collection: {col.name}
                      </div>
                      <p className="mb-3 text-xs text-zinc-400">{col.description}</p>
                      <div className="space-y-1">
                        {(col.fields || []).map((f) => (
                          <div key={f.name} className="flex items-center justify-between text-xs font-mono">
                            <span className="text-zinc-200">{f.name}</span>
                            <span className="text-zinc-500">{f.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {subTab === 'cloud' && (
          <div className="mx-auto max-w-4xl space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-200/90">
              实时展示该生成应用通过 <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-cyan-300">window.NucleusDB</code> 写入生产级 PostgreSQL 数据库的真实持久化记录。在 Preview 中新增/修改数据后点击「刷新数据」即可立即看到。
            </div>

            {collectionNames.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 py-14 text-center text-sm text-zinc-500">
                当前应用尚未写入任何云端数据记录
              </div>
            ) : (
              collectionNames.map((colName) => (
                <div key={colName} className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
                    <span className="font-mono text-xs font-semibold text-cyan-400">
                      {colName}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {cloudData[colName].length} rows
                    </span>
                  </div>
                  <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
                    {cloudData[colName].map((row, idx) => (
                      <pre
                        key={String(row.id || idx)}
                        className="px-4 py-2.5 text-[11px] font-mono text-zinc-300 overflow-x-auto"
                      >
                        {JSON.stringify(row, null, 2)}
                      </pre>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
