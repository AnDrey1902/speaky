import React, { useState } from 'react';
import { AppSettings, PromptTemplate, LLMProvider } from '../../types';
import { Plus, Trash2, CheckCircle2, Sparkles, Zap, Cloud, Save, Hexagon, Server, Eye, EyeOff, ShieldCheck, ExternalLink, Key } from 'lucide-react';
import { getTranslations } from '../../utils/i18n';
import { Badge, Button, Input, Textarea, TabHeader, EmptyState } from '../common/ui';

interface PostprocessTabProps {
  settings: AppSettings;
  onChange: (updates: Partial<AppSettings>) => void;
  prompts: PromptTemplate[];
  onSavePrompts: (prompts: PromptTemplate[]) => void;
}

export const PostprocessTab: React.FC<PostprocessTabProps> = ({
  settings,
  onChange,
  prompts,
  onSavePrompts
}) => {
  const t = getTranslations(settings.uiLanguage);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [showLlmKey, setShowLlmKey] = useState(false);

  const activePromptId = settings.activePromptId || prompts.find((p) => p.isDefault)?.id;

  const activeProvider: LLMProvider = settings.llmProvider || 'groq';

  const llmKeyFor = (p: LLMProvider): string => {
    switch (p) {
      case 'groq': return settings.groqApiKey || '';
      case 'openai': return settings.openaiApiKey || '';
      case 'gemini': return settings.geminiApiKey || '';
      case 'openai-compatible': return settings.customLlmApiKey || '';
    }
  };

  const setLlmKeyFor = (p: LLMProvider, val: string) => {
    switch (p) {
      case 'groq': return onChange({ groqApiKey: val });
      case 'openai': return onChange({ openaiApiKey: val });
      case 'gemini': return onChange({ geminiApiKey: val });
      case 'openai-compatible': return onChange({ customLlmApiKey: val });
    }
  };

  const defaultModelFor = (p: LLMProvider): string => {
    switch (p) {
      case 'groq': return 'qwen/qwen3.8-27b';
      case 'openai': return 'gpt-4o-mini';
      case 'gemini': return 'gemini-2.5-flash';
      case 'openai-compatible': return '';
    }
  };

  const llmModelValue = settings.llmModels?.[activeProvider] || defaultModelFor(activeProvider);

  const handleModelChange = (val: string) => {
    onChange({ llmModels: { ...settings.llmModels, [activeProvider]: val } });
  };

  const llmOptions: { id: LLMProvider; name: string; model: string; icon: React.ElementType; keySet: boolean; href?: string }[] = [
    {
      id: 'groq',
      name: 'Groq',
      model: settings.llmModels?.groq || 'qwen/qwen3.8-27b',
      icon: Zap,
      keySet: Boolean(settings.groqApiKey),
      href: 'https://console.groq.com/keys'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      model: settings.llmModels?.openai || 'gpt-4o-mini',
      icon: Cloud,
      keySet: Boolean(settings.openaiApiKey),
      href: 'https://platform.openai.com/api-keys'
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      model: settings.llmModels?.gemini || 'gemini-2.5-flash',
      icon: Hexagon,
      keySet: Boolean(settings.geminiApiKey),
      href: 'https://aistudio.google.com/apikey'
    },
    {
      id: 'openai-compatible',
      name: 'OpenAI-совместимый',
      model: settings.llmModels?.['openai-compatible'] || 'URL + модель',
      icon: Server,
      keySet: Boolean(settings.customLlmBaseUrl && settings.llmModels?.['openai-compatible'])
    }
  ];

  const handleAddPrompt = () => {
    if (!newName.trim() || !newBody.trim()) return;
    const prompt: PromptTemplate = {
      id: Date.now().toString(),
      name: newName.trim(),
      body: newBody.trim()
    };
    onSavePrompts([...prompts, prompt]);
    if (!activePromptId) {
      onChange({ activePromptId: prompt.id });
    }
    setNewName('');
    setNewBody('');
  };

  const handleUpdatePrompt = (id: string, updates: Partial<PromptTemplate>) => {
    onSavePrompts(prompts.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const handleDeletePrompt = (id: string) => {
    onSavePrompts(prompts.filter((p) => p.id !== id));
    if (activePromptId === id) {
      const fallback = prompts.find((p) => p.id !== id);
      onChange({ activePromptId: fallback?.id });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <TabHeader title={t.postprocessTitle} subtitle={t.postprocessSubtitle} />

      {/* LLM provider */}
      <section className="space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t.llmProviderLabel}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {llmOptions.map((opt) => {
            const isSelected = activeProvider === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ llmProvider: opt.id })}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-900 border-emerald-500/70 ring-1 ring-emerald-500/40'
                    : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                        isSelected
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700/60'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-100 truncate">{opt.name}</div>
                      <div className="text-[10px] font-mono text-zinc-500 truncate">{opt.model}</div>
                    </div>
                  </div>
                  {opt.keySet ? (
                    <Badge tone="success">✓</Badge>
                  ) : (
                    <Badge tone="warning">нет ключа</Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Key / model config for the active provider */}
        <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
                <Key className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  {llmOptions.find((o) => o.id === activeProvider)?.name} — ключ и модель
                </div>
                <span className="text-[11px] text-zinc-500">
                  {activeProvider === 'openai-compatible'
                    ? 'Любой OpenAI-совместимый сервер (Ollama, LM Studio, vLLM, OpenRouter…). Ключ можно не указывать.'
                    : 'Ключ используется и для распознавания речи, где это применимо.'}
                </span>
              </div>
            </div>
            {llmOptions.find((o) => o.id === activeProvider)?.href && (
              <a
                href={llmOptions.find((o) => o.id === activeProvider)?.href}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                <span>Получить ключ</span>
                <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
              </a>
            )}
          </div>

          {activeProvider === 'openai-compatible' && (
            <Input
              value={settings.customLlmBaseUrl || ''}
              onChange={(e) => onChange({ customLlmBaseUrl: e.target.value.trim() })}
              placeholder="Base URL: http://localhost:11434/v1"
              className="font-mono"
            />
          )}

          <div className="relative flex items-center">
            <Input
              type={showLlmKey ? 'text' : 'password'}
              value={llmKeyFor(activeProvider)}
              onChange={(e) => setLlmKeyFor(activeProvider, e.target.value.trim())}
              placeholder={activeProvider === 'gemini' ? 'AIza...' : activeProvider === 'openai-compatible' ? 'sk-... (необязательно)' : 'API ключ'}
              className="font-mono !pr-9"
            />
            <button
              type="button"
              onClick={() => setShowLlmKey(!showLlmKey)}
              className="absolute right-3 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
              title={showLlmKey ? 'Hide' : 'Show'}
            >
              {showLlmKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <Input
            value={llmModelValue}
            onChange={(e) => handleModelChange(e.target.value.trim())}
            placeholder={activeProvider === 'openai-compatible' ? 'Модель: llama3.2, gpt-4o-mini…' : defaultModelFor(activeProvider)}
            className="font-mono"
          />

          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 pt-0.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Ключ шифруется и хранится только локально.</span>
          </div>
        </div>
        <p className="text-[11px] text-zinc-600">
          При недоступности выбранного провайдера используется запасной (если настроен).
        </p>
      </section>

      {/* New prompt form */}
      <section className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <Sparkles className="w-3.5 h-3.5" /> {t.promptsLabel}
        </div>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t.promptNamePlaceholder}
        />
        <Textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder={t.promptBodyPlaceholder}
          rows={4}
          className="font-mono"
        />
        <Button variant="primary" onClick={handleAddPrompt} disabled={!newName.trim() || !newBody.trim()}>
          <Plus className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {t.addPrompt}
        </Button>
      </section>

      {/* Prompt list */}
      <section className="space-y-2.5">
        {prompts.length === 0 ? (
          <EmptyState icon={Sparkles}>{t.promptsLabel}</EmptyState>
        ) : (
          prompts.map((p) => {
            const isActive = p.id === activePromptId;
            return (
              <div
                key={p.id}
                className={`p-4 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-zinc-900 border-emerald-500/70 ring-1 ring-emerald-500/40'
                    : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Input
                      value={p.name}
                      onChange={(e) => handleUpdatePrompt(p.id, { name: e.target.value })}
                      className="!w-52 font-semibold"
                    />
                    {isActive && (
                      <Badge tone="success">
                        <CheckCircle2 className="w-3 h-3" /> {t.activePrompt}
                      </Badge>
                    )}
                    {p.isDefault && <Badge tone="neutral">default</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <Button variant="success" onClick={() => onChange({ activePromptId: p.id })}>
                        {t.activatePrompt}
                      </Button>
                    )}
                    {!p.isDefault && (
                      <Button variant="danger" onClick={() => handleDeletePrompt(p.id)} title={t.deletePrompt}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <Textarea
                  value={p.body}
                  onChange={(e) => handleUpdatePrompt(p.id, { body: e.target.value })}
                  rows={5}
                  className="font-mono text-[11px] leading-relaxed"
                />
                <div className="flex justify-end mt-1.5">
                  <span className="text-[10px] text-zinc-600 flex items-center gap-1">
                    <Save className="w-3 h-3" /> сохраняется автоматически
                  </span>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
};
