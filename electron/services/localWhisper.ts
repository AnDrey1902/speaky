import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { Worker } from 'worker_threads';
import { TranscriptionResult } from './sttService';
import { storage } from './storage';
import {
  getWhisperCliPath,
  getWhisperServerPath,
  getTranscribeDllDir,
  isWhisperCliAvailable,
  getInstalledModelPath,
  getInstalledModelEngine,
  findCustomModel,
  resolveCustomModelFile
} from './modelManager';

/**
 * Local transcription orchestrator. Two bundled engines, no Python:
 *  - whisper.cpp   → spawns bundled whisper-cli.exe (one process per dictation)
 *  - transcribe.cpp → worker thread keeps transcribe.dll + model in RAM (fast warm runs)
 * Input: 16kHz mono PCM WAV (produced by the renderer recorder).
 */

const RUN_TIMEOUT_MS = 120000;

export async function checkLocalWhisperAvailable(): Promise<{ available: boolean; error?: string }> {
  if (!getInstalledModelPath()) {
    return { available: false, error: 'Локальная модель не скачана (Настройки → Модели)' };
  }
  return { available: true };
}

/* ── Engine resolution ────────────────────────────────────────────── */

function resolveModel(
  modelId?: string
): { file: string; engine: 'whisper.cpp' | 'transcribe.cpp' } | undefined {
  const custom = modelId ? findCustomModel(modelId) : undefined;
  if (custom) {
    const file = resolveCustomModelFile(custom);
    if (file) {
      // Custom gguf files run on transcribe.cpp; legacy .bin on whisper.cpp
      const isGguf = file.toLowerCase().endsWith('.gguf');
      return { file, engine: isGguf ? 'transcribe.cpp' : 'whisper.cpp' };
    }
  }
  const installed = getInstalledModelPath(modelId);
  if (installed) {
    const engine = getInstalledModelEngine(modelId) || 'whisper.cpp';
    return { file: installed, engine };
  }
  return undefined;
}

/* ── transcribe.cpp (koffi worker) ─────────────────────────────────── */

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: Worker | null = null;
let workerReady = false;
let pending: PendingRequest | null = null;
let seqCounter = 0;

function getWorker(): Promise<Worker> {
  if (worker) return Promise.resolve(worker);
  const dllDir = getTranscribeDllDir();
  if (!fs.existsSync(path.join(dllDir, 'transcribe.dll'))) {
    return Promise.reject(new Error('transcribe.dll не найден в комплекте приложения'));
  }
  return new Promise((resolve, reject) => {
    const workerPath = process.env.SPEAKY_TRANSCRIBE_WORKER || path.join(__dirname, 'transcribeWorker.js');
    const w = new Worker(workerPath, {
      workerData: { dllDir }
    });
    let settled = false;
    w.on('message', (msg: any) => {
      if (msg.type === 'hello') {
        if (!settled) { settled = true; resolve(w); }
      } else if (msg.type === 'ready') {
        workerReady = true;
        if (!settled) { settled = true; resolve(w); }
      } else if (msg.type === 'error') {
        if (!settled) { settled = true; reject(new Error(msg.message)); }
        else if (pending) {
          clearTimeout(pending.timer);
          const p = pending;
          pending = null;
          p.reject(new Error(msg.message));
        }
      } else if (msg.type === 'result' || msg.type === 'closed') {
        if (pending) {
          clearTimeout(pending.timer);
          const p = pending;
          pending = null;
          if (msg.type === 'result') p.resolve(msg);
          else p.resolve({ text: '', detectedLanguage: '', backend: '' });
        }
      }
    });
    w.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
      worker = null;
      workerReady = false;
    });
    w.on('exit', () => {
      if (worker === w) { worker = null; workerReady = false; }
      if (pending) {
        clearTimeout(pending.timer);
        const p = pending;
        pending = null;
        p.reject(new Error('Движок transcribe.cpp остановлен'));
      }
    });
    worker = w;
  });
}

function stopWorker(): void {
  if (worker) {
    const w = worker;
    worker = null;
    workerReady = false;
    w.postMessage({ type: 'close' });
    setTimeout(() => { try { w.terminate(); } catch {} }, 2000).unref?.();
  }
}

/** Serialize engine ops: one open/run at a time (0.x library limitation anyway) */
let engineChain: Promise<unknown> = Promise.resolve();
function withEngineLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = engineChain.then(fn, fn);
  engineChain = run.catch(() => {});
  return run;
}

async function transcribeWithTranscribeCpp(
  modelFile: string,
  samples: Float32Array,
  language: string
): Promise<{ text: string; backend: string }> {
  return withEngineLock(async () => {
    const w = await getWorker();

    const result = await new Promise<any>((resolve, reject) => {
      const prevPending = pending;
      if (prevPending) {
        clearTimeout(prevPending.timer);
        prevPending.reject(new Error('Прервано новым запросом'));
      }
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error('Таймаут распознавания transcribe.cpp'));
      }, RUN_TIMEOUT_MS);
      pending = { resolve, reject, timer };
      w.postMessage({ type: 'open', modelPath: modelFile, language });
      w.postMessage({ type: 'run', samples, seq: ++seqCounter });
    });

    return { text: String(result.text || ''), backend: String(result.backend || '') };
  });
}

/* ── WAV decoding (shared by both engines) ─────────────────────────── */

function decodeWavToMono16k(
  buffer: Buffer
): { samples: Float32Array; sampleRate: number; channels: number; bits: number } | undefined {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  let pos = 12, fmt: any = null, data: Buffer | undefined;
  while (pos < buffer.length - 8) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const sz = buffer.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(pos + 8),
        ch: buffer.readUInt16LE(pos + 10),
        rate: buffer.readUInt32LE(pos + 12),
        bits: buffer.readUInt16LE(pos + 22)
      };
    } else if (id === 'data') {
      data = buffer.subarray(pos + 8, pos + 8 + sz);
      break;
    }
    pos += 8 + sz + (sz & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) return undefined;

  let samples = new Float32Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  if (fmt.ch > 1) {
    const mono = new Float32Array(Math.floor(samples.length / fmt.ch));
    for (let i = 0; i < mono.length; i++) {
      let acc = 0;
      for (let c = 0; c < fmt.ch; c++) acc += samples[i * fmt.ch + c];
      mono[i] = acc / fmt.ch;
    }
    samples = mono;
  }
  return { samples, sampleRate: fmt.rate, channels: fmt.ch, bits: fmt.bits };
}

/** Simple linear resampler to 16kHz (sufficient for speech, no deps) */
function resampleLinear(samples: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return samples;
  const ratio = 16000 / fromRate;
  const outLen = Math.floor(samples.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/* ── whisper.cpp ─────────────────────────────────────────────────── */

const WHISPER_SERVER_PORT = 18422;

interface WhisperServerState {
  proc: ChildProcess;
  modelPath: string;
  ready: boolean;
  idleTimer: NodeJS.Timeout | null;
}

let whisperServer: WhisperServerState | null = null;
let serverStarting: Promise<boolean> | null = null;

/** Idle timeout from settings: whisperKeepWarmMinutes (0 = always cold) */
function keepWarmMinutes(): number {
  const v = storage.getSettings().whisperKeepWarmMinutes;
  return typeof v === 'number' ? v : 15;
}

function stopWhisperServer(): void {
  if (whisperServer) {
    const s = whisperServer;
    whisperServer = null;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    try { s.proc.kill(); } catch {}
  }
  serverStarting = null;
}

function armIdleUnload(): void {
  if (!whisperServer) return;
  if (whisperServer.idleTimer) clearTimeout(whisperServer.idleTimer);
  const minutes = keepWarmMinutes();
  if (minutes <= 0) return;
  whisperServer.idleTimer = setTimeout(stopWhisperServer, minutes * 60000);
  // Do not keep the event loop alive just for the unload timer
  (whisperServer.idleTimer as any).unref?.();
}

function serverHttpCheck(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: WHISPER_SERVER_PORT, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Ensure whisper-server is running with the given model.
 * Starts on first dictation (not at app launch), unloads after idle.
 */
async function ensureWhisperServer(modelPath: string): Promise<boolean> {
  // Running with the right model?
  if (whisperServer?.ready && whisperServer.modelPath === modelPath) {
    armIdleUnload();
    return true;
  }
  // Different model (or dead process) — restart
  stopWhisperServer();

  if (!serverStarting) {
    serverStarting = (async () => {
      const serverPath = getWhisperServerPath();
      if (!fs.existsSync(serverPath)) return false;
      const threads = Math.max(2, Math.floor(os.cpus().length / 2));
      const args = ['-m', modelPath, '--host', '127.0.0.1', '--port', String(WHISPER_SERVER_PORT), '-t', String(threads)];
      const proc = spawn(serverPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
      proc.on('exit', () => { if (whisperServer?.proc === proc) { whisperServer = null; } });
      // Wait up to 30s for HTTP readiness
      for (let i = 0; i < 60; i++) {
        if (proc.pid === undefined) return false;
        if (await serverHttpCheck()) {
          whisperServer = { proc, modelPath, ready: true, idleTimer: null };
          armIdleUnload();
          return true;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      try { proc.kill(); } catch {}
      return false;
    })().finally(() => { serverStarting = null; });
  }
  return serverStarting;
}

/** Multipart POST of a wav file to whisper-server /inference */
function postWavToServer(wavPath: string, language: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const boundary = '----SpeakyBoundary' + Date.now();
    const chunks: Buffer[] = [];
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
    chunks.push(fs.readFileSync(wavPath));
    if (language && language !== 'auto') {
      chunks.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`));
    }
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const req = http.request({
      host: '127.0.0.1', port: WHISPER_SERVER_PORT, path: '/inference', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      timeout: RUN_TIMEOUT_MS
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) reject(new Error(json.error || `HTTP ${res.statusCode}`));
          else resolve(String(json.text || ''));
        } catch { reject(new Error('Некорректный ответ whisper-server')); }
      });
    });
    req.on('error', (err) => reject(new Error(`whisper-server недоступен: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Таймаут запроса к whisper-server')); });
    req.write(body);
    req.end();
  });
}

async function transcribeWithWhisperCpp(
  modelPath: string,
  tempPath: string,
  language: string
): Promise<string> {
  const warm = keepWarmMinutes() > 0;
  if (warm) {
    // Persistent server path (model stays in RAM)
    const ok = await ensureWhisperServer(modelPath);
    if (ok) {
      try {
        const text = await postWavToServer(tempPath, language);
        armIdleUnload();
        return text;
      } catch {
        // Server broke mid-flight — fall through to one-shot CLI
        stopWhisperServer();
      }
    }
  }

  // One-shot CLI fallback (also the path for keepWarm=0)
  const cliPath = getWhisperCliPath();
  const args = ['-m', modelPath, '-f', tempPath, '-nt', '-np'];
  const threads = Math.max(2, Math.floor(os.cpus().length / 2));
  args.push('-t', String(threads));
  if (language && language !== 'auto') args.push('-l', language);

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(cliPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('Таймаут локального распознавания (120с)'));
    }, RUN_TIMEOUT_MS);

    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Не удалось запустить whisper-cli: ${err.message}`));
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        const tail = stderr.split('\n').filter(Boolean).slice(-3).join(' | ');
        reject(new Error(`whisper-cli завершился с кодом ${code}${tail ? ': ' + tail : ''}`));
      }
    });
  });
}

/* ── Public API ───────────────────────────────────────────────────── */

export async function transcribeAudioLocal(
  audioBuffer: Buffer,
  mimeType = 'audio/wav',
  language = 'ru',
  modelId?: string
): Promise<TranscriptionResult> {
  const startTime = Date.now();

  const resolved = resolveModel(modelId);
  if (!resolved) {
    throw new Error('Локальная модель не скачана. Скачайте её в Настройки → Модели.');
  }
  const { file: modelFile, engine } = resolved;

  let text: string;
  if (engine === 'transcribe.cpp') {
    // In-process engine: decode WAV → Float32 PCM ourselves
    const wav = decodeWavToMono16k(audioBuffer);
    if (!wav) throw new Error('Ожидается WAV PCM16 от рекордера');
    const pcm = resampleLinear(wav.samples, wav.sampleRate);
    const r = await transcribeWithTranscribeCpp(modelFile, pcm, language);
    text = r.text;
  } else {
    const cliPath = getWhisperCliPath();
    if (!fs.existsSync(cliPath)) {
      throw new Error('whisper-cli не найден в комплекте приложения');
    }
    void cliPath;
    // whisper.cpp needs the wav on disk
    const tempPath = path.join(
      os.tmpdir(),
      `speaky_local_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`
    );
    try {
      await fs.promises.writeFile(tempPath, audioBuffer);
      text = await transcribeWithWhisperCpp(modelFile, tempPath, language);
    } finally {
      fs.promises.unlink(tempPath).catch(() => {});
    }
  }

  const latencyMs = Date.now() - startTime;
  const cleaned = text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: cleaned, durationSeconds: 0, latencyMs };
}

/** Free the transcribe.cpp worker (called on app quit) */
export function shutdownLocalWhisper(): void {
  stopWorker();
}
