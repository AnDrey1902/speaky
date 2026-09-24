/**
 * Probe: transcribe.cpp via koffi (no mocks).
 * Usage: npx electron tests/probe-transcribe.js <model.gguf> <audio.wav>
 */
const path = require('path');
const fs = require('fs');

const dllDir = path.resolve(__dirname, '..', 'resources', 'transcribe', 'win-x64');
// transcribe.dll depends on ggml*.dll in the same dir — make loader find them.
process.env.PATH = dllDir + path.delimiter + process.env.PATH;

const koffi = require('koffi');
const lib = koffi.load(path.join(dllDir, 'transcribe.dll'));

const version = lib.func('const char *transcribe_version()');
const initBackends = lib.func('int transcribe_init_backends(const char *artifact_dir)');
const deviceCount = lib.func('int transcribe_device_count()');
const ibSt = initBackends(dllDir);
console.error('[probe] init_backends ->', ibSt);
const ndev = deviceCount();
console.error('[probe] devices:', ndev);
const statusString = lib.func('const char *transcribe_status_string(int status)');
const openFn = lib.func('int transcribe_open(const char *path, const void *load_params, const void *session_params, void **out_session)');
const runFn = lib.func('int transcribe_run(void *session, const float *pcm, int n_samples, const void *params)');
const textFn = lib.func('const char *transcribe_full_text(const void *session)');
const detectedFn = lib.func('const char *transcribe_detected_language(const void *session)');
const closeFn = lib.func('void transcribe_close(void *session)');

console.error('[probe] transcribe.cpp version:', version());

const [modelPath, wavPath] = process.argv.slice(2);
if (!modelPath || !wavPath) { console.error('usage: probe-transcribe.js <model.gguf> <audio.wav>'); process.exit(2); }

// --- Parse WAV (PCM16/PCM32/float32) → mono Float32Array 16kHz ---
const wb = fs.readFileSync(wavPath);
if (wb.toString('ascii', 0, 4) !== 'RIFF') { console.error('not a wav'); process.exit(2); }
let pos = 12, fmt = null, data = null;
while (pos < wb.length - 8) {
  const id = wb.toString('ascii', pos, pos + 4);
  const sz = wb.readUInt32LE(pos + 4);
  if (id === 'fmt ') fmt = {
    ch: wb.readUInt16LE(pos + 10),
    rate: wb.readUInt32LE(pos + 12),
    bits: wb.readUInt16LE(pos + 22),
  };
  if (id === 'data') data = wb.subarray(pos + 8, pos + 8 + sz);
  pos += 8 + sz + (sz & 1);
}
if (!fmt || !data) { console.error('bad wav chunks'); process.exit(2); }
const bytesPer = fmt.bits / 8;
let samples = new Float32Array(Math.floor(data.length / bytesPer));
for (let i = 0; i < samples.length; i++) {
  if (fmt.bits === 16) samples[i] = data.readInt16LE(i * 2) / 32768;
  else if (fmt.bits === 32) samples[i] = data.readFloatLE(i * 4);
}
// mixdown to mono
if (fmt.ch > 1) {
  const mono = new Float32Array(Math.floor(samples.length / fmt.ch));
  for (let i = 0; i < mono.length; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.ch; c++) acc += samples[i * fmt.ch + c];
    mono[i] = acc / fmt.ch;
  }
  samples = mono;
}
console.error('[probe] audio:', `${fmt.rate}Hz ${fmt.ch}ch ${fmt.bits}bit → ${samples.length} samples (${(samples.length / 16000).toFixed(2)}s)`);

// --- Open model ---
console.error('[probe] opening model:', modelPath);
const t0 = Date.now();
const sessionBuf = Buffer.alloc(8);
const st = openFn(modelPath, null, null, sessionBuf);
if (st !== 0) {
  console.error('transcribe_open failed:', st, statusString(st));
  process.exit(1);
}
const session = koffi.decode(sessionBuf, 'void *');
const loadMs = Date.now() - t0;
console.error(`[probe] model loaded in ${loadMs}ms, session ptr:`, !!session);

// --- Run ---
const t1 = Date.now();
const rst = runFn(session, samples, samples.length, null);
const runMs = Date.now() - t1;
if (rst !== 0) {
  console.error('transcribe_run failed:', rst, statusString(rst));
  closeFn(session);
  process.exit(1);
}
console.error(`[probe] run: ${runMs}ms (audio ${(samples.length / 16000).toFixed(2)}s, RTF ${(runMs / 1000 / (samples.length / 16000)).toFixed(2)})`);
console.error('[probe] detected language:', detectedFn(session));
console.error('[probe] TEXT:', textFn(session));

// --- Second run on the same session (warm) ---
const t2 = Date.now();
const rst2 = runFn(session, samples, samples.length, null);
console.error(`[probe] warm run: ${Date.now() - t2}ms status=${rst2} text="${textFn(session)}"`);

closeFn(session);
console.error('[probe] OK');
