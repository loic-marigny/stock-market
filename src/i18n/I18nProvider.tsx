import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import en, { type TranslationKey, type Translations } from './lang';
import fr from './fr';
import ar from './ar';
import ru from './ru';

const STORAGE_KEY = 'stock-market:locale';

const dictionaries: Record<'en' | 'fr' | 'ar' | 'ru', Translations> = {
  en: en as Translations,
  fr,
  ar,
  ru,
};

export type Locale = keyof typeof dictionaries;

type ReplacementMap = Record<string, string | number>;

type LocaleOption = {
  code: Locale;
  label: string;
  flag: string;
  dir: 'ltr' | 'rtl';
};

const baseUrl = (import.meta as any).env?.BASE_URL || '/';
const resolveAsset = (path: string) => {
  const trimmed = path.replace(/^\//, '');
  return baseUrl.endsWith('/') ? `${baseUrl}${trimmed}` : `${baseUrl}/${trimmed}`;
};

const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'en', label: 'English', flag: resolveAsset('img/flags/us.png'), dir: 'ltr' },
  { code: 'fr', label: 'Fran\u00E7ais', flag: resolveAsset('img/flags/fr.png'), dir: 'ltr' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', flag: resolveAsset('img/flags/sa.png'), dir: 'ltr' },
  { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439', flag: resolveAsset('img/flags/ru.png'), dir: 'ltr' },
];

type I18nContextValue = {
  locale: Locale;
  t: (key: TranslationKey, replacements?: ReplacementMap) => string;
  setLocale: (locale: Locale) => void;
  availableLocales: LocaleOption[];
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function resolveInitialLocale(): Locale {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && stored in dictionaries) {
      return stored;
    }
    const browser = window.navigator.language.slice(0, 2).toLowerCase();
    if (browser === 'fr') return 'fr';
    if (browser === 'ar') return 'ar';
    if (browser === 'ru') return 'ru';
  }
  return 'en';
}

function interpolate(template: string, replacements?: ReplacementMap): string {
  if (!replacements) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = replacements[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const option = LOCALE_OPTIONS.find(item => item.code === locale) ?? LOCALE_OPTIONS[0];
      document.documentElement.lang = locale;
      document.documentElement.dir = option.dir;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, replacements?: ReplacementMap) => {
      const dict = dictionaries[locale];
      const template = dict[key] ?? String(key);
      return interpolate(template, replacements);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, t, setLocale, availableLocales: LOCALE_OPTIONS }),
    [locale, t, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}
