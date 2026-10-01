import { getUserLocale } from '@/services/locale';
import { getRequestConfig } from 'next-intl/server';

// Supported languages
export const locales = ['en', 'zh'] as const;
export type Locale = (typeof locales)[number];

export default getRequestConfig(async () => {

    const locale = await getUserLocale();

    return {
        locale: locale,
        // Load messages for the resolved locale
        messages: (await import(`../../messages/${locale}.json`)).default
    };
});
