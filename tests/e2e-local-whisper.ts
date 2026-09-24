/**
 * E2E test of the local whisper.cpp pipeline (no mocks):
 *  1. Download a real model with the REAL modelManager downloader (electron net)
 *  2. Transcribe a real WAV with the REAL localWhisper service (spawns whisper-cli.exe)
 * Mirrors exactly what the app does when user picks provider=local.
 *
 * Run:  npx electron tests/e2e-local-whisper.js   (compiled) or via tsx: npx electron -r tsx tests/e2e-local-whisper.ts
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const wavPath = process.argv.find((a) => a.endsWith('.wav')) ||
  path.join(process.env.TEMP || '/tmp', 'speaky-e2e', 'speech16k.wav');

async function main() {
  console.log('=== E2E: local whisper.cpp pipeline ===');
  console.log('[env] userData:', app.getPath('userData'));

  const { downloadModel, getCatalogStatus, isWhisperCliAvailable, getWhisperCliPath } =
    await import('../electron/services/modelManager');
  const { transcribeAudioLocal, checkLocalWhisperAvailable } =
    await import('../electron/services/localWhisper');

  // 0. Engine binary present?
  if (!isWhisperCliAvailable()) {
    throw new Error('whisper-cli.exe not found at ' + getWhisperCliPath());
  }
  console.log('[ok] whisper-cli bundled:', getWhisperCliPath());

  // 1. Catalog status
  const catalog = getCatalogStatus();
  const small = catalog.find((m) => m.id === 'whisper-base-q5')!;
  console.log(`[catalog] ${small.name}: installed=${small.installed}`);

  // 2. Download with the REAL downloader (skips if already installed)
  if (!small.installed) {
    console.log('[download] fetching', small.name, `(~${small.sizeMB}MB)...`);
    const t0 = Date.now();
    const { promise } = downloadModel(small.id, (ev) => {
      if (ev.state === 'downloading') {
        process.stdout.write(`\r[download] ${ev.percent ?? 0}% (${ev.receivedMB ?? 0}MB)   `);
      }
    });
    await promise;
    process.stdout.write('\n');
    console.log(`[ok] downloaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const after = getCatalogStatus().find((m) => m.id === small.id)!;
  if (!after.installed) throw new Error('Model not installed after download');
  console.log('[ok] model on disk:', after.path, `(${after.sizeOnDiskMB}MB)`);

  // 3. Availability check (as the app does before fallback)
  const avail = await checkLocalWhisperAvailable();
  if (!avail.available) throw new Error('checkLocalWhisperAvailable failed: ' + avail.error);
  console.log('[ok] availability check passed');

  // 4. Transcribe with the REAL service
  if (!fs.existsSync(wavPath)) {
    throw new Error(`Test wav not found: ${wavPath} (generate it first)`);
  }
  const audio = fs.readFileSync(wavPath);
  console.log(`[transcribe] ${wavPath} (${Math.round(audio.length / 1024)}KB, lang=ru)`);

  const t1 = Date.now();
  const result = await transcribeAudioLocal(audio, 'audio/wav', 'ru', small.id);
  const dt = ((Date.now() - t1) / 1000).toFixed(2);

  console.log('----------------------------------------');
  console.log('TEXT:', result.text);
  console.log(`LATENCY: ${dt}s`);
  console.log('----------------------------------------');

  const expected = ['привет', 'тест', 'распознаван', 'спики', 'реч'];
  const lower = result.text.toLowerCase();
  const hits = expected.filter((w) => lower.includes(w));
  console.log(`[check] keyword hits: ${hits.length}/${expected.length}`, hits);

  if (result.text.length === 0) throw new Error('Empty transcription');
  if (hits.length < 3) throw new Error(`Weak match, got: "${result.text}"`);

  console.log('=== E2E PASSED ===');
}

app.whenReady().then(async () => {
  const code = await main().then(
    () => 0,
    (err) => {
      console.error('=== E2E FAILED ===');
      console.error(err);
      return 1;
    }
  );
  app.exit(code);
});
