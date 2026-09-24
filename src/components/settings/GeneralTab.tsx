import React, { useState, useEffect } from 'react';
import { AppSettings } from '../../types';
import { Keyboard, Mic, Sparkles, Volume2, Power, RefreshCw, CheckCircle2, ArrowDownToLine, Languages, Globe } from 'lucide-react';
import packageJson from '../../../package.json';
import { getTranslations } from '../../utils/i18n';
import { Badge, Button, ProgressBar, Select, SettingRow, Switch, TabHeader } from '../common/ui';
import { HotkeyInput } from '../common/HotkeyInput';

interface GeneralTabProps {
  settings: AppSettings;
  onChange: (updates: Partial<AppSettings>) => void;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({ settings, onChange }) => {
  const t = getTranslations(settings.uiLanguage);

  const [updateState, setUpdateState] = useState<{
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    version: string;
    latestVersion?: string;
    progressPercent?: number;
    error?: string;
  }>({
    status: 'idle',
    version: packageJson.version || '1.1.0'
  });

  useEffect(() => {
    (window as any).speakyAPI?.getUpdateStatus?.().then((res: any) => {
      if (res) setUpdateState(res);
    });

    const unsub = (window as any).speakyAPI?.onUpdateStatusChanged?.((status: any) => {
      if (status) setUpdateState(status);
    });

    return () => unsub?.();
  }, []);

  const handleCheckUpdates = async () => {
    try {
      const res = await (window as any).speakyAPI?.checkForUpdates?.();
      if (res) setUpdateState(res);
    } catch {}
  };

  const handleDownload = async () => {
    try {
      await (window as any).speakyAPI?.downloadUpdate?.();
    } catch {}
  };

  const handleInstall = () => {
    (window as any).speakyAPI?.installUpdate?.();
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <TabHeader title={t.generalTitle} subtitle={t.generalSubtitle} />

      {/* Interface language */}
      <SettingRow icon={Globe} title={t.uiLangTitle} desc={t.uiLangDesc}>
        <Select
          value={settings.uiLanguage || 'auto'}
          onChange={(e) => onChange({ uiLanguage: e.target.value as any })}
        >
          <option value="auto">🌐 {t.uiLangAuto}</option>
          <option value="ru">🇷🇺 Русский</option>
          <option value="uk">🇺🇦 Українська</option>
          <option value="en">🇬🇧 English</option>
          <option value="es">🇪🇸 Español</option>
          <option value="de">🇩🇪 Deutsch</option>
          <option value="fr">🇫🇷 Français</option>
          <option value="it">🇮🇹 Italiano</option>
          <option value="zh">🇨🇳 中文</option>
        </Select>
      </SettingRow>

      {/* Speech language */}
      <SettingRow
        icon={Languages}
        title={t.speechLangTitle}
        desc={
          settings.language === 'en'
            ? t.speechLangDescEn
            : settings.language === 'auto'
            ? t.speechLangDescAuto
            : t.speechLangDescRu
        }
      >
        <div className="flex bg-zinc-800 p-1 rounded-lg border border-zinc-700/70 shrink-0">
          {(['ru', 'en', 'auto'] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => onChange({ language: lang })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                (settings.language || 'ru') === lang
                  ? 'bg-zinc-600 text-white shadow-sm font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {lang === 'auto' ? t.uiLangAuto.split(' ')[0] : lang.toUpperCase()}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* Hotkey */}
      <SettingRow icon={Keyboard} title={t.hotkeyTitle} desc={t.hotkeyDesc}>
        <HotkeyInput
          value={settings.hotkey}
          onChange={(accel) => onChange({ hotkey: accel })}
          avoid={[settings.translateHotkey || '']}
          placeholder="Ctrl+~"
        />
      </SettingRow>

      {/* Push-to-talk mode */}
      <SettingRow
        icon={Mic}
        title={t.pttTitle}
        desc={t.pttDesc}
      >
        <div className="flex bg-zinc-800 p-1 rounded-lg border border-zinc-700/70 shrink-0">
          <button
            onClick={() => onChange({ mode: 'toggle' })}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              settings.mode === 'toggle' ? 'bg-zinc-600 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Toggle
          </button>
          <button
            onClick={() => onChange({ mode: 'ptt' })}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
              settings.mode === 'ptt' ? 'bg-zinc-600 text-white font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            PTT
          </button>
        </div>
      </SettingRow>

      {/* AI correction */}
      <SettingRow
        icon={Sparkles}
        title={t.aiCorrectionTitle}
        desc={t.aiCorrectionDesc}
      >
        <div className="flex items-center gap-2">
          <Badge tone="accent">
            <Sparkles className="w-3 h-3" /> LLM
          </Badge>
          <Switch
            checked={settings.aiCorrection !== false}
            onChange={(v) => onChange({ aiCorrection: v, removeFillerWords: v })}
          />
        </div>
      </SettingRow>

      {/* Sound */}
      <SettingRow icon={Volume2} title={t.soundTitle} desc={t.soundDesc}>
        <Switch checked={settings.soundFeedback} onChange={(v) => onChange({ soundFeedback: v })} />
      </SettingRow>

      {/* Autostart */}
      <SettingRow icon={Power} title={t.autoStartTitle} desc={t.autoStartDesc}>
        <Switch checked={settings.autoStart} onChange={(v) => onChange({ autoStart: v })} />
      </SettingRow>

      {/* Updates card */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/70 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
              <RefreshCw className={`w-4 h-4 ${updateState.status === 'checking' ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-100">{t.versionLabel}</span>
                <Badge tone="neutral">v{updateState.version}</Badge>
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {updateState.status === 'checking' && t.checkingUpdates}
                {updateState.status === 'not-available' && t.updateLatest}
                {updateState.status === 'available' && `${t.updateAvailable} v${updateState.latestVersion}`}
                {updateState.status === 'downloading' && `${t.downloadingUpdate} ${updateState.progressPercent || 0}%`}
                {updateState.status === 'downloaded' && `${t.updateAvailable} v${updateState.latestVersion} — готово к установке`}
                {updateState.status === 'error' && (
                  <span className="text-amber-400 font-medium">{updateState.error || t.updateError}</span>
                )}
                {updateState.status === 'idle' && `${t.updatesTitle} • GitHub Releases`}
              </div>
            </div>
          </div>

          <div>
            {updateState.status === 'available' ? (
              <Button variant="primary" onClick={handleDownload}>
                <ArrowDownToLine className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                {t.downloadUpdate}
              </Button>
            ) : updateState.status === 'downloaded' ? (
              <Button variant="success" onClick={handleInstall}>
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                {t.installRestart}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={handleCheckUpdates}
                disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
              >
                {updateState.status === 'checking' ? t.checkingUpdates : t.checkUpdates}
              </Button>
            )}
          </div>
        </div>

        {updateState.status === 'downloading' && (
          <ProgressBar value={updateState.progressPercent || 0} />
        )}
      </div>
    </div>
  );
};
