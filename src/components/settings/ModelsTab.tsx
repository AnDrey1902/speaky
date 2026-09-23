import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppSettings, STTProvider, InstalledModelInfo, ModelEngine, ModelProgressEvent } from '../../types';
import {
  Key,
  ExternalLink,
  Zap,
  Cloud,
  HardDrive,
  Check,
  Eye,
  EyeOff,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2,
  Loader2,
  FolderPlus,
  Pencil,
  Languages as LanguagesIcon
} from 'lucide-react';
import { getTranslations } from '../../utils/i18n';
import { MODEL_CATALOG } from '../../modelCatalog';
import { Badge, Button, ProgressBar, TabHeader, EmptyState } from '../common/ui';

interface ModelsTabProps {
  settings: AppSettings;
  onChange: (updates: Partial<AppSettings>) => void;
}

type ProgressMap = Record<string, { state: string; percent?: number }>;
type EngineMap = Record<ModelEngine, { available?: boolean; hint?: string; checking?: boolean }>;

const engineLabel: Record<ModelEngine, string> = {
  'faster-whisper': 'faster-whisper',
  'gigaam': 'GigaAM',
  'sherpa-onnx': 'sherpa-onnx',
  'onnx-asr': 'onnx-asr'
};

export const ModelsTab: React.FC<ModelsTabProps> = ({ settings, onChange }) => {
  const t = getTranslations(settings.uiLanguage);
  const [models, setModels] = useState<InstalledModelInfo[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [engines, setEngines] = useState<EngineMap>({} as EngineMap);
  const [showKey, setShowKey] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const checkedRef = useRef<Set<ModelEngine>>(new Set());

  const refreshCatalog = useCallback(async () => {
    const catalog = await window.speakyAPI?.getModelCatalog?.();
    if (catalog) {
      setModels(catalog);
    } else {
      // Browser preview (outside Electron): show the static catalog
      setModels(MODEL_CATALOG.map((m) => ({ ...m, installed: false })));
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
    const unsub = window.speakyAPI?.onModelProgress?.((ev: ModelProgressEvent) => {
      setProgress((prev) => ({
        ...prev,
        [ev.modelId]: { state: ev.state, percent: ev.percent }
      }));
      if (ev.state === 'done' || ev.state === 'error') {
        refreshCatalog();
      }
      if (ev.state === 'error' && ev.error) {
        setModelError(ev.error);
      }
    });
    return () => unsub?.();
  }, [refreshCatalog]);

  // Check python engines for the models present in the catalog (once each)
  useEffect(() => {
    const enginesToCheck = [...new Set(models.map((m) => m.engine))];
    for (const engine of enginesToCheck) {
      if (checkedRef.current.has(engine)) continue;
      checkedRef.current.add(engine);
      setEngines((prev) => ({ ...prev, [engine]: { checking: true } }));
      window.speakyAPI?.checkEngine?.(engine).then((res) => {
        setEngines((prev) => ({
          ...prev,
          [engine]: { available: res?.available, hint: res?.hint, checking: false }
        }));
      });
    }
  }, [models]);

  const handleDownload = async (modelId: string) => {
    if (!window.speakyAPI?.downloadModel) return;
    setModelError(null);
    setProgress((prev) => ({ ...prev, [modelId]: { state: 'downloading', percent: 0 } }));
    const res = await window.speakyAPI?.downloadModel?.(modelId);
    if (res && !res.ok) {
      setModelError(res.error || 'Ошибка скачивания');
      setProgress((prev) => ({ ...prev, [modelId]: { state: 'error' } }));
      refreshCatalog();
    }
  };

  const handleRemove = async (modelId: string) => {
    const res = await window.speakyAPI?.removeModel?.(modelId);
    if (res && !res.ok) {
      setModelError(res.error || 'Ошибка удаления');
    }
    // If the removed model was the active local one, clear the selection
    if (settings.provider === 'local' && settings.localModelId === modelId) {
      onChange({ localModelId: undefined });
    }
    refreshCatalog();
  };

  const handleSelectLocal = (modelId: string) => {
    onChange({ provider: 'local', localModelId: modelId });
  };

  /* ── Custom folder model ── */
  const [draftFolder, setDraftFolder] = useState<{
    path: string;
    suggestedName: string;
    detectedEngine?: ModelEngine;
  } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftEngine, setDraftEngine] = useState<ModelEngine>('faster-whisper');
  const [draftKey, setDraftKey] = useState('');

  const handlePickFolder = async () => {
    setModelError(null);
    const res = await window.speakyAPI?.pickModelFolder?.();
    if (!res) return;
    if (!res.detectedEngine) {
      setModelError('Не удалось определить движок модели по содержимому папки');
      return;
    }
    setDraftFolder(res);
    setDraftName(res.suggestedName);
    setDraftEngine(res.detectedEngine);
    setDraftKey('');
  };

  const handleRegisterFolder = async () => {
    if (!draftFolder) return;
    const id = `custom-${Date.now().toString(36)}`;
    const res = await window.speakyAPI?.registerCustomModel?.({
      id,
      name: draftName.trim() || draftFolder.suggestedName,
      path: draftFolder.path,
      engine: draftEngine,
      engineModelId: draftEngine === 'onnx-asr' ? draftKey.trim() || undefined : undefined
    });
    if (res && !res.ok) {
      setModelError(res.error || 'Ошибка подключения папки');
      return;
    }
    setDraftFolder(null);
    refreshCatalog();
  };

  const localModels = models;

  const cloudProviders: {
    id: STTProvider;
    name: string;
    model: string;
    tag: string;
    latency: string;
    desc: string;
    icon: React.ElementType;
  }[] = [
    {
      id: 'groq',
      name: 'Groq Cloud Whisper',
      model: 'whisper-large-v3-turbo',
      tag: t.groqTag,
      latency: t.groqLatency,
      desc: t.groqDesc,
      icon: Zap
    },
    {
      id: 'openai',
      name: 'OpenAI Whisper',
      model: 'whisper-1',
      tag: t.openaiTag,
      latency: t.openaiLatency,
      desc: t.openaiDesc,
      icon: Cloud
    }
  ];

  const currentKey = settings.provider === 'groq' ? settings.groqApiKey : settings.openaiApiKey;
  const isKeyConfigured = Boolean(currentKey && currentKey.length > 5);

  return (
    <div className="space-y-6 max-w-3xl">
      <TabHeader title={t.modelsTitle} subtitle={t.modelsSubtitle} />

      {modelError && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 break-words">{modelError}</span>
          <button className="text-rose-400 hover:text-rose-200 cursor-pointer" onClick={() => setModelError(null)}>✕</button>
        </div>
      )}

      {/* ── Local models ─────────────────────────────────────────── */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <HardDrive className="w-3.5 h-3.5" /> {t.localModelsSection}
          </div>
          <Button variant="secondary" onClick={handlePickFolder} title="Подключить уже скачанную модель из любой папки">
            <FolderPlus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Из папки…
          </Button>
        </div>

        {/* Folder registration draft */}
        {draftFolder && (
          <div className="p-4 rounded-xl border border-indigo-500/50 bg-indigo-500/5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-100">
              <FolderPlus className="w-4 h-4 text-indigo-300" /> Новая модель из папки
            </div>
            <p className="text-[11px] text-zinc-500 font-mono break-all">{draftFolder.path}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Название"
                className="px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 min-w-40"
              />
              <select
                value={draftEngine}
                onChange={(e) => setDraftEngine(e.target.value as ModelEngine)}
                className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {(Object.keys(engineLabel) as ModelEngine[]).map((eng) => (
                  <option key={eng} value={eng}>{engineLabel[eng]}</option>
                ))}
              </select>
            </div>
            {draftEngine === 'onnx-asr' && (
              <input
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="Ключ модели (load_model), напр. gigaam-v3-ctc"
                className="w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            )}
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={handleRegisterFolder}>Подключить</Button>
              <Button variant="ghost" onClick={() => setDraftFolder(null)}>Отмена</Button>
            </div>
          </div>
        )}

        {localModels.length === 0 && !draftFolder && <EmptyState>{t.modelsEmpty}</EmptyState>}

        {localModels.map((m) => {
          const isDownloading = progress[m.id]?.state === 'downloading';
          const isActiveLocal = settings.provider === 'local' && settings.localModelId === m.id;
          const engine = engines[m.engine];
          const engineMissing = engine && engine.available === false;

          return (
            <div
              key={m.id}
              className={`p-4 rounded-xl border transition-all ${
                isActiveLocal
                  ? 'bg-zinc-900 border-indigo-500/70 ring-1 ring-indigo-500/40'
                  : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
                      m.installed
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                        : 'bg-zinc-800 border-zinc-700/60 text-zinc-400'
                    }`}
                  >
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-zinc-100">{m.name}</span>
                      <Badge tone="neutral">{engineLabel[m.engine]}</Badge>
                      {m.isCustom && <Badge tone="accent"><Pencil className="w-3 h-3" /> своя</Badge>}
                      <Badge tone={m.languages.includes('ru') ? 'accent' : 'neutral'}>
                        <LanguagesIcon className="w-3 h-3" />
                        {m.languages.join(', ')}
                      </Badge>
                      {m.installed && <Badge tone="success">{t.installedModel}</Badge>}
                      {isActiveLocal && <Badge tone="accent">{t.activeModel}</Badge>}
                    </div>
                    <p className={`text-[11px] mt-1 leading-relaxed ${m.isCustom ? 'text-zinc-600 font-mono break-all line-clamp-2' : 'text-zinc-500 truncate'}`}>
                      {m.description}
                    </p>
                    {engineMissing && (
                      <p className="text-[10px] text-amber-400 mt-1 font-mono">
                        {t.engineMissing}: {engine?.hint || `pip install ${m.requires}`}
                      </p>
                    )}
                    {m.installed && m.sizeOnDiskMB !== undefined && (
                      <p className="text-[10px] text-zinc-600 mt-1 font-mono">
                        {m.sizeOnDiskMB} МБ на диске
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-zinc-600">{m.sizeMB} МБ</span>
                  {isDownloading ? (
                    <span className="text-[10px] text-indigo-300 font-semibold flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {t.downloadingModel} {Math.round(progress[m.id]?.percent || 0)}%
                    </span>
                  ) : m.installed ? (
                    <>
                      {!isActiveLocal && (
                        <Button variant="primary" onClick={() => handleSelectLocal(m.id)}>
                          {t.selectModel}
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        onClick={() => handleRemove(m.id)}
                        title={m.isCustom ? 'Отключить папку (файлы не удаляются)' : t.removeModel}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : m.isCustom ? (
                    <Button variant="danger" onClick={() => handleRemove(m.id)}>
                      Отключить
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => handleDownload(m.id)}>
                      <Download className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                      {t.downloadModel}
                    </Button>
                  )}
                </div>
              </div>

              {isDownloading && (
                <div className="mt-3">
                  <ProgressBar value={progress[m.id]?.percent || 0} />
                </div>
              )}
            </div>
          );
        })}

        {settings.provider === 'local' && !settings.localModelId && (
          <p className="text-[11px] text-amber-400">{t.modelsEmpty}</p>
        )}
      </section>

      {/* ── Cloud providers ──────────────────────────────────────── */}
      <section className="space-y-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <Cloud className="w-3.5 h-3.5" /> {t.cloudModelsSection}
        </div>

        {cloudProviders.map((p) => {
          const isSelected = settings.provider === p.id;
          const Icon = p.icon;
          return (
            <div
              key={p.id}
              onClick={() => onChange({ provider: p.id })}
              className={`p-4 rounded-xl cursor-pointer border transition-all duration-200 select-none ${
                isSelected
                  ? 'bg-zinc-900 border-indigo-500/70 ring-1 ring-indigo-500/40'
                  : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                      isSelected ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400 border border-zinc-700/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-100">{p.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{p.model}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate leading-relaxed">{p.desc}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={isSelected ? 'accent' : 'neutral'}>{p.tag}</Badge>
                    <span className="text-[10px] font-mono text-zinc-600">{p.latency}</span>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                      isSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-zinc-600 bg-zinc-900'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* API key card */}
        {settings.provider === 'groq' || settings.provider === 'openai' ? (
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-4 mt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-100">
                      {settings.provider === 'groq' ? 'Groq Cloud' : 'OpenAI'} {t.apiKeyTitle}
                    </span>
                    {isKeyConfigured ? (
                      <Badge tone="success">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {t.keyValid}
                      </Badge>
                    ) : (
                      <Badge tone="warning">{t.keyRequired}</Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    {settings.provider === 'groq' ? t.getKeyGroq : t.getKeyOpenAI}
                  </span>
                </div>
              </div>

              {settings.provider === 'groq' && (
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                >
                  <span>Groq Console</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
                </a>
              )}
            </div>

            <div className="space-y-2">
              <div className="relative flex items-center">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={currentKey}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    if (settings.provider === 'groq') {
                      onChange({ groqApiKey: val });
                    } else {
                      onChange({ openaiApiKey: val });
                    }
                  }}
                  placeholder={settings.provider === 'groq' ? 'gsk_...' : 'sk-...'}
                  className="w-full pl-3.5 pr-10 py-2.5 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
                  title={showKey ? 'Hide' : 'Show'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 pt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>{t.apiKeyDesc}</span>
              </div>
            </div>
          </div>
        ) : settings.provider === 'local' ? (
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 flex items-center gap-3 mt-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-100">
                {models.find((m) => m.id === settings.localModelId)?.name || 'Локальная модель'}
              </div>
              <div className="text-[11px] text-zinc-500">{t.localDesc}</div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};
