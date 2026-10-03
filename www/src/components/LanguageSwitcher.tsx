import { locales, type Locale } from '@/i18n/config';
import { useLocaleSetting } from '@/i18n/locale';

export default function LanguageSwitcher() {
    // Switching re-renders the app with the new messages; the choice is kept in a cookie
    const { locale: currentLocale, setLocale } = useLocaleSetting();

    const handleLanguageChange = (newLocale: Locale) => {
        setLocale(newLocale);
    };

    // Language names in their native language - keep these hardcoded
    // since they should display in their own language regardless of current locale
    const LANGUAGE_NAMES: Record<string, string> = {
        en: 'English',
        zh: '中文'
    };

    return (
        <div className="flex items-center space-x-2">
            {locales.map((locale) => (
                <button
                    key={locale}
                    onClick={() => handleLanguageChange(locale)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentLocale === locale
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        } text-nowrap`}
                    aria-current={currentLocale === locale ? 'true' : 'false'}
                    title={`Switch to ${LANGUAGE_NAMES[locale]}`}
                >
                    {LANGUAGE_NAMES[locale]}
                </button>
            ))}
        </div>
    );
}
