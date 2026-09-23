/**
 * Speaky — single source of truth for branding.
 * Change the name/identity here and it propagates across the UI.
 */
export const BRAND = {
  name: 'Speaky',
  /** lowercase wordmark variant used in headers/titlebars */
  wordmark: 'speaky',
  tagline: 'печатайте со скоростью голоса',
  taglineEn: 'type at the speed of thought',
  appId: 'com.speaky.app',
  repoUrl: 'https://github.com/AnDrey1902/speaky',
  /** Brand accent — indigo/violet, pairs well with zinc-950 dark surfaces */
  accent: '#6366f1',
  accentSoft: '#818cf8',
} as const;

export default BRAND;
