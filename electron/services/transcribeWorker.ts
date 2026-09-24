/**
 * Worker thread: transcribe.cpp engine via koffi.
 * Owns the native dll and the loaded model — koffi handles must stay on one
 * thread, and heavy inference must never block the Electron main loop.
 *
 * Protocol (parent → worker):
 *   { type: 'open',  modelPath, language }  → load model, keep it in RAM
 *   { type: 'run',   samples: Float32Array, seq } → transcribe PCM
 *   { type: 'close' }                        → free model
 * Worker → parent:
 *   { type: 'ready', backend }
 *   { type: 'result', text, backend, seq }
 *   { type: 'error',  message }
 */
import { parentPort, workerData } from 'worker_threads';
import path from 'path';

const dllDir: string = workerData?.dllDir || '';
// transcribe.dll resolves ggml*.dll next to itself; extend loader search path.
process.env.PATH = dllDir + path.delimiter + process.env.PATH;

/* eslint-disable @typescript-eslint/no-var-requires */
console.error('[worker] starting, dllDir =', dllDir);
const koffi = require('koffi');
const lib = koffi.load(path.join(dllDir, 'transcribe.dll'));
console.error('[worker] dll loaded');
parentPort!.postMessage({ type: 'hello' });

const versionFn = lib.func('const char *transcribe_version()');
const statusFn = lib.func('const char *transcribe_status_string(int status)');
const initBackendsFn = lib.func('int transcribe_init_backends(const char *artifact_dir)');
const initSt = initBackendsFn(dllDir);
console.error('[worker] init_backends ->', initSt);
const openFn = lib.func('int transcribe_open(const char *path, const void *load_params, const void *session_params, void **out_session)');
const runFn = lib.func('int transcribe_run(void *session, const float *pcm, int n_samples, const void *params)');
const textFn = lib.func('const char *transcribe_full_text(const void *session)');
const langFn = lib.func('const char *transcribe_detected_language(const void *session)');
const backendFn = lib.func('const char *transcribe_model_backend(const void *session)');
const closeFn = lib.func('void transcribe_close(void *session)');

let session: unknown = null;
let currentModelPath = '';
let currentModelFile = '';
let currentLanguage = '';

parentPort!.on('message', (msg: any) => {
  console.error('[worker] msg:', msg.type);
  try {
    if (msg.type === 'open') {
      const modelPath: string = msg.modelPath;
      const file = path.basename(modelPath).toLowerCase();
      if (session && currentModelPath === modelPath && currentLanguage === (msg.language || '')) {
        parentPort!.postMessage({ type: 'ready', backend: backendFn(session) });
        return;
      }
      if (session) { closeFn(session); session = null; }
      const buf = Buffer.alloc(8);
      const st = openFn(modelPath, null, null, buf);
      if (st !== 0) {
        parentPort!.postMessage({ type: 'error', message: `transcribe_open ${statusFn(st)} (${st})` });
        return;
      }
      session = koffi.decode(buf, 'void *');
      console.error('[worker] opened, backend =', backendFn(session));
      currentModelPath = modelPath;
      currentModelFile = file;
      currentLanguage = msg.language || '';
      parentPort!.postMessage({ type: 'ready', backend: backendFn(session) });

    } else if (msg.type === 'run') {
      if (!session) {
        parentPort!.postMessage({ type: 'error', message: 'Модель не загружена' });
        return;
      }
      const samples: Float32Array = msg.samples;
      const t0 = Date.now();
      const st = runFn(session, samples, samples.length, null);
      console.error('[worker] run done:', st, Date.now() - t0, 'ms');
      if (st !== 0) {
        parentPort!.postMessage({ type: 'error', message: `transcribe_run ${statusFn(st)} (${st})` });
        return;
      }
      const raw = String(textFn(session) || '');
      const cleaned = raw
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      parentPort!.postMessage({
        type: 'result',
        text: cleaned,
        detectedLanguage: String(langFn(session) || ''),
        backend: String(backendFn(session) || ''),
        seq: msg.seq
      });

    } else if (msg.type === 'close') {
      if (session) { closeFn(session); session = null; currentModelPath = ''; }
      parentPort!.postMessage({ type: 'closed' });
    }
  } catch (err: any) {
    parentPort!.postMessage({ type: 'error', message: err?.message || String(err) });
  }
});
