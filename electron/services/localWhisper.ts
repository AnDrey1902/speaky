import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { app } from 'electron';
import { TranscriptionResult } from './sttService';
import { getCatalogEntry, getModelsDir, isModelInstalled as isModelInstalledByEntry, findCustomModel } from './modelManager';

let workerProcess: ChildProcess | null = null;
let workerRl: readline.Interface | null = null;
let pendingResolvers: Array<{
  resolve: (val: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}> = [];

function getScriptPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    return path.join(__dirname, '..', 'resources', 'scripts', 'whisper_worker.py');
  }
  return path.join(process.resourcesPath, 'scripts', 'whisper_worker.py');
}

/**
 * Checks whether a local speech engine is available in the system environment.
 * The selected model is honored so a whisper.cpp-only setup can be used offline.
 */
export async function checkLocalWhisperAvailable(modelId?: string): Promise<{ available: boolean; error?: string }> {
  const entry = modelId ? getCatalogEntry(modelId) : undefined;
  const engine = entry?.engine;
  const check = async (requestedEngine: 'faster-whisper' | 'whisper-cpp') => {
    return new Promise<{ available: boolean; error?: string }>((resolve) => {
      const request = JSON.stringify({ action: 'check', engine: requestedEngine });
      const proc = spawn('python', [getScriptPath(), '--check', request], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      proc.stdout?.on('data', (d) => { output += d.toString(); });
      proc.on('close', () => {
        try {
          const data = JSON.parse(output.trim());
          resolve({ available: Boolean(data.available), error: data.error });
        } catch {
          resolve({ available: false, error: 'Не удалось проверить локальный движок' });
        }
      });
      proc.on('error', (err) => resolve({ available: false, error: err.message }));
    });
  };

  if (engine === 'whisper-cpp') return check('whisper-cpp');
  if (engine) return check('faster-whisper');
  const faster = await check('faster-whisper');
  return faster.available ? faster : check('whisper-cpp');
}

/**
 * Spawns or returns existing persistent faster-whisper worker process
 */
function getWorker(): ChildProcess {
  if (workerProcess && !workerProcess.killed) {
    return workerProcess;
  }

  const scriptPath = getScriptPath();
  console.log('[LocalWhisper] Spawning worker from:', scriptPath);

  workerProcess = spawn('python', [scriptPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SPEAKY_MODELS_DIR: getModelsDir() }
  });

  if (workerProcess.stdout) {
    workerRl = readline.createInterface({ input: workerProcess.stdout });
    workerRl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const data = JSON.parse(trimmed);
        const next = pendingResolvers.shift();
        if (next) {
          clearTimeout(next.timer);
          next.resolve(data);
        }
      } catch (err) {
        console.error('[LocalWhisper] Failed to parse worker output:', trimmed, err);
      }
    });
  }

  workerProcess.stderr?.on('data', (data) => {
    console.log(`[LocalWhisper:stderr] ${data.toString().trim()}`);
  });

  workerProcess.on('exit', (code, signal) => {
    console.warn(`[LocalWhisper] Worker exited with code ${code}, signal ${signal}`);
    workerProcess = null;
    workerRl = null;
    // Reject any waiting callers
    while (pendingResolvers.length > 0) {
      const req = pendingResolvers.shift();
      if (req) {
        clearTimeout(req.timer);
        req.reject(new Error('Локальный процесс Whisper внезапно завершился'));
      }
    }
  });

  return workerProcess;
}

/**
 * Sends a JSON command to the worker and waits for JSON line response
 */
function sendWorkerCommand(cmd: Record<string, any>, timeoutMs = 25000): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const worker = getWorker();
      if (!worker.stdin || worker.killed) {
        return reject(new Error('Локальный процесс распознавания не готов'));
      }

      const timer = setTimeout(() => {
        const idx = pendingResolvers.findIndex(p => p.timer === timer);
        if (idx !== -1) {
          pendingResolvers.splice(idx, 1);
        }
        reject(new Error('Таймаут локального распознавания'));
      }, timeoutMs);

      pendingResolvers.push({ resolve, reject, timer });
      worker.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Transcribe an audio buffer locally using faster-whisper
 */
export async function transcribeAudioLocal(
  audioBuffer: Buffer,
  mimeType = 'audio/wav',
  language = 'ru',
  modelId?: string
): Promise<TranscriptionResult> {
  const startTime = Date.now();
  const ext = mimeType.includes('webm') ? '.webm' : '.wav';
  const tempPath = path.join(os.tmpdir(), `speaky_local_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  // Resolve engine + model path: custom folder first, then the Speaky catalog
  const custom = modelId ? findCustomModel(modelId) : undefined;
  const entry = custom ? undefined : getCatalogEntry(modelId || 'whisper-large-v3-turbo');
  const engine = custom?.engine || entry?.engine || 'faster-whisper';
  const resolvedId = custom?.id || entry?.id || modelId || 'whisper-small';
  const engineModelId = custom?.engineModelId || entry?.engineModelId;
  let modelPath: string | undefined;
  if (custom) {
    modelPath = custom.path;
  } else if (entry && isModelInstalledByEntry(entry)) {
    modelPath = path.join(getModelsDir(), entry.engine, entry.id);
  }

  try {
    await fs.promises.writeFile(tempPath, audioBuffer);

    const res = await sendWorkerCommand({
      action: 'transcribe',
      path: tempPath,
      language,
      engine,
      modelId: resolvedId,
      engineModelId,
      modelPath
    }, 60000);

    if (res.status !== 'ok') {
      throw new Error(res.message || 'Ошибка локального распознавания');
    }

    const latencyMs = Date.now() - startTime;
    return {
      text: (res.text || '').trim(),
      durationSeconds: res.duration || 0,
      latencyMs
    };
  } finally {
    // Clean up temporary audio file asynchronously
    fs.promises.unlink(tempPath).catch(() => {});
  }
}

/**
 * Terminates the worker process on app exit
 */
export function shutdownLocalWhisper(): void {
  if (workerProcess && !workerProcess.killed) {
    try {
      workerProcess.kill();
    } catch {}
    workerProcess = null;
  }
}
