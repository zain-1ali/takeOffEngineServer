/**
 * Cost Plan / bill report theme ids — keep in sync with frontend reportThemes.
 */
export const REPORT_THEME_IDS = [
  'zero-qs',
  'classic-slate',
  'forest',
  'charcoal',
  'terracotta',
] as const;

export type ReportThemeId = (typeof REPORT_THEME_IDS)[number];

export const DEFAULT_REPORT_THEME: ReportThemeId = 'zero-qs';

export function normalizeReportTheme(raw: unknown): ReportThemeId {
  if (typeof raw === 'string' && (REPORT_THEME_IDS as readonly string[]).includes(raw)) {
    return raw as ReportThemeId;
  }
  return DEFAULT_REPORT_THEME;
}
