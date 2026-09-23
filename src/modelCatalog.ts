import { ModelCatalogEntry } from './types';

/**
 * Shared catalog of speech models (renderer + main process).
 * Renderer shows it as a fallback when running outside Electron.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    engine: 'faster-whisper',
    huggingfaceId: 'deepdml/faster-whisper-large-v3-turbo-ct2',
    languages: ['multi'],
    sizeMB: 1624,
    description: 'Максимальная точность и скорость. Рекомендуемая модель.',
    requires: 'faster-whisper'
  },
  {
    id: 'whisper-large-v3',
    name: 'Whisper Large v3',
    engine: 'faster-whisper',
    huggingfaceId: 'Systran/faster-whisper-large-v3',
    languages: ['multi'],
    sizeMB: 3095,
    description: 'Полная версия Large v3 — лучшая точность на сложном аудио.',
    requires: 'faster-whisper'
  },
  {
    id: 'whisper-medium',
    name: 'Whisper Medium',
    engine: 'faster-whisper',
    huggingfaceId: 'Systran/faster-whisper-medium',
    languages: ['multi'],
    sizeMB: 1530,
    description: 'Хороший баланс точности и размера для средних ПК.',
    requires: 'faster-whisper'
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    engine: 'faster-whisper',
    huggingfaceId: 'Systran/faster-whisper-small',
    languages: ['multi'],
    sizeMB: 484,
    description: 'Лёгкая модель для слабых машин и быстрого старта.',
    requires: 'faster-whisper'
  },
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    engine: 'faster-whisper',
    huggingfaceId: 'Systran/faster-whisper-base',
    languages: ['multi'],
    sizeMB: 148,
    description: 'Крошечная модель для тестов и очень старых ПК.',
    requires: 'faster-whisper'
  },
  {
    id: 'parakeet-tdt-0.6b-v3',
    name: 'Parakeet TDT 0.6B v3',
    engine: 'onnx-asr',
    engineModelId: 'nemo-parakeet-tdt-0.6b-v3',
    huggingfaceId: 'nvidia/parakeet-tdt-0.6b-v3',
    languages: ['multi'],
    sizeMB: 700,
    description: 'NVIDIA Parakeet v3 — мультиязычная модель (en/de/es/fr), инференс через onnx-asr.',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-v3-ctc',
    name: 'GigaAM v3 CTC',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-v3-onnx',
    languages: ['ru'],
    sizeMB: 900,
    description: 'GigaAM v3 (рус.), CTC-декодер — самая быстрая вариация (onnx-asr).',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-v3-rnnt',
    name: 'GigaAM v3 RNN-T',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-v3-onnx',
    languages: ['ru'],
    sizeMB: 900,
    description: 'GigaAM v3 (рус.), RNN-T декодер — максимальная точность (onnx-asr).',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-v3-e2e-ctc',
    name: 'GigaAM v3 E2E CTC',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-v3-onnx',
    languages: ['ru'],
    sizeMB: 900,
    description: 'GigaAM v3 E2E (рус.) — сразу с пунктуацией и нормализацией текста.',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-v3-e2e-rnnt',
    name: 'GigaAM v3 E2E RNN-T',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-v3-onnx',
    languages: ['ru'],
    sizeMB: 900,
    description: 'GigaAM v3 E2E (рус.) — RNN-T + пунктуация (onnx-asr).',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-multilingual-ctc',
    name: 'GigaAM Multilingual CTC',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-multilingual-ctc-onnx',
    languages: ['multi'],
    sizeMB: 1059,
    description: 'GigaAM Multilingual (ru/en/kk/ky/uz), CTC — компактная мультиязычная модель (onnx-asr).',
    requires: 'onnx-asr'
  },
  {
    id: 'gigaam-multilingual-large-ctc',
    name: 'GigaAM Multilingual Large CTC',
    engine: 'onnx-asr',
    huggingfaceId: 'istupakov/gigaam-multilingual-large-ctc-onnx',
    languages: ['multi'],
    sizeMB: 2800,
    description: 'GigaAM Multilingual Large (ru/en/kk/ky/uz) — максимальная точность среди GigaAM (onnx-asr).',
    requires: 'onnx-asr'
  },
  {
    id: 'parakeet-tdt-0.6b-v2',
    name: 'Parakeet TDT 0.6B v2',
    engine: 'sherpa-onnx',
    huggingfaceId: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2',
    languages: ['en'],
    sizeMB: 1100,
    description: 'NVIDIA NeMo Parakeet — сверхбыстрый английский ASR (ONNX, sherpa-onnx).',
    requires: 'sherpa-onnx'
  },
  {
    id: 'gigaam-v2',
    name: 'GigaAM v2',
    engine: 'gigaam',
    languages: ['ru'],
    sizeMB: 400,
    description: 'Русская ASR-модель от AI-Research (Sber), полный офлайн.',
    requires: 'gigaam'
  }
];

export function getCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}
