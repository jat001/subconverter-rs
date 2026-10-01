'use client';

import { useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { getAdminTokenRequest, resolveAdminTokenRequest, subscribeAdminTokenRequest } from '@/lib/admin-token';

/**
 * Asks for the admin token when an /api/admin request is rejected (see adminFetch()).
 * Mounted once in the root layout.
 */
export default function AdminTokenDialog() {
    const t = useTranslations('AdminAuth');
    const commonT = useTranslations('Common');
    const request = useSyncExternalStore(subscribeAdminTokenRequest, getAdminTokenRequest, () => null);
    const [token, setToken] = useState('');

    if (!request) return null;

    const close = (value: string | null) => {
        setToken('');
        resolveAdminTokenRequest(value);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <form
                className="bg-gray-800 p-4 rounded max-w-sm w-full text-gray-200"
                onSubmit={(e) => {
                    e.preventDefault();
                    const value = token.trim();
                    if (value) close(value);
                }}
            >
                <h3 className="text-lg font-semibold mb-2">{t('title')}</h3>
                <p className="mb-4 text-sm text-gray-300">{request.invalid ? t('invalid') : t('description')}</p>
                <input
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full p-2 mb-4 border border-gray-600 rounded bg-gray-700 text-gray-200"
                    placeholder={t('placeholder')}
                    aria-label={t('placeholder')}
                />
                <div className="flex justify-end space-x-2">
                    <button
                        type="button"
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                        onClick={() => close(null)}
                    >
                        {commonT('cancel')}
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                    >
                        {commonT('submit')}
                    </button>
                </div>
            </form>
        </div>
    );
}
