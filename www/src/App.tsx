import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import AdminTokenDialog from '@/components/AdminTokenDialog';
import AppInitializer from '@/components/AppInitializer';
import { I18nProvider } from '@/i18n/locale';
import NotFoundPage from '@/pages/NotFoundPage';
import { isPagePath, PAGE_PATHS, type PagePath } from '../page-routes';

// Each page is its own chunk, so the Monaco-based pages only load when visited
const PAGES = {
    '/': lazy(() => import('@/pages/HomePage')),
    '/admin': lazy(() => import('@/pages/AdminPage')),
    '/admin/rules': lazy(() => import('@/pages/AdminRulesPage')),
    '/config': lazy(() => import('@/pages/ConfigPage')),
    '/convert': lazy(() => import('@/pages/ConvertPage')),
    '/downloads': lazy(() => import('@/pages/DownloadsPage')),
    '/links': lazy(() => import('@/pages/LinksPage')),
    '/settings': lazy(() => import('@/pages/SettingsPage')),
    '/startup': lazy(() => import('@/pages/StartupPage')),
} satisfies Record<PagePath, unknown>;

function PageRoutes() {
    const { pathname } = useLocation();
    // React Router accepts extra trailing slashes; the static hosts do not. Keep the same exact
    // supported paths on both sides so an HTTP 404 cannot turn into a page or a startup redirect.
    if (!isPagePath(pathname)) return <NotFoundPage />;

    return (
        <Routes>
            {PAGE_PATHS.map((path) => {
                const Page = PAGES[path];
                return <Route key={path} path={path} caseSensitive element={<AppInitializer><Page /></AppInitializer>} />;
            })}
            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <I18nProvider>
                <Suspense fallback={null}>
                    <PageRoutes />
                </Suspense>
                <AdminTokenDialog />
            </I18nProvider>
        </BrowserRouter>
    );
}
