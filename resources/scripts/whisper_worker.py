"""
Speaky local speech worker.

Persistent JSON-lines worker (stdin/stdout) with three pluggable engines:
  - faster-whisper : Whisper models (Systran CTranslate2 checkpoints)
  - sherpa-onnx    : NVIDIA Parakeet (ONNX) checkpoints
  - gigaam         : GigaAM Russian ASR (pip package "gigaam")

One-shot modes for the model manager:
  python whisper_worker.py --check    '<json>'
  python whisper_worker.py --download '<json>'
"""
import sys
import os
import json
import time
import subprocess
import urllib.request
import urllib.parse

# UTF-8 stdio on Windows
if sys.platform == 'win32':
    import io
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8', line_buffering=True)
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)

MODELS_DIR = os.environ.get(
    'SPEAKY_MODELS_DIR',
    os.path.join(os.path.expanduser('~'), '.speaky', 'models')
)

ENGINE_MODULES = {
    'faster-whisper': 'faster_whisper',
    'gigaam': 'gigaam',
    'sherpa-onnx': 'sherpa_onnx',
    'onnx-asr': 'onnx_asr',
}

ENGINE_PIP_HINT = {
    'faster-whisper': 'pip install faster-whisper',
    'gigaam': 'pip install gigaam',
    'sherpa-onnx': 'pip install sherpa-onnx',
    'onnx-asr': 'pip install onnx-asr[cpu,hub]',
}

_fw_cache = {}
_gigaam_cache = {}


def log(msg):
    sys.stderr.write(f'[SpeakyWorker] {msg}\n')
    sys.stderr.flush()


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def engine_available(engine):
    mod = ENGINE_MODULES.get(engine)
    if not mod:
        return False, f'Unknown engine: {engine}'
    try:
        __import__(mod)
        return True, None
    except Exception as e:
        return False, str(e)


def hf_repo_for(model_id):
    """Map catalog model id to a HuggingFace repo id."""
    if model_id == 'whisper-large-v3-turbo':
        # Systran's original turbo repo is no longer public; use the verified CT2 mirror
        return 'deepdml/faster-whisper-large-v3-turbo-ct2'
    if model_id.startswith('whisper-'):
        return f'Systran/faster-whisper-{model_id[len("whisper-"):]}'.rstrip()
    return model_id


# ── Download (HuggingFace, dependency-free) ────────────────────────────

def hf_list_files(repo):
    url = f'https://huggingface.co/api/models/{urllib.parse.quote(repo)}/tree/main?recursive=true'
    req = urllib.request.Request(url, headers={'User-Agent': 'Speaky/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        tree = json.loads(r.read().decode('utf-8'))
    files = []
    for node in tree:
        if node.get('type') != 'file':
            continue
        lfs = node.get('lfs') or {}
        size = lfs.get('size') or node.get('size') or 0
        files.append((node['path'], size))
    if not files:
        raise Exception(f'Repo has no files: {repo}')
    return files


def hf_download(repo, dest, progress_cb=None, cancel_cb=None):
    files = hf_list_files(repo)
    total = sum(s for _, s in files) or 1
    done = 0
    for i, (rel, size) in enumerate(files):
        url = f'https://huggingface.co/{repo}/resolve/main/{urllib.parse.quote(rel)}'
        target = os.path.join(dest, rel.replace('/', os.sep))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if os.path.exists(target) and os.path.getsize(target) == size:
            done += size
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'Speaky/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r, open(target + '.part', 'wb') as f:
            while True:
                if cancel_cb and cancel_cb():
                    raise Exception('cancelled')
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if progress_cb:
                    progress_cb(done, total, i + 1, len(files))
        os.replace(target + '.part', target)
    return len(files), total


def download_model(req):
    model_id = req.get('modelId') or ''
    engine = req.get('engine') or 'faster-whisper'
    dest = os.path.join(MODELS_DIR, engine, model_id)
    os.makedirs(dest, exist_ok=True)

    # GigaAM / Parakeet ONNX weights are fetched by the onnx-asr package itself
    if engine == 'onnx-asr':
        try:
            import onnx_asr
        except ImportError:
            emit({'status': 'error', 'modelId': model_id,
                  'message': 'Движок onnx-asr не установлен. Установите: pip install onnx-asr[cpu,hub]'})
            return
        key = req.get('engineModelId') or model_id
        try:
            emit({'status': 'progress', 'modelId': model_id, 'percent': 30})
            onnx_asr.load_model(key)  # downloads weights into the shared HF/onnx-asr cache
            with open(os.path.join(dest, '.installed'), 'w') as f:
                json.dump({'modelId': model_id, 'engine': engine, 'via': 'onnx-asr', 'key': key}, f)
            emit({'status': 'ok', 'modelId': model_id, 'path': dest})
        except Exception as e:
            emit({'status': 'error', 'modelId': model_id, 'message': str(e)})
        return

    # GigaAM weights are fetched by the pip package itself (no public HF CT2 repo)
    if engine == 'gigaam':
        try:
            import gigaam
        except ImportError:
            emit({'status': 'error', 'modelId': model_id,
                  'message': 'Движок GigaAM не установлен. Установите: pip install gigaam'})
            return
        try:
            loader = getattr(gigaam, 'load', None) or getattr(gigaam, 'load_model', None)
            if loader is None:
                raise Exception('gigaam: не найден метод load/load_model')
            emit({'status': 'progress', 'modelId': model_id, 'percent': 30})
            loader('v2')
            with open(os.path.join(dest, '.installed'), 'w') as f:
                json.dump({'modelId': model_id, 'engine': engine, 'via': 'gigaam-pip'}, f)
            emit({'status': 'ok', 'modelId': model_id, 'path': dest})
        except Exception as e:
            emit({'status': 'error', 'modelId': model_id, 'message': str(e)})
        return

    repo = req.get('huggingfaceId') or hf_repo_for(model_id)

    last_emit = [0.0]

    def progress(done, total, file_idx, file_count):
        now = time.time()
        if now - last_emit[0] < 0.25 and done < total:
            return
        last_emit[0] = now
        emit({
            'status': 'progress',
            'modelId': model_id,
            'percent': round(done / max(1, total) * 100, 1),
            'receivedMB': round(done / 1048576, 1),
            'totalMB': round(total / 1048576, 1),
            'file': f'{file_idx}/{file_count}'
        })

    n_files, total = hf_download(repo, dest, progress_cb=progress)
    # Marker so the UI can reliably detect a finished install
    with open(os.path.join(dest, '.installed'), 'w') as f:
        json.dump({'modelId': model_id, 'engine': engine, 'repo': repo}, f)

    emit({
        'status': 'ok',
        'modelId': model_id,
        'files': n_files,
        'sizeMB': round(total / 1048576, 1),
        'path': dest
    })


def install_engine(req):
    """One-shot `python -m pip install` of the engine package (click 'Install engine' in UI)."""
    engine = req.get('engine') or 'faster-whisper'
    pkg = {
        'faster-whisper': 'faster-whisper',
        'gigaam': 'gigaam',
        'sherpa-onnx': 'sherpa-onnx',
        'onnx-asr': 'onnx-asr[cpu,hub]',
    }.get(engine)
    if not pkg:
        emit({'status': 'error', 'engine': engine, 'message': f'Unknown engine: {engine}'})
        return
    emit({'status': 'progress', 'modelId': f'engine:{engine}', 'percent': -1})
    proc = subprocess.Popen(
        [sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', pkg],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace'
    )
    for _line in proc.stdout or []:
        pass  # consume; progress is indeterminate (spinner in UI)
    code = proc.wait()
    ok, err = engine_available(engine)
    if code == 0 and ok:
        emit({'status': 'ok', 'engine': engine, 'available': True})
    else:
        tail = (err or '').strip().splitlines()[-1] if err else f'pip exit code {code}'
        emit({'status': 'error', 'engine': engine, 'message': f'Не удалось установить движок {engine}: {tail}'})


def check_engine(req):
    engine = req.get('engine') or 'faster-whisper'
    ok, err = engine_available(engine)
    emit({
        'status': 'ok',
        'engine': engine,
        'available': ok,
        'error': err,
        'hint': None if ok else ENGINE_PIP_HINT.get(engine)
    })


# ── Transcription engines ──────────────────────────────────────────────

def resolve_fw_source(model_id, model_path=None):
    if model_path and os.path.isdir(model_path) and os.listdir(model_path):
        return model_path
    local = os.path.join(MODELS_DIR, 'faster-whisper', model_id)
    if os.path.isdir(local) and os.listdir(local):
        return local
    # fall back to hub id (ctranslate2 auto-downloads into HF cache)
    return hf_repo_for(model_id) if model_id else 'Systran/faster-whisper-small'


def fw_transcribe(audio_path, language, model_id, model_path):
    from faster_whisper import WhisperModel
    source = resolve_fw_source(model_id, model_path)
    key = source
    if key not in _fw_cache:
        log(f'loading faster-whisper model: {source}')
        _fw_cache[key] = WhisperModel(source, device='cpu', compute_type='int8')
    m = _fw_cache[key]
    chosen = language if language in ('ru', 'en', 'es', 'de', 'fr', 'zh') else None
    segments, info = m.transcribe(
        audio_path,
        language=chosen,
        beam_size=2,
        temperature=0.0,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    text = ' '.join(s.text.strip() for s in segments if s.text.strip()).strip()
    return text, getattr(info, 'duration', 0)


def gigaam_transcribe(audio_path, language, model_id, model_path):
    try:
        import gigaam
    except ImportError:
        raise Exception('Движок GigaAM не установлен. Установите: pip install gigaam')

    variant = 'v2'
    for v in ('v1', 'v2', 'v2_photo'):
        if v in (model_id or ''):
            variant = v
            break

    key = variant
    if key not in _gigaam_cache:
        loader = getattr(gigaam, 'load', None) or getattr(gigaam, 'load_model', None)
        if loader is None:
            raise Exception('gigaam: не найден метод load/load_model')
        log(f'loading gigaam model: {variant}')
        _gigaam_cache[key] = loader(variant)
    m = _gigaam_cache[key]
    res = m.transcribe(audio_path)
    if isinstance(res, dict):
        text = (res.get('text') or '').strip()
    else:
        text = str(res).strip()
    return text, 0


def _find_first(dirpath, *suffixes):
    if not os.path.isdir(dirpath):
        return None
    for root, _dirs, files in os.walk(dirpath):
        for f in files:
            low = f.lower()
            for s in suffixes:
                if low.endswith(s):
                    return os.path.join(root, f)
    return None


def sherpa_transcribe(audio_path, language, model_id, model_path):
    try:
        import sherpa_onnx
    except ImportError:
        raise Exception('Движок Parakeet (sherpa-onnx) не установлен. Установите: pip install sherpa-onnx')

    model_dir = model_path or os.path.join(MODELS_DIR, 'sherpa-onnx', model_id or '')
    tokens = _find_first(model_dir, 'tokens.txt')
    encoder = _find_first(model_dir, 'encoder.onnx')
    decoder = _find_first(model_dir, 'decoder.onnx')
    joiner = _find_first(model_dir, 'joiner.onnx')
    if not all([tokens, encoder, decoder, joiner]):
        raise Exception(f'Parakeet: неполная модель в {model_dir}. Скачайте модель заново.')

    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=encoder,
        decoder=decoder,
        joiner=joiner,
        tokens=tokens,
        num_threads=2,
        sample_rate=16000,
        feature_dim=80,
        decoding_method='greedy_search'
    )

    import wave
    import array
    with wave.open(audio_path, 'rb') as wf:
        assert wf.getsampwidth() == 2, 'expected 16-bit wav'
        sr = wf.getframerate()
        n = wf.getnframes()
        pcm = array.array('h', wf.readframes(n))

    if sr != 16000:
        # naive decimation fallback; most capture paths are already 16 kHz
        step = max(1, int(sr / 16000))
        pcm = pcm[::step]

    stream = recognizer.create_stream()
    stream.accept_waveform(16000, [s / 32768.0 for s in pcm])
    recognizer.decode(stream)
    text = stream.result.text.strip()
    return text, len(pcm) / 16000.0


def onnx_asr_transcribe(audio_path, language, model_id, engine_model_id, model_path=None):
    try:
        import onnx_asr
    except ImportError:
        raise Exception('Движок onnx-asr не установлен. Установите: pip install onnx-asr[cpu,hub]')
    key = engine_model_id or model_id
    if model_path and os.path.isdir(model_path) and os.listdir(model_path):
        # Local folder (user-registered or downloaded): load directly from it
        m = onnx_asr.load_model(key, model_path)
    else:
        m = onnx_asr.load_model(key)
    res = m.recognize(audio_path)
    if not isinstance(res, str):
        if hasattr(res, '__iter__') and not isinstance(res, (bytes, bytearray)):
            res = ' '.join(str(x) for x in res)
        else:
            res = str(res)
    return res.strip(), 0


def do_transcribe(req):
    audio_path = req.get('path')
    if not audio_path or not os.path.exists(audio_path):
        raise Exception(f'File not found: {audio_path}')

    engine = req.get('engine') or 'faster-whisper'
    model_id = req.get('modelId') or 'whisper-small'
    model_path = req.get('modelPath')
    engine_model_id = req.get('engineModelId')
    language = req.get('language')

    ok, err = engine_available(engine)
    if not ok:
        hint = ENGINE_PIP_HINT.get(engine, '')
        raise Exception(f'Движок {engine} недоступен ({err}). Установите: {hint}')

    if engine == 'faster-whisper':
        text, duration = fw_transcribe(audio_path, language, model_id, model_path)
    elif engine == 'gigaam':
        text, duration = gigaam_transcribe(audio_path, language, model_id, model_path)
    elif engine == 'sherpa-onnx':
        text, duration = sherpa_transcribe(audio_path, language, model_id, model_path)
    elif engine == 'onnx-asr':
        text, duration = onnx_asr_transcribe(audio_path, language, model_id, engine_model_id, model_path)
    else:
        raise Exception(f'Unknown engine: {engine}')

    emit({'status': 'ok', 'text': text, 'duration': duration, 'engine': engine})


# ── Entry points ───────────────────────────────────────────────────────

def run_request(req):
    action = req.get('action')
    if action == 'ping':
        emit({'status': 'ok', 'pong': True})
    elif action == 'warmup':
        source = resolve_fw_source(req.get('modelId') or 'whisper-small', None)
        if source not in _fw_cache:
            from faster_whisper import WhisperModel
            _fw_cache[source] = WhisperModel(source, device='cpu', compute_type='int8')
        emit({'status': 'ok', 'warmed': True})
    elif action == 'check':
        check_engine(req)
    elif action == 'install-engine':
        install_engine(req)
    elif action == 'download':
        download_model(req)
    elif action == 'transcribe':
        do_transcribe(req)
    else:
        emit({'status': 'error', 'message': f'Unknown action: {action}'})


if len(sys.argv) >= 3 and sys.argv[1] in ('--check', '--download', '--transcribe', '--install-engine'):
    # One-shot mode used by the model manager
    try:
        req = json.loads(sys.argv[2])
        run_request(req)
    except Exception as e:
        emit({'status': 'error', 'message': str(e)})
    sys.exit(0)

log('Worker initialized')

while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        run_request(req)
    except Exception as e:
        log(f'Error handling request: {e}')
        try:
            emit({'status': 'error', 'message': str(e)})
        except Exception:
            pass
