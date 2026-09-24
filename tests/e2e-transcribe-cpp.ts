/**
 * E2E: transcribeAudioLocal through the new orchestrator (no mocks).
 * Registers a custom gguf model and transcribes a TTS wav.
 * Run: npx electron tests/e2e-transcribe-cpp.js <model.gguf> <audio.wav>
 */
import { app } from 'electron';
import path from 'path';

async function main() {
  await app.whenReady();
  // Worker is built as a separate esbuild entry
  process.env.SPEAKY_TRANSCRIBE_WORKER = path.resolve(__dirname, 'e2e-transcribe-worker.js');

  const { transcribeAudioLocal, shutdownLocalWhisper } = await import('../electron/services/localWhisper');
  const { registerCustomModel, unregisterCustomModel } = await import('../electron/services/modelManager');

  const [modelGguf, wavPath] = process.argv.slice(2);
  if (!modelGguf || !wavPath) {
    console.error('usage: e2e-transcribe-cpp.js <model.gguf> <audio.wav>');
    process.exit(2);
  }

  const id = 'e2e-custom-gguf';
  unregisterCustomModel(id); // idempotent cleanup from earlier runs
  const reg = registerCustomModel({ id, name: 'E2E gguf', path: modelGguf, engine: 'transcribe.cpp' } as any);
  console.log('[e2e] registerCustomModel:', JSON.stringify(reg));
  if (!reg.ok) { process.exit(1); }

  try {
    const t0 = Date.now();
    const buf = await import('fs').then((fs) => fs.promises.readFile(wavPath));
    const r = await transcribeAudioLocal(buf, 'audio/wav', 'ru', id);
    const total = Date.now() - t0;

    console.log('[e2e] TEXT:', r.text);
    console.log(`[e2e] latency total: ${total}ms (service reported ${r.latencyMs}ms)`);

    // Warm second run — model must already be in RAM
    const t1 = Date.now();
    const r2 = await transcribeAudioLocal(buf, 'audio/wav', 'ru', id);
    console.log(`[e2e] warm run: ${Date.now() - t1}ms TEXT: ${r2.text}`);

    const keywords = ['тест', 'распознавания', 'речи'];
    const lower = r.text.toLowerCase();
    const hits = keywords.filter((k) => lower.includes(k)).length;
    console.log(`[e2e] keywords: ${hits}/${keywords.length} → ${hits >= 2 ? 'PASS' : 'FAIL'}`);
  } finally {
    unregisterCustomModel(id);
    shutdownLocalWhisper();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err);
  process.exit(1);
});
