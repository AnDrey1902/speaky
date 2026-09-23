import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Wand2,
  Languages,
  BookmarkCheck,
  History,
  Settings as SettingsIcon,
  Star
} from 'lucide-react';
import { SpeakyLogo } from '../common/SpeakyLogo';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { PostprocessTab } from './PostprocessTab';
import { TranslateTab } from './TranslateTab';
import { SnippetsTab } from './SnippetsTab';
import { HistoryTab } from './HistoryTab';
import { AppSettings, TextSnippet, DictationHistoryItem, PromptTemplate } from '../../types';
import { DEFAULT_PROMPTS } from '../../defaultPrompts';
import { getTranslations } from '../../utils/i18n';
import { BRAND } from '../../brand';

type TabId = 'models' | 'postprocess' | 'translate' | 'snippets' | 'history' | 'general';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [settings, setSettings] = useState<AppSettings>({
    hotkey: 'Ctrl+~',
    mode: 'toggle',
    provider: 'groq',
    uiLanguage: 'auto',
    groqApiKey: '',
    openaiApiKey: '',
    deepgramApiKey: '',
    selectedMicId: 'default',
    autoPunctuation: true,
    removeFillerWords: true,
    contextAwareMode: true,
    soundFeedback: true,
    autoStart: false,
    handsFreeCommands: true,
    aiCorrection: true
  });
  const [snippets, setSnippets] = useState<TextSnippet[]>([]);
  const [history, setHistory] = useState<DictationHistoryItem[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [savedBadge, setSavedBadge] = useState(false);

  const t = getTranslations(settings.uiLanguage);

  useEffect(() => {
    if (!window.speakyAPI) {
      // Browser preview (outside Electron): show default prompt templates
      setPrompts(DEFAULT_PROMPTS);
      setSettings((prev) => ({ ...prev, activePromptId: 'clean-default' }));
      return;
    }
    window.speakyAPI.getSettings().then((s: AppSettings) => s && setSettings(s));
    window.speakyAPI.getSnippets().then((sn: TextSnippet[]) => sn && setSnippets(sn));
    window.speakyAPI.getHistory().then((h: DictationHistoryItem[]) => h && setHistory(h));
    window.speakyAPI.getPrompts?.().then((p: PromptTemplate[]) => p && setPrompts(p));
    const unsubSnippets = window.speakyAPI.onSnippetsChanged?.((sn: TextSnippet[]) => {
      if (sn) setSnippets(sn);
    });
    return () => unsubSnippets?.();
  }, []);

  const flashSaved = () => {
    setSavedBadge(true);
    setTimeout(() => setSavedBadge(false), 1500);
  };

  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    const next = { ...settings, ...updates };
    setSettings(next);
    if (window.speakyAPI) {
      await window.speakyAPI.updateSettings(updates);
      flashSaved();
    }
  };

  const handleSaveSnippets = async (sn: TextSnippet[]) => {
    setSnippets(sn);
    if (window.speakyAPI) {
      await window.speakyAPI.saveSnippets(sn);
      flashSaved();
    }
  };

  const handleSavePrompts = async (p: PromptTemplate[]) => {
    setPrompts(p);
    if (window.speakyAPI) {
      await window.speakyAPI.savePrompts(p);
      flashSaved();
    }
  };

  const handleClearHistory = async () => {
    setHistory([]);
    if (window.speakyAPI) {
      await window.speakyAPI.clearHistory();
    }
  };

  const mainTabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'models', label: t.tabModels, icon: Cpu },
    { id: 'postprocess', label: t.tabPostprocess, icon: Wand2 },
    { id: 'translate', label: t.tabTranslate, icon: Languages },
    { id: 'snippets', label: t.tabSnippets, icon: BookmarkCheck },
    { id: 'history', label: t.tabHistory, icon: History },
    { id: 'general', label: t.tabGeneral, icon: SettingsIcon }
  ];

  const tabButton = (tab: { id: TabId; label: string; icon: React.ElementType }) => {
    const Icon = tab.icon;
    const isActive = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className={`w-full px-3 py-2 rounded-lg flex items-center gap-2.5 text-xs font-medium transition-all cursor-pointer ${
          isActive
            ? 'bg-indigo-500 text-white shadow-[0_0_16px_-6px_rgba(99,102,241,0.8)]'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70'
        }`}
      >
        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-zinc-500'}`} />
        <span>{tab.label}</span>
      </button>
    );
  };

  return (
    <div className="settings-shell w-screen h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden font-sans select-none">
      {/* Titlebar */}
      <div className="h-11 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between px-5 shrink-0 app-drag-region">
        <div className="flex items-center gap-2.5">
          <SpeakyLogo className="w-5 h-5" />
          <span className="text-xs font-semibold tracking-tight text-zinc-100">
            {BRAND.wordmark}
          </span>
          {savedBadge && (
            <span className="text-[10px] text-indigo-300 font-medium bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded-full">
              {t.saved}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 app-no-drag">
          <button
            onClick={() => window.speakyAPI?.minimizeSettings?.()}
            className="w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 flex items-center justify-center transition-colors cursor-pointer"
            title="Свернуть"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button
            onClick={() => window.speakyAPI?.closeSettings?.()}
            className="w-7 h-7 rounded-md text-zinc-500 hover:text-white hover:bg-rose-600 flex items-center justify-center transition-colors cursor-pointer"
            title="Закрыть"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 bg-zinc-900/40 border-r border-zinc-800/80 p-3 flex flex-col shrink-0">
          <div className="space-y-1">{mainTabs.map(tabButton)}</div>

          {/* Bottom section: GitHub */}
          <div className="mt-auto space-y-1 pt-3 border-t border-zinc-800/80">
            <a
              href={BRAND.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full px-3 py-2 rounded-lg flex items-center justify-center gap-2 text-xs font-semibold text-zinc-400 hover:text-amber-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-all cursor-pointer group"
            >
              <Star className="w-3.5 h-3.5 text-amber-500 group-hover:scale-110 transition-transform" />
              <span>Star on GitHub</span>
            </a>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto bg-zinc-950">
          {activeTab === 'general' && (
            <GeneralTab settings={settings} onChange={handleUpdateSettings} />
          )}
          {activeTab === 'models' && <ModelsTab settings={settings} onChange={handleUpdateSettings} />}
          {activeTab === 'postprocess' && (
            <PostprocessTab
              settings={settings}
              onChange={handleUpdateSettings}
              prompts={prompts}
              onSavePrompts={handleSavePrompts}
            />
          )}
          {activeTab === 'translate' && (
            <TranslateTab settings={settings} onChange={handleUpdateSettings} />
          )}
          {activeTab === 'snippets' && (
            <SnippetsTab
              snippets={snippets}
              onSave={handleSaveSnippets}
              uiLanguage={settings.uiLanguage}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab
              history={history}
              onClear={handleClearHistory}
              uiLanguage={settings.uiLanguage}
            />
          )}
        </div>
      </div>
    </div>
  );
};
