import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { CustomLocalModel, InstalledModelInfo, ModelEngine, ModelProgressEvent } from '../../src/types';
import { MODEL_CATALOG, getCatalogEntry } from '../../src/modelCatalog';
import { storage } from './storage';

export { MODEL_CATALOG, getCatalogEntry };

/**
 * Speaky local model manager.
 * Catalog of downloadable speech models + download/remove/inspect logic.
 * Downloads run in a one-shot python worker process (killable).
 */

export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

function getScriptPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '..', 'resources', 'scripts', 'whisper_worker.py');
  }
  return path.join(process.resourcesPath, 'scripts', 'whisper_worker.py');
}

function pythonEnv(): NodeJS.ProcessEnv {
  return { ...process.env, SPEAKY_MODELS_DIR: getModelsDir() };
}

function dirSizeMB(dir: string): number {
  let bytes = 0;
  try {
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          try {
            bytes += fs.statSync(full).size;
          } catch {}
        }
      }
    };
    walk(dir);
  } catch {}
  return Math.round((bytes / 1048576) * 10) / 10;
}

function modelDir(entry: ModelCatalogEntry): string {
  return path.join(getModelsDir(), entry.engine, entry.id);
}

export function isModelInstalled(entry: ModelCatalogEntry): boolean {
  const dir = modelDir(entry);
  try {
    if (fs.existsSync(path.join(dir, '.installed'))) return true;
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export function getCatalogStatus(): InstalledModelInfo[] {
  const catalog = MODEL_CATALOG.map((entry) => {
    const dir = modelDir(entry);
    const installed = isModelInstalled(entry);
    return {
      ...entry,
      installed,
      path: installed ? dir : undefined,
      sizeOnDiskMB: installed ? dirSizeMB(dir) : undefined
    };
  });

  const custom = (storage.getSettings().customLocalModels || []).map((m) => ({
    id: m.id,
    name: m.name,
    engine: m.engine,
    engineModelId: m.engineModelId,
    languages: ['custom'],
    sizeMB: dirSizeMB(m.path),
    description: m.path,
    requires: m.engine,
    installed: fs.existsSync(m.path),
    path: m.path,
    sizeOnDiskMB: fs.existsSync(m.path) ? dirSizeMB(m.path) : undefined,
    isCustom: true
  }));

  return [...catalog, ...custom];
}

/* ── Custom models (user-picked folders) ──────────────────────────── */

function listFilesShallow(dir: string): string[] {
  try {
    return fs.readdirSync(dir).map((n) => n.toLowerCase());
  } catch {
    return [];
  }
}

/** Best-effort engine detection by folder contents */
export function detectEngineFromFolder(dir: string): ModelEngine | undefined {
  const files = listFilesShallow(dir);
  if (files.length === 0) return undefined;
  if (files.includes('tokens.txt') || (files.includes('encoder.onnx') && files.includes('joiner.onnx'))) {
    return 'sherpa-onnx';
  }
  if (files.includes('model.bin') && files.includes('config.json')) {
    return 'faster-whisper';
  }
  if (files.some((f) => f.endsWith('.onnx'))) {
    return 'onnx-asr';
  }
  return undefined;
}

export function validateModelFolder(dir: string): { ok: boolean; error?: string; engine?: ModelEngine } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, error: 'Папка не найдена' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'Выбранный путь — не папка' };
  if (listFilesShallow(dir).length === 0) return { ok: false, error: 'Папка пуста' };
  const engine = detectEngineFromFolder(dir);
  if (!engine) {
    return {
      ok: false,
      error: 'Не удалось определить движок. Нужны файлы faster-whisper (model.bin+config.json), sherpa-onnx (tokens.txt) или onnx-asr (*.onnx)'
    };
  }
  return { ok: true, engine };
}

export function registerCustomModel(model: CustomLocalModel): { ok: boolean; error?: string } {
  const check = validateModelFolder(model.path);
  if (!check.ok) return { ok: false, error: check.error };

  const list = [...(storage.getSettings().customLocalModels || [])];
  if (list.some((m) => m.path === model.path)) {
    return { ok: false, error: 'Эта папка уже подключена' };
  }

  list.push({
    id: model.id,
    name: model.name || path.basename(model.path),
    path: model.path,
    engine: model.engine || check.engine!,
    engineModelId: model.engineModelId || undefined
  });
  storage.updateSettings({ customLocalModels: list });
  return { ok: true };
}

export function unregisterCustomModel(modelId: string): { ok: boolean; error?: string } {
  const list = (storage.getSettings().customLocalModels || []).filter((m) => m.id !== modelId);
  storage.updateSettings({ customLocalModels: list });
  return { ok: true };
}

export function findCustomModel(modelId: string): CustomLocalModel | undefined {
  return (storage.getSettings().customLocalModels || []).find((m) => m.id === modelId);
}

/** Spawn python one-shot: killable download with progress events */
export function downloadModel(
  modelId: string,
  onProgress: (ev: ModelProgressEvent) => void
): { promise: Promise<void>; cancel: () => void } {
  const entry = getCatalogEntry(modelId);
  if (!entry) {
    return { promise: Promise.reject(new Error(`Unknown model: ${modelId}`)), cancel: () => {} };
  }

  const req = JSON.stringify({
    action: 'download',
    modelId: entry.id,
    engine: entry.engine,
    huggingfaceId: entry.huggingfaceId,
    engineModelId: entry.engineModelId
  });

  const proc = spawn('python', [getScriptPath(), '--download', req], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: pythonEnv()
  });

  let settled = false;
  let stderrBuf = '';

  const promise = new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) {
        onProgress({ modelId, state: 'error', error: err.message });
        reject(err);
      } else {
        onProgress({ modelId, state: 'done', percent: 100 });
        resolve();
      }
    };

    proc.stdout?.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed);
          if (data.status === 'progress') {
            onProgress({
              modelId,
              state: 'downloading',
              percent: data.percent,
              receivedMB: data.receivedMB
            });
          } else if (data.status === 'ok') {
            finish();
          } else if (data.status === 'error') {
            finish(new Error(data.message || 'Ошибка скачивания'));
          }
        } catch {
          /* non-JSON line: ignore */
        }
      }
    });

    proc.stderr?.on('data', (d) => {
      stderrBuf += d.toString();
    });

    proc.on('error', (err) => finish(err));
    proc.on('exit', (code) => {
      if (code !== 0) {
        const hint = stderrBuf.split('\n').filter(Boolean).slice(-3).join(' | ');
        finish(new Error(`Скачивание прервано (код ${code})${hint ? ': ' + hint : ''}`));
      } else if (!settled) {
        finish();
      }
    });
  });

  return { promise, cancel: () => { try { proc.kill(); } catch {} } };
}

export function removeModel(modelId: string): void {
  // Custom models: unregister only — never delete a user-owned folder
  if (findCustomModel(modelId)) {
    unregisterCustomModel(modelId);
    return;
  }
  const entry = getCatalogEntry(modelId);
  if (!entry) throw new Error(`Unknown model: ${modelId}`);
  const dir = modelDir(entry);
  const modelsDir = getModelsDir();
  // Guard: never delete anything outside the models directory
  if (!path.resolve(dir).startsWith(path.resolve(modelsDir))) {
    throw new Error('Refusing to delete outside models dir');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Check whether a python engine dependency is importable */
export function checkEngine(engine: ModelEngine): Promise<{ available: boolean; error?: string; hint?: string }> {
  return new Promise((resolve) => {
    const req = JSON.stringify({ action: 'check', engine });
    const proc = spawn('python', [getScriptPath(), '--check', req], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: pythonEnv()
    });

    let done = false;
    const settle = (res: { available: boolean; error?: string; hint?: string }) => {
      if (done) return;
      done = true;
      resolve(res);
    };

    proc.stdout?.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed);
          if (data.status === 'ok') {
            settle({ available: Boolean(data.available), error: data.error, hint: data.hint });
          }
        } catch {}
      }
    });
    proc.on('error', (err) => settle({ available: false, error: err.message }));
    proc.on('exit', () => settle({ available: false, error: 'Python не найден' }));
  });
}
