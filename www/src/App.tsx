import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import AdminTokenDialog from '@/components/AdminTokenDialog';
import AppInitializer from '@/components/AppInitializer';
import { I18nProvider } from '@/i18n/locale';

// Each page is its own chunk, so the Monaco-based pages only load when visited
const HomePage = lazy(() => import('@/pages/HomePage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const AdminRulesPage = lazy(() => import('@/pages/AdminRulesPage'));
const ConfigPage = lazy(() => import('@/pages/ConfigPage'));
const ConvertPage = lazy(() => import('@/pages/ConvertPage'));
const DownloadsPage = lazy(() => import('@/pages/DownloadsPage'));
const LinksPage = lazy(() => import('@/pages/LinksPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const StartupPage = lazy(() => import('@/pages/StartupPage'));

function NotFound() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-900 text-white">
            <h1 className="text-2xl font-bold">404</h1>
            <Link to="/" className="text-blue-400 hover:underline">/</Link>
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <I18nProvider>
                <AppInitializer>
                    <Suspense fallback={null}>
                        <Routes>
                            <Route path="/" element={<HomePage />} />
                            <Route path="/admin" element={<AdminPage />} />
                            <Route path="/admin/rules" element={<AdminRulesPage />} />
                            <Route path="/config" element={<ConfigPage />} />
                            <Route path="/convert" element={<ConvertPage />} />
                            <Route path="/downloads" element={<DownloadsPage />} />
                            <Route path="/links" element={<LinksPage />} />
                            <Route path="/settings" element={<SettingsPage />} />
                            <Route path="/startup" element={<StartupPage />} />
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                    </Suspense>
                </AppInitializer>
                <AdminTokenDialog />
            </I18nProvider>
        </BrowserRouter>
    );
}
