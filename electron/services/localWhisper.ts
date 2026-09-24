import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Worker } from 'worker_threads';
import { TranscriptionResult } from './sttService';
import {
  getWhisperCliPath,
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

/* ── whisper.cpp (spawn CLI) ──────────────────────────────────────── */

async function transcribeWithWhisperCpp(
  cliPath: string,
  modelPath: string,
  tempPath: string,
  language: string
): Promise<string> {
  const args = ['-m', modelPath, '-f', tempPath, '-nt', '-np'];
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
    // whisper.cpp needs the wav on disk
    const tempPath = path.join(
      os.tmpdir(),
      `speaky_local_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`
    );
    try {
      await fs.promises.writeFile(tempPath, audioBuffer);
      text = await transcribeWithWhisperCpp(cliPath, modelFile, tempPath, language);
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
