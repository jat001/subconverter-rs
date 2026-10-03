import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';

// Path for the startup page
const STARTUP_PATH = '/startup';
// Key for localStorage flag
const INIT_FLAG_KEY = 'webappInitialized';

const readInitFlag = () => localStorage.getItem(INIT_FLAG_KEY) === 'true';
// The startup page sets the flag and then navigates, which re-renders this component and
// re-reads it, so there is nothing to subscribe to
const subscribe = () => () => {};

export default function AppInitializer({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const isInitialized = useSyncExternalStore(subscribe, readInitFlag);

    useEffect(() => {
        console.log(`AppInitializer: Initialized flag = ${isInitialized}`);

        // If not initialized and not already on the startup page, redirect
        if (!isInitialized && pathname !== STARTUP_PATH) {
            console.log(`AppInitializer: Redirecting to ${STARTUP_PATH}`);
            navigate(STARTUP_PATH, { replace: true });
        } else if (isInitialized && pathname === STARTUP_PATH) {
            // If somehow initialized but still on startup, redirect home
            console.log(`AppInitializer: Already initialized, redirecting from ${STARTUP_PATH} to /`);
            navigate('/', { replace: true });
        }
    }, [isInitialized, pathname, navigate]);

    // Don't render children while redirecting to or away from the startup page; the startup page
    // itself renders while the app is not initialized
    if ((!isInitialized && pathname !== STARTUP_PATH) || (isInitialized && pathname === STARTUP_PATH)) {
        return null;
    }

    return <>{children}</>;
}
