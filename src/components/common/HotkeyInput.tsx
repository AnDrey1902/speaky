import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface HotkeyInputProps {
  /** current accelerator, e.g. 'Ctrl+Shift+`' */
  value: string;
  onChange: (accelerator: string) => void;
  /** other accelerator(s) that must not collide */
  avoid?: string[];
  placeholder?: string;
  className?: string;
}

const KEY_LABELS: Record<string, string> = {
  '`': '`',
  '~': '~',
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const MODIFIER_KEYS = new Set([
  'Control', 'ControlLeft', 'ControlRight',
  'Shift', 'ShiftLeft', 'ShiftRight',
  'Alt', 'AltLeft', 'AltRight', 'AltGraph',
  'Meta', 'MetaLeft', 'MetaRight',
]);

function normalizeKeyName(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (/^F\d{1,2}$/.test(key)) return key;
  if (key === 'Delete') return 'Del';
  if (key === 'Insert') return 'Ins';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Canonical Electron accelerator; null while only modifiers are held */
function buildAccelerator(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const key = normalizeKeyName(e.key);
  if (MODIFIER_KEYS.has(e.key)) return null;

  const isMac = typeof process !== 'undefined' && process.platform === 'darwin';
  const useMeta = e.metaKey;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push(isMac ? 'CommandOrControl' : 'Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (useMeta) parts.push(isMac ? 'CommandOrControl' : 'Super');
  // Bare key without modifiers: still allow (F-keys, letters) — Electron handles it
  parts.push(key);
  return parts.join('+');
}

/**
 * Hotkey recorder: click, press a combination, done.
 * Validates availability via Electron globalShortcut (when running in Electron)
 * and rejects collisions with other app actions (`avoid`).
 */
export const HotkeyInput: React.FC<HotkeyInputProps> = ({
  value,
  onChange,
  avoid = [],
  placeholder = 'Ctrl+~',
  className = '',
}) => {
  const [recording, setRecording] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okFlash, setOkFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep latest props reachable from native listeners without re-subscribing
  const propsRef = useRef({ onChange, avoid });
  propsRef.current = { onChange, avoid };

  useEffect(() => {
    if (!recording) return;
    let active = true;

    const finish = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', blockUp, true);
      window.removeEventListener('blur', onBlur);
    };

    const onBlur = () => {
      finish();
      setRecording(false);
    };

    const blockUp = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault(); // swallow browser defaults while recording
      if (e.key === 'Escape') {
        finish();
        setRecording(false);
        return;
      }
      const accel = buildAccelerator(e);
      if (!accel) return; // only a modifier pressed so far

      finish();
      setRecording(false);
      void (async () => {
        const { onChange: commit, avoid: avoidList } = propsRef.current;
        if (avoidList.filter(Boolean).includes(accel)) {
          setError('Это сочетание уже занято другим действием Speaky');
          return;
        }
        setError(null);
        if (window.speakyAPI?.checkHotkey) {
          setChecking(true);
          try {
            const res = await window.speakyAPI.checkHotkey(accel);
            if (!res.available) {
              setError(res.error || 'Сочетание занято системой');
              return;
            }
          } catch {
            /* validation unavailable — accept the combo */
          } finally {
            setChecking(false);
          }
        }
        commit(accel);
        setOkFlash(true);
        setTimeout(() => setOkFlash(false), 1200);
      })();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', blockUp, true);
    window.addEventListener('blur', onBlur);
    return finish;
  }, [recording]);

  const startRecording = () => {
    if (recording) return;
    setError(null);
    setRecording(true);
    inputRef.current?.focus();
  };

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        {(checking || recording) && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />}
        <div
          className={`relative flex items-center rounded-lg border transition-all cursor-pointer ${
            recording
              ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/40'
              : error
              ? 'border-rose-500/60 bg-zinc-800'
              : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
          }`}
          onMouseDown={startRecording}
          title="Нажмите и задайте сочетание клавиш (Esc — отмена)"
        >
          <Keyboard
            className={`w-3.5 h-3.5 absolute left-2 pointer-events-none ${
              recording ? 'text-indigo-300' : 'text-zinc-500'
            }`}
          />
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={recording ? 'Нажмите сочетание…' : value || ''}
            placeholder={placeholder}
            className="w-36 px-3 py-1.5 pl-8 rounded-lg bg-transparent text-center font-mono text-xs font-bold text-zinc-100 placeholder-zinc-500 focus:outline-none cursor-pointer select-none"
          />
        </div>
      </div>
      {error && (
        <span className="flex items-center gap-1 text-[10px] text-rose-400">
          <AlertCircle className="w-3 h-3" /> {error}
        </span>
      )}
      {!error && okFlash && (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
          <CheckCircle2 className="w-3 h-3" /> Сохранено
        </span>
      )}
    </div>
  );
};

export default HotkeyInput;
