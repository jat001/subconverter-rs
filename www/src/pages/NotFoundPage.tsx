import { Link } from 'react-router';
import { useTranslations } from 'use-intl';
import LanguageSwitcher from '@/components/LanguageSwitcher';

export default function NotFoundPage() {
    const t = useTranslations('NotFoundPage');

    return (
        <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gray-900 px-6 text-center text-white">
            <LanguageSwitcher />
            <p className="text-6xl font-bold">404</p>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="max-w-lg text-gray-300">{t('description')}</p>
            <Link to="/" className="rounded bg-blue-600 px-5 py-3 text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400">
                {t('backToHome')}
            </Link>
        </main>
    );
}
