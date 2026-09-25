/**
 * E2E: whisper-server with in-RAM model + warm HTTP transcription (logs to file).
 * Run: npx electron tests/e2e-whisper-server.js <model.bin> <audio.wav> <outlog>
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const SERVER_PORT = 18321;
const logLines = [];
function log(s) { logLines.push(s); }

function postWav(port, buffer, language) {
  return new Promise((resolve, reject) => {
    const boundary = '----SpeakyE2E' + Date.now();
    const chunks = [];
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
    chunks.push(buffer);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    const req = http.request({
      host: '127.0.0.1', port, path: '/inference', method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  await app.whenReady();
  const [modelPath, wavPath, outLog] = process.argv.slice(2);
  if (!modelPath || !wavPath) { log('usage error'); flush(outLog); process.exit(2); }

  const serverExe = path.resolve(__dirname, '..', 'resources', 'whisper', 'win-x64', 'whisper-server.exe');
  if (!fs.existsSync(serverExe)) { log('whisper-server.exe not found'); flush(outLog); process.exit(2); }

  const threads = Math.max(2, Math.floor(require('os').cpus().length / 2));
  const args = ['-m', modelPath, '--port', String(SERVER_PORT), '--host', '127.0.0.1',
    '-t', String(threads)];
  log('[e2e] starting: whisper-server ' + args.join(' '));

  const t0 = Date.now();
  const proc = spawn(serverExe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.stdout.on('data', (d) => { stderr += d.toString(); });

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ready = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: SERVER_PORT, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }
  log(`[e2e] server ready in ${Date.now() - t0}ms`);
  if (!ready) { log('server never became ready. stderr tail:\n' + stderr.slice(-1500)); flush(outLog); proc.kill(); process.exit(1); }

  const wav = fs.readFileSync(wavPath);

  const t1 = Date.now();
  const r1 = await postWav(SERVER_PORT, wav, 'ru');
  log(`[e2e] run1: ${Date.now() - t1}ms → ${String(r1.text || JSON.stringify(r1)).slice(0, 120)}`);

  const t2 = Date.now();
  const r2 = await postWav(SERVER_PORT, wav, 'ru');
  log(`[e2e] run2 (warm): ${Date.now() - t2}ms → ${String(r2.text || JSON.stringify(r2)).slice(0, 120)}`);

  const t3 = Date.now();
  const r3 = await postWav(SERVER_PORT, wav, 'auto');
  log(`[e2e] run3 (auto): ${Date.now() - t3}ms → ${String(r3.text || JSON.stringify(r3)).slice(0, 120)}`);

  proc.kill();
  flush(outLog);
  process.exit(0);
}

function flush(outLog) {
  if (outLog) { try { fs.writeFileSync(outLog, logLines.join('\n')); } catch {} }
  console.log(logLines.join('\n'));
}

main().catch((e) => { log('[e2e] FAILED: ' + (e && e.message || e)); flush(process.argv[4]); process.exit(1); });
