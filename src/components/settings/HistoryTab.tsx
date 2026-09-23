import React, { useState } from 'react';
import { DictationHistoryItem, UILanguage } from '../../types';
import { Search, Copy, Check, Trash2, Download, History as HistoryIcon, Languages } from 'lucide-react';
import { getTranslations } from '../../utils/i18n';
import { Badge, Button, EmptyState, TabHeader } from '../common/ui';

interface HistoryTabProps {
  history: DictationHistoryItem[];
  onClear: () => void;
  uiLanguage?: UILanguage;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ history, onClear, uiLanguage }) => {
  const t = getTranslations(uiLanguage);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportState, setExportState] = useState<string | null>(null);

  const filtered = history.filter((item) => {
    const query = search.toLowerCase();
    return (
      (item.processedText || '').toLowerCase().includes(query) ||
      (item.appContext || '').toLowerCase().includes(query)
    );
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = async (format: 'md' | 'txt') => {
    try {
      const res = await (window as any).speakyAPI?.exportHistory?.(format);
      if (res?.success) {
        setExportState(t.exported);
        setTimeout(() => setExportState(null), 3000);
      }
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString();
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <TabHeader
        title={t.historyTitle}
        subtitle={t.historySubtitle}
        right={
          history.length > 0 ? (
            <div className="flex items-center gap-2">
              {exportState && (
                <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> {exportState}
                </span>
              )}
              <div className="flex bg-zinc-800 p-0.5 rounded-lg border border-zinc-700/70">
                <button
                  onClick={() => handleExport('md')}
                  className="px-2.5 py-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
                  title="Export .MD"
                >
                  <Download className="w-3 h-3" /> {t.exportMd}
                </button>
                <button
                  onClick={() => handleExport('txt')}
                  className="px-2.5 py-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
                  title="Export .TXT"
                >
                  <Download className="w-3 h-3" /> {t.exportTxt}
                </button>
              </div>
              <Button variant="danger" onClick={onClear}>
                <Trash2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> {t.clearHistory}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full pl-10 pr-3.5 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>

      {/* Items */}
      <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <EmptyState icon={HistoryIcon}>
            {search ? t.searchPlaceholder : t.historyEmptyDesc}
          </EmptyState>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-2.5 hover:border-zinc-700 transition-all"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                  <span>{formatDate(item.timestamp)}</span>
                  {item.appContext && <Badge tone="neutral">{item.appContext}</Badge>}
                  {item.mode === 'translate' && (
                    <Badge tone="accent">
                      <Languages className="w-3 h-3" /> {t.tabTranslate}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-indigo-300 font-semibold text-[11px]">
                    {item.latencyMs}мс
                  </span>
                  <button
                    onClick={() => handleCopy(item.id, item.processedText)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
                    title={t.copyText}
                  >
                    {copiedId === item.id ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 font-bold" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="text-xs text-zinc-300 select-text leading-relaxed bg-zinc-800/50 p-3 rounded-lg border border-zinc-800">
                {item.processedText}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
