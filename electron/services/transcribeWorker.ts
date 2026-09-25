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
// Optional spec-decode override for debugging (SPEAKY_SPEC_K=0 disables it)
const specKOverride = process.env.SPEAKY_SPEC_K ? parseInt(process.env.SPEAKY_SPEC_K, 10) : undefined;
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

// Model load params: backend request (AUTO=0, CPU=1, VULKAN=3). Optional
// override via SPEAKY_TC_BACKEND — some model families are unreliable on GPU.
// NOTE: koffi parses prototypes at declaration time — the struct MUST be
// registered before lib.func() references it, otherwise the parameter
// silently degrades to void * and object args are rejected at call time.
const LoadParams = koffi.struct('transcribe_model_load_params', {
  struct_size: 'uint64',
  backend: 'int32',
  device: 'void *'
});
const openFn = lib.func('int transcribe_open(const char *path, const transcribe_model_load_params *load_params, const void *session_params, void **out_session)');
const backendEnv = (process.env.SPEAKY_TC_BACKEND || '').toLowerCase();
// Backend policy: the bundled Vulkan build mis-decodes the WHISPER family
// (garbage tokens / hallucinations) while GigaAM & Parakeet run perfectly on
// it — so whisper GGUF models are pinned to CPU (slower but correct),
// everything else uses AUTO. SPEAKY_TC_BACKEND=cpu|vulkan overrides for tests.
// Must be evaluated per-open (model file is only known when 'open' arrives).
function resolveBackendRequest(modelFile: string): number {
  if (backendEnv === 'cpu') return 1;
  if (backendEnv === 'vulkan') return 3;
  return /whisper/i.test(modelFile) ? 1 : 0;
}
// Native sizeof query: safer than *_init() (which koffi trips over on pointer
// out-fields). struct_size >= known-field prefix is accepted by the library.
const abiSizeFn = lib.func('uint64 transcribe_abi_struct_size(int which)');

// Per-run params: language hint lives HERE (not in session params). Without it
// whisper-GGUF runs in autodetect and hallucinates on short utterances;
// GigaAM/Parakeet are language-agnostic and simply ignore the hint.
const RunParams = koffi.struct('transcribe_run_params', {
  struct_size: 'uint64',
  task: 'int32',            // TRANSCRIBE_TASK_TRANSCRIBE = 0
  timestamps: 'int32',
  pnc: 'int32',
  itn: 'int32',
  diarize: 'int32',
  language: 'string',       // BCP-47-ish short code, or null → autodetect
  target_language: 'string',
  keep_special_tags: 'bool',
  family: 'void *',
  spec_k_drafts: 'int32'
});
const runFn = lib.func('int transcribe_run(void *session, const float *pcm, int n_samples, const transcribe_run_params *params)');
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
      (workerData as any).modelName = file;
      if (session && currentModelPath === modelPath && currentLanguage === (msg.language || '')) {
        parentPort!.postMessage({ type: 'ready', backend: backendFn(session) });
        return;
      }
      if (session) { closeFn(session); session = null; }
      const backendRequest = resolveBackendRequest(file);
      let loadParams: any = null;
      if (backendRequest !== 0) {
        loadParams = { struct_size: Number(abiSizeFn(0)), backend: backendRequest, device: null };
      }
      const buf = Buffer.alloc(8);
      let st: number;
      try {
        st = openFn(modelPath, loadParams, null, buf);
      } catch (e: any) {
        parentPort!.postMessage({ type: 'error', message: `open-call failed: ${e?.message || e}` });
        return;
      }
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
      // Manual struct with explicit native sizeof: language hint so whisper
      // GGUF does not autodetect-and-hallucinate; GigaAM/Parakeet ignore it.
      const rp: any = {
        struct_size: Number(abiSizeFn(2)),
        task: 0,
        timestamps: 0,
        pnc: 0,
        itn: 0,
        diarize: 0,
        language: currentLanguage && currentLanguage !== 'auto' ? currentLanguage : null,
        target_language: null,
        keep_special_tags: false,
        family: null,
        spec_k_drafts: specKOverride !== undefined ? specKOverride : -1
      };
      let st: number;
      try {
        st = runFn(session, samples, samples.length, rp);
      } catch (e: any) {
        parentPort!.postMessage({ type: 'error', message: `run-call failed: ${e?.message || e}` });
        return;
      }
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
