export type AppMode = 'toggle' | 'ptt';
export type STTProvider = 'groq' | 'openai' | 'deepgram' | 'local';
export type LLMProvider = 'groq' | 'openai' | 'gemini' | 'openai-compatible';
export type DictationMode = 'dictation' | 'translate';
export type AppCategory = 'code' | 'chat' | 'document' | 'browser' | 'terminal' | 'general';

export interface ActiveContext {
  processName: string;
  windowTitle: string;
  category: AppCategory;
  categoryLabel: string;
  friendlyAppName?: string;
}

export type SpeechLanguage = 'ru' | 'en' | 'es' | 'de' | 'fr' | 'zh' | 'uk' | 'it' | 'auto';
export type UILanguage = 'auto' | 'ru' | 'en' | 'es' | 'de' | 'fr' | 'zh' | 'uk' | 'it';
/** Target languages supported by the dedicated Translate mode */
export type TranslateLanguage = 'en' | 'ru' | 'es' | 'de' | 'fr' | 'zh' | 'uk' | 'it';

export interface AppSettings {
  hotkey: string;
  mode: AppMode;
  provider: STTProvider;
  /** concrete local model id (see ModelCatalog) used when provider === 'local' */
  localModelId?: string;
  language?: SpeechLanguage;
  uiLanguage?: UILanguage;
  groqApiKey: string;
  openaiApiKey: string;
  deepgramApiKey: string;
  selectedMicId: string;
  autoPunctuation: boolean;
  removeFillerWords: boolean;
  contextAwareMode: boolean;
  soundFeedback: boolean;
  autoStart: boolean;
  handsFreeCommands: boolean;
  aiCorrection?: boolean;
  hudPosition?: { x: number; y: number };

  /* ── Post-processing ── */
  /** which LLM powers text post-processing (falls back to the other provider) */
  llmProvider?: LLMProvider;
  /** Gemini API key (llmProvider === 'gemini') */
  geminiApiKey?: string;
  /** Base URL of an OpenAI-compatible endpoint (llmProvider === 'openai-compatible'), e.g. http://localhost:11434/v1 */
  customLlmBaseUrl?: string;
  /** API key for the OpenAI-compatible endpoint (optional for local servers) */
  customLlmApiKey?: string;
  /** model id override per LLM provider; falls back to provider default */
  llmModels?: Partial<Record<LLMProvider, string>>;

  /* ── Local models from folder ── */
  /** user-registered models pointing at existing folders on disk */
  customLocalModels?: CustomLocalModel[];
  /** active prompt template id used for post-processing */
  activePromptId?: string;

  /* ── Translate mode ── */
  /** dedicated hotkey for translate-mode dictation */
  translateHotkey?: string;
  /** target language of translate mode */
  translateTargetLang?: TranslateLanguage;
  /** editable system prompt for translation */
  translatePrompt?: string;
  translateEnabled?: boolean;
}

/** Custom LLM prompt template for post-processing */
export interface PromptTemplate {
  id: string;
  name: string;
  /** system prompt body; user text is appended as the message */
  body: string;
  isDefault?: boolean;
}

/* ── Local speech model catalog ─────────────────────────────────────── */

/**
 * Local speech engines. `whisper.cpp` runs the bundled whisper-cli binary
 * (resources/whisper) and `transcribe.cpp` the bundled transcribe.dll
 * (resources/transcribe) — no Python required. Legacy python engines are kept
 * only for reading old custom-model registrations.
 */
export type ModelEngine = 'whisper.cpp' | 'transcribe.cpp' | 'faster-whisper' | 'gigaam' | 'sherpa-onnx' | 'onnx-asr';

export interface ModelCatalogEntry {
  id: string;
  name: string;
  engine: ModelEngine;
  /** e.g. 'Systran/faster-whisper-large-v3-turbo' or 'ggerganov/whisper.cpp' */
  huggingfaceId?: string;
  /** exact file inside the HF repo (single-file ggml models) */
  hfFile?: string;
  languages: string[];
  /** approximate download size in megabytes */
  sizeMB: number;
  description: string;
  /** runtime engine dependency hint (legacy python engines) */
  requires?: string;
  /** model key inside the engine if different from `id` */
  engineModelId?: string;
}

export interface InstalledModelInfo extends ModelCatalogEntry {
  installed: boolean;
  sizeOnDiskMB?: number;
  path?: string;
  /** registered from a user-picked folder, not from the catalog */
  isCustom?: boolean;
}

/** Local speech model registered from an arbitrary folder on disk */
export interface CustomLocalModel {
  id: string;
  /** user-facing name (defaults to folder name) */
  name: string;
  /** absolute path to the model folder */
  path: string;
  engine: ModelEngine;
  /** engine-specific model key (onnx-asr load_model id, etc.) */
  engineModelId?: string;
}

export type ModelDownloadState = 'idle' | 'checking' | 'downloading' | 'done' | 'error';

export interface ModelProgressEvent {
  modelId: string;
  state: ModelDownloadState;
  /** 0..100, -1 for indeterminate */
  percent?: number;
  receivedMB?: number;
  error?: string;
}

export interface DictationHistoryItem {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string;
  durationMs: number;
  latencyMs: number;
  appContext: string;
  category: AppCategory;
  mode?: DictationMode;
}

export interface CustomWord {
  id: string;
  word: string;
  replacement?: string;
  caseSensitive?: boolean;
}

export interface TextSnippet {
  id: string;
  trigger: string;
  replacement: string;
  description?: string;
}

export type HudState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

export interface SpeakyAPI {
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;

  getDictionary: () => Promise<CustomWord[]>;
  saveDictionary: (dictionary: CustomWord[]) => Promise<void>;
  getSnippets: () => Promise<TextSnippet[]>;
  saveSnippets: (snippets: TextSnippet[]) => Promise<void>;
  getHistory: () => Promise<DictationHistoryItem[]>;
  clearHistory: () => Promise<void>;
  exportHistory: (format?: 'md' | 'txt') => Promise<{ success: boolean; filePath?: string; reason?: string }>;
  onSnippetsChanged: (callback: (snippets: TextSnippet[]) => void) => () => void;
  /** Pushed by main after each dictation so the open History tab stays live */
  onHistoryChanged: (callback: (history: DictationHistoryItem[]) => void) => () => void;

  /* ── Post-processing prompts ── */
  getPrompts: () => Promise<PromptTemplate[]>;
  savePrompts: (prompts: PromptTemplate[]) => Promise<void>;

  /* ── Local model manager ── */
  getModelCatalog: () => Promise<InstalledModelInfo[]>;
  downloadModel: (modelId: string) => Promise<{ ok: boolean; error?: string }>;
  removeModel: (modelId: string) => Promise<{ ok: boolean; error?: string }>;
  onModelProgress: (callback: (ev: ModelProgressEvent) => void) => () => void;
  pickModelFolder: () => Promise<{ path: string; suggestedName: string; detectedEngine?: ModelEngine } | null>;
  checkHotkey: (accelerator: string) => Promise<{ available: boolean; error?: string }>;
  registerCustomModel: (model: CustomLocalModel) => Promise<{ ok: boolean; error?: string }>;
  unregisterCustomModel: (modelId: string) => Promise<{ ok: boolean; error?: string }>;

  openSettings: () => void;
  closeSettings: () => void;
  minimizeSettings: () => void;
  moveHud: (deltaX: number, deltaY: number) => void;
  hideHud: () => void;
  saveHudPosition: (pos: { x: number; y: number }) => void;
  notifyRecordingStopped: () => void;

  getActiveContext: () => Promise<ActiveContext>;
  injectText: (text: string) => Promise<boolean>;
  transcribeAudio: (
    audioData: ArrayBuffer,
    mimeType?: string,
    mode?: DictationMode
  ) => Promise<any>;
  /** Local engine availability: bundled whisper-cli binary + at least one downloaded model */
  checkLocalWhisper: () => Promise<{ available: boolean; error?: string }>;

  onTriggerRecording: (
    callback: (action: 'toggle' | 'start' | 'stop' | 'show' | 'translate') => void
  ) => () => void;
  onContextChanged: (callback: (context: ActiveContext) => void) => () => void;
  onSelectionChanged: (callback: (data: { hasSelection: boolean; snippet: string }) => void) => () => void;
  updateHudState: (state: HudState, message?: string, latencyMs?: number) => void;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;

  getUpdateStatus: () => Promise<any>;
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  installUpdate: () => Promise<any>;
  onUpdateStatusChanged: (callback: (status: any) => void) => () => void;
  getHarnessMetrics: () => Promise<any>;
}

declare global {
  interface Window {
    speakyAPI?: SpeakyAPI;
  }
}
