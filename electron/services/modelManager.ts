import path from 'path';
import fs from 'fs';
import { app, net } from 'electron';
import { CustomLocalModel, InstalledModelInfo, ModelEngine, ModelProgressEvent } from '../../src/types';
import { MODEL_CATALOG, getCatalogEntry } from '../../src/modelCatalog';
import { storage } from './storage';

export { MODEL_CATALOG, getCatalogEntry };

/**
 * Speaky local model manager (whisper.cpp edition).
 * Models are single-file ggml checkpoints downloaded directly from HuggingFace
 * into userData/models/whisper.cpp/. The engine binary itself ships with the
 * app (resources/whisper) — nothing to install, no Python.
 */

export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

function whisperModelsDir(): string {
  return path.join(getModelsDir(), 'whisper.cpp');
}

/** Path to the bundled whisper-cli binary shipped in resources/whisper */
export function getWhisperCliPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '..', 'resources', 'whisper', 'win-x64', 'whisper-cli.exe');
  }
  return path.join(process.resourcesPath, 'whisper', 'win-x64', 'whisper-cli.exe');
}

export function isWhisperCliAvailable(): boolean {
  try {
    return fs.existsSync(getWhisperCliPath());
  } catch {
    return false;
  }
}

/** Directory holding the bundled transcribe.cpp native libraries */
export function getTranscribeDllDir(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '..', 'resources', 'transcribe', 'win-x64');
  }
  return path.join(process.resourcesPath, 'transcribe', 'win-x64');
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
  // Both engines store single model files under userData/models/<engine>/<id>/
  return path.join(getModelsDir(), entry.engine, entry.id);
}

function ggmlFileOf(entry: ModelCatalogEntry): string {
  return entry.hfFile || `${entry.id}.bin`;
}

/** Engine of whichever model getInstalledModelPath() would resolve to */
export function getInstalledModelEngine(modelId?: string): 'whisper.cpp' | 'transcribe.cpp' | undefined {
  const entry = modelId ? getCatalogEntry(modelId) : undefined;
  if (entry && isModelInstalled(entry)) return entry.engine as 'whisper.cpp' | 'transcribe.cpp';
  for (const e of MODEL_CATALOG) {
    if (isModelInstalled(e)) return e.engine as 'whisper.cpp' | 'transcribe.cpp';
  }
  return undefined;
}

export function isModelInstalled(entry: ModelCatalogEntry): boolean {
  try {
    const file = path.join(modelDir(entry), ggmlFileOf(entry));
    return fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024;
  } catch {
    return false;
  }
}

/** Absolute path to the ggml model file if installed */
export function getInstalledModelPath(modelId?: string): string | undefined {
  const entry = modelId ? getCatalogEntry(modelId) : undefined;
  if (entry && isModelInstalled(entry)) {
    return path.join(modelDir(entry), ggmlFileOf(entry));
  }
  // Fall back to any installed catalog model
  for (const e of MODEL_CATALOG) {
    if (isModelInstalled(e)) {
      return path.join(modelDir(e), ggmlFileOf(e));
    }
  }
  return undefined;
}

export function getCatalogStatus(): InstalledModelInfo[] {
  const catalog = MODEL_CATALOG.map((entry) => {
    const dir = modelDir(entry);
    const installed = isModelInstalled(entry);
    return {
      ...entry,
      installed,
      path: installed ? path.join(dir, ggmlFileOf(entry)) : undefined,
      sizeOnDiskMB: installed ? Math.round(fs.statSync(path.join(dir, ggmlFileOf(entry))).size / 1048576) : undefined
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

/* ── Custom models (user-picked ggml files/folders) ──────────────── */

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
  // Single-file model: ggml (whisper.cpp) or gguf (transcribe.cpp)
  if (files.some((f) => f.endsWith('.gguf'))) return 'transcribe.cpp';
  if (files.some((f) => f.endsWith('.bin'))) return 'whisper.cpp';
  return undefined;
}

export function validateModelFolder(dir: string): { ok: boolean; error?: string; engine?: ModelEngine } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return { ok: false, error: 'Путь не найден' };
  }
  // A single model file (gguf/bin) is accepted as-is
  if (stat.isFile()) {
    const lower = dir.toLowerCase();
    if (lower.endsWith('.gguf')) return { ok: true, engine: 'transcribe.cpp' };
    if (lower.endsWith('.bin')) return { ok: true, engine: 'whisper.cpp' };
    return { ok: false, error: 'Нужен файл *.gguf (transcribe.cpp) или *.bin (whisper.cpp)' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'Выбранный путь — не папка' };

  const files = listFilesShallow(dir);
  const hasGguf = files.some((f) => f.endsWith('.gguf'));
  const hasGgml = files.some((f) => f.endsWith('.bin'));
  if (!hasGguf && !hasGgml) {
    return {
      ok: false,
      error: 'Не удалось определить модель. Нужен файл *.gguf (transcribe.cpp) или *.bin (whisper.cpp)'
    };
  }
  return { ok: true, engine: hasGguf ? 'transcribe.cpp' : 'whisper.cpp' };
}

export function registerCustomModel(model: CustomLocalModel): { ok: boolean; error?: string } {
  const check = validateModelFolder(model.path);
  if (!check.ok) return { ok: false, error: check.error };
  const detectedEngine = check.engine;

  const list = [...(storage.getSettings().customLocalModels || [])];
  if (list.some((m) => m.path === model.path)) {
    return { ok: false, error: 'Эта папка уже подключена' };
  }

  list.push({
    id: model.id,
    name: model.name || path.basename(model.path),
    path: model.path,
    engine: detectedEngine || detectEngineFromFolder(model.path) || 'whisper.cpp',
    engineModelId: undefined
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

/** Find the model file (ggml .bin or gguf .gguf) inside a custom model folder */
export function resolveCustomModelFile(custom: CustomLocalModel): string | undefined {
  try {
    const stat = fs.statSync(custom.path);
    const lower = custom.path.toLowerCase();
    if (stat.isFile() && (lower.endsWith('.bin') || lower.endsWith('.gguf'))) return custom.path;
    const found = fs.readdirSync(custom.path).find((f) => {
      const fl = f.toLowerCase();
      return fl.endsWith('.gguf') || fl.endsWith('.bin');
    });
    return found ? path.join(custom.path, found) : undefined;
  } catch {
    return undefined;
  }
}

/* ── Download (Node-side, killable, no Python) ────────────────────── */

let activeDownload: { cancel: () => void } | null = null;

export function downloadModel(
  modelId: string,
  onProgress: (ev: ModelProgressEvent) => void
): { promise: Promise<void>; cancel: () => void } {
  const entry = getCatalogEntry(modelId);
  if (!entry || !entry.huggingfaceId) {
    return { promise: Promise.reject(new Error(`Unknown model: ${modelId}`)), cancel: () => {} };
  }

  const dest = path.join(modelDir(entry), ggmlFileOf(entry));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partFile = dest + '.part';

  let request: Electron.ClientRequest | null = null;
  let settled = false;
  let cancelled = false;

  const promise = new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      activeDownload = null;
      try {
        if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
      } catch {}
      if (cancelled) {
        onProgress({ modelId, state: 'error', error: 'Скачивание отменено' });
        reject(new Error('Скачивание отменено'));
      } else if (err) {
        onProgress({ modelId, state: 'error', error: err.message });
        reject(err);
      } else {
        onProgress({ modelId, state: 'done', percent: 100 });
        resolve();
      }
    };

    try {
      const url = `https://huggingface.co/${entry.huggingfaceId}/resolve/main/${ggmlFileOf(entry)}`;
      request = net.request({ url, redirect: 'follow' });
      request.setHeader('User-Agent', 'Speaky/1.0');

      let received = 0;
      const total = entry.sizeMB * 1048576;
      let lastEmit = 0;
      const fileStream = fs.createWriteStream(partFile);

      request.on('response', (response) => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          fileStream.close();
          finish(new Error(`HuggingFace вернул HTTP ${status}`));
          return;
        }
        const lenHeader = parseInt(response.headers['content-length'] as string, 10);
        const totalKnown = Number.isFinite(lenHeader) && lenHeader > 0 ? lenHeader : total;

        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          fileStream.write(chunk);
          const now = Date.now();
          if (now - lastEmit > 250 || received >= totalKnown) {
            lastEmit = now;
            onProgress({
              modelId,
              state: 'downloading',
              percent: Math.min(99.5, Math.round((received / totalKnown) * 1000) / 10),
              receivedMB: Math.round(received / 1048576 * 10) / 10
            });
          }
        });

        response.on('end', () => {
          fileStream.end(() => {
            if (cancelled) return finish();
            try {
              fs.renameSync(partFile, dest);
              finish();
            } catch (err: any) {
              finish(err);
            }
          });
        });

        response.on('error', (err: any) => {
          fileStream.close();
          finish(err);
        });
      });

      request.on('error', (err: any) => {
        fileStream.close();
        finish(err);
      });

      request.end();
    } catch (err: any) {
      finish(err);
    }
  });

  activeDownload = {
    cancel: () => {
      cancelled = true;
      try {
        request?.abort();
      } catch {}
    }
  };

  return { promise, cancel: () => activeDownload?.cancel() };
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
