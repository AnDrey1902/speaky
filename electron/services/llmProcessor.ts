import { ActiveContext, LLMProvider } from '../../src/types';
import { storage } from './storage';
import { postJson } from './httpClient';

export function cleanTextRules(text: string, context: ActiveContext): string {
  let cleaned = text;

  // 1. Hands-free voice commands
  cleaned = cleaned
    .replace(/(?:с\s+новой\s+строки|новая\s+строка)/gi, '\n')
    .replace(/(?:новый\s+абзац|с\s+нового\s+абзаца)/gi, '\n\n')
    .replace(/(?:(?<![а-яёa-z0-9])точка\s+с\s+запятой(?![а-яёa-z0-9]))/gi, ';')
    .replace(/(?:(?<![а-яёa-z0-9])двоеточие(?![а-яёa-z0-9]))/gi, ':')
    .replace(/(?:(?<![а-яёa-z0-9])знак\s+вопроса|вопросительный\s+знак(?![а-яёa-z0-9]))/gi, '?')
    .replace(/(?:(?<![а-яёa-z0-9])восклицательный\s+знак(?![а-яёa-z0-9]))/gi, '!')
    .replace(/(?:(?<![а-яёa-z0-9])тире(?![а-яёa-z0-9]))/gi, ' — ');

  // 2. Remove verbal filler words if enabled
  const settings = storage.getSettings();
  if (settings.removeFillerWords) {
    const fillerPatterns = [
      /(?<![а-яёa-z0-9])(?:ээ+|мм+|нуу+|аа+)(?![а-яёa-z0-9])/gi,
      /(?<![а-яёa-z0-9])(?:как\s+бы|типа|короче|в\s+общем-то|так\s+сказать)(?![а-яёa-z0-9])/gi
    ];

    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Verbal self-correction e.g. "в пять, ой нет, в шесть" -> "в шесть"
    cleaned = cleaned.replace(/(?<![а-яёa-z0-9])([а-яёa-z0-9]+)[,\s]+(?:ой\s+нет|ой|не|вернее|точнее)[,\s]+([а-яёa-z0-9]+)(?![а-яёa-z0-9])/gi, '$2');
  }

  // 3. User Snippets replacement
  const snippets = storage.getSnippets();
  for (const snippet of snippets) {
    if (snippet.trigger && snippet.replacement) {
      const escapedTrigger = snippet.trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![а-яёa-z0-9])${escapedTrigger}(?![а-яёa-z0-9])`, 'gi');
      cleaned = cleaned.replace(regex, snippet.replacement);
    }
  }

  // 4. Custom Dictionary exact casing replacements
  const dictionary = storage.getDictionary();
  for (const item of dictionary) {
    if (item.word) {
      const escapedWord = item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![а-яёa-z0-9])${escapedWord}(?![а-яёa-z0-9])`, 'gi');
      cleaned = cleaned.replace(regex, item.word);
    }
  }

  // 5. Clean duplicate whitespace and orphan punctuation
  cleaned = cleaned
    .replace(/[ ]+/g, ' ')
    .replace(/ \./g, '.')
    .replace(/ ,/g, ',')
    .replace(/ \?/g, '?')
    .replace(/ !/g, '!')
    .replace(/\n /g, '\n')
    .trim();

  // 6. Context-aware adaptations (works even offline without LLM)
  if (context.category === 'code' || context.category === 'terminal') {
    cleaned = cleaned.replace(/\.$/, '');
    cleaned = cleaned
      .replace(/(?<![а-яёa-z0-9])гит\s+статус(?![а-яёa-z0-9])/gi, 'git status')
      .replace(/(?<![а-яёa-z0-9])гит\s+коммит(?![а-яёa-z0-9])/gi, 'git commit')
      .replace(/(?<![а-яёa-z0-9])гит\s+пуш(?![а-яёa-z0-9])/gi, 'git push')
      .replace(/(?<![а-яёa-z0-9])нпм\s+ран(?![а-яёa-z0-9])/gi, 'npm run')
      .replace(/(?<![а-яёa-z0-9])конст(?![а-яёa-z0-9])/gi, 'const ')
      .replace(/(?<![а-яёa-z0-9])ретурн(?![а-яёa-z0-9])/gi, 'return ')
      .replace(/(?<![а-яёa-z0-9])стрелочка(?![а-яёa-z0-9])/gi, '=>')
      .replace(/(?<![а-яёa-z0-9])равно(?![а-яёa-z0-9])/gi, '=');
  } else if (context.category === 'chat') {
    if (!cleaned.includes('\n') && cleaned.split(' ').length <= 15) {
      cleaned = cleaned.replace(/\.$/, '');
    }
    cleaned = cleaned
      .replace(/(?<![а-яёa-z0-9])(?:смайлик|улыбка)(?![а-яёa-z0-9])/gi, '😊')
      .replace(/(?<![а-яёa-z0-9])сердечко(?![а-яёa-z0-9])/gi, '❤️')
      .replace(/(?<![а-яёa-z0-9])огонь(?![а-яёa-z0-9])/gi, '🔥')
      .replace(/(?<![а-яёa-z0-9])палец\s+вверх(?![а-яёa-z0-9])/gi, '👍');
  } else if (context.category === 'document') {
    cleaned = cleaned
      .replace(/"([^"]+)"/g, '«$1»')
      .replace(/\s+-\s+/g, ' — ');
  }

  // Capitalize first letter if not code or already formatted
  if (context.category !== 'code' && context.category !== 'terminal' && cleaned.length > 0 && !cleaned.startsWith('\n')) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/* ── Shared LLM chat helper ─────────────────────────────────────────── */

interface LLMCall {
  url: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

function buildCall(
  provider: LLMProvider,
  settings: ReturnType<typeof storage.getSettings>,
  maxTokens: number
): LLMCall | null {
  const modelOverride = settings.llmModels?.[provider];
  switch (provider) {
    case 'groq':
      return settings.groqApiKey
        ? {
            url: 'https://api.groq.com/openai/v1/chat/completions',
            apiKey: settings.groqApiKey,
            model: modelOverride || 'llama-3.3-70b-versatile',
            maxTokens
          }
        : null;
    case 'openai':
      return settings.openaiApiKey
        ? {
            url: 'https://api.openai.com/v1/chat/completions',
            apiKey: settings.openaiApiKey,
            model: modelOverride || 'gpt-4o-mini',
            maxTokens
          }
        : null;
    case 'gemini':
      // Gemini exposes an OpenAI-compatible endpoint
      return settings.geminiApiKey
        ? {
            url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            apiKey: settings.geminiApiKey,
            model: modelOverride || 'gemini-2.5-flash',
            maxTokens
          }
        : null;
    case 'openai-compatible': {
      if (!settings.customLlmBaseUrl || !modelOverride) return null;
      const base = settings.customLlmBaseUrl.trim().replace(/\/+$/, '');
      const url = /\/chat\/completions$/.test(base)
        ? base
        : /\/v\d+$/.test(base)
        ? `${base}/chat/completions`
        : `${base}/v1/chat/completions`;
      return { url, apiKey: settings.customLlmApiKey || '', model: modelOverride, maxTokens };
    }
    default:
      return null;
  }
}

/**
 * Returns LLM endpoints ordered by the user-chosen post-processing provider,
 * with every other configured provider as fallback.
 */
function orderedLLMCalls(maxTokens: number): LLMCall[] {
  const settings = storage.getSettings();
  const primary: LLMProvider = settings.llmProvider || 'groq';
  const all: LLMProvider[] = ['groq', 'openai', 'gemini', 'openai-compatible'];
  const order = [primary, ...all.filter((p) => p !== primary)];
  return order
    .map((p) => buildCall(p, settings, maxTokens))
    .filter((c): c is LLMCall => Boolean(c));
}

/** Whether at least one LLM provider is configured */
export function hasConfiguredLLM(): boolean {
  return orderedLLMCalls(1).length > 0;
}

async function chatCompletion(call: LLMCall, systemPrompt: string, userPrompt: string, temperature: number): Promise<string | null> {
  try {
    const headers: Record<string, string> = call.apiKey
      ? { Authorization: `Bearer ${call.apiKey}` }
      : {};
    const res = await postJson(
      call.url,
      headers,
      {
        model: call.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: call.maxTokens
      }
    );
    if (res.ok) {
      const data: any = await res.json();
      const output = data.choices?.[0]?.message?.content?.trim();
      if (output) return output;
    } else {
      console.warn(`[LLM] ${call.model} HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[LLM] ${call.model} request failed:`, err);
  }
  return null;
}

/** Resolve the active user-defined post-processing prompt template. */
function activeSystemPrompt(): string {
  const prompts = storage.getPrompts();
  const settings = storage.getSettings();
  const active =
    prompts.find((p) => p.id === settings.activePromptId) ||
    prompts.find((p) => p.isDefault) ||
    prompts[0];
  return (
    active?.body ||
    'Ты — AI-корректор надиктованной речи. Убери слова-паразиты, исправь ошибки и расставь пунктуацию. Верни ТОЛЬКО готовый текст.'
  );
}

/* ── Post-processing ────────────────────────────────────────────────── */

/**
 * AI Speech Text Corrector:
 * Uses the active custom prompt template with the configured LLM provider
 * (Groq Llama-3.3-70b / OpenAI gpt-4o-mini), rule-based fallback offline.
 */
export async function refineTextWithLLM(text: string, context: ActiveContext): Promise<string> {
  const settings = storage.getSettings();

  if (settings.aiCorrection === false || !hasConfiguredLLM()) {
    return cleanTextRules(text, context);
  }

  let styleInstruction = 'Естественная грамотная речь.';
  if (context.category === 'code' || context.category === 'terminal') {
    styleInstruction = 'Редактор кода/терминал. Технические термины, переменные и команды пиши на правильном английском (camelCase, snake_case, git команды). В конце строки не ставь точку.';
  } else if (context.category === 'chat') {
    styleInstruction = 'Мессенджер/чат. Живой и лаконичный разговорный тон. Не ставь точку в конце коротких фраз.';
  } else if (context.category === 'document') {
    styleInstruction = 'Деловой документ. Строгий стиль, кавычки-ёлочки («»), длинные тире (—), суммы и числа цифрами.';
  }

  const systemPrompt = `${activeSystemPrompt()}\nСтиль контекста: ${styleInstruction}`;

  for (const call of orderedLLMCalls(1024)) {
    const output = await chatCompletion(call, systemPrompt, text, 0.1);
    if (output) {
      return cleanTextRules(output, context);
    }
  }

  return cleanTextRules(text, context);
}

/* ── Translate mode ─────────────────────────────────────────────────── */

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'русский',
  en: 'английский',
  es: 'испанский',
  de: 'немецкий',
  fr: 'французский',
  zh: 'китайский'
};

/**
 * Translate dictated text into the target language (Translate mode).
 * Uses the editable translate prompt from settings.
 */
export async function translateTextWithLLM(
  text: string,
  targetLang: string,
  context: ActiveContext
): Promise<string> {
  const settings = storage.getSettings();

  if (!hasConfiguredLLM()) {
    // Offline fallback: no LLM — keep raw text rather than dropping it
    return text;
  }

  const targetName = LANGUAGE_NAMES[targetLang] || targetLang;
  const basePrompt =
    settings.translatePrompt ||
    'Переведи надиктованный текст на указанный целевой язык. Верни ТОЛЬКО перевод без пояснений.';

  const systemPrompt = `${basePrompt}\nЦелевой язык: ${targetName}.`;

  for (const call of orderedLLMCalls(2048)) {
    const output = await chatCompletion(call, systemPrompt, text, 0.1);
    if (output) {
      return output.replace(/^["'«»]+|["'«»]+$/g, '').trim();
    }
  }

  return text;
}

/* ── Voice rewrite of selected text ─────────────────────────────────── */

export async function rewriteTextWithLLM(
  originalText: string,
  userInstruction: string,
  context: ActiveContext
): Promise<string> {
  const settings = storage.getSettings();
  if (!hasConfiguredLLM()) {
    return originalText;
  }

  const systemPrompt = `Ты — экспертный ИИ-редактор текста.
Твоя задача — изменить или переписать исходный текст строго по голосовой команде пользователя.
Команда может быть любой: перевод на любой язык, исправление ошибок/пунктуации, смена тона, сжатие, разворачивание, форматирование списком и т.д.
КРИТИЧЕСКИЕ ПРАВИЛА:
1. Верни ТОЛЬКО готовый результат!
2. Запрещены любые вступления, пояснения, примечания и кавычки вокруг всего текста.
3. Сохраняй исходный смысл, если команда прямо не просит изменить его.`;

  const userPrompt = `ИСХОДНЫЙ ТЕКСТ:\n"""\n${originalText}\n"""\n\nКОМАНДА:\n${userInstruction}`;

  for (const call of orderedLLMCalls(2048)) {
    const output = await chatCompletion(call, systemPrompt, userPrompt, 0.2);
    if (output) {
      return output;
    }
  }

  return originalText;
}
