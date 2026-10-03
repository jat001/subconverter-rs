import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import { defaultLocale, locales, type Locale } from './config';

// Both message files are small, so they are bundled instead of loaded per locale
const MESSAGES = { en, zh } satisfies Record<Locale, unknown>;

// The cookie name predates the move away from Next.js; keeping it keeps returning visitors' choice
const COOKIE_NAME = 'NEXT_LOCALE';

function readLocale(): Locale {
    const value = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`).exec(document.cookie)?.[1];
    return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : defaultLocale;
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);

export function useLocaleSetting() {
    const context = use(LocaleContext);
    if (!context) throw new Error('useLocaleSetting() must be used inside <I18nProvider>');
    return context;
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState(readLocale);
    const messages = MESSAGES[locale];

    useEffect(() => {
        document.documentElement.lang = locale;
        document.title = messages.Layout.title;
        document.querySelector('meta[name="description"]')?.setAttribute('content', messages.Layout.description);
    }, [locale, messages]);

    const setLocale = (next: Locale) => {
        document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
        setLocaleState(next);
    };

    return (
        <LocaleContext value={{ locale, setLocale }}>
            <IntlProvider locale={locale} messages={messages}>
                {children}
            </IntlProvider>
        </LocaleContext>
    );
}
