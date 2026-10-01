'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// Path for the startup page
const STARTUP_PATH = '/startup';
// Key for localStorage flag
const INIT_FLAG_KEY = 'webappInitialized';

const readInitFlag = () => localStorage.getItem(INIT_FLAG_KEY) === 'true';
// The startup page sets the flag and then navigates, which re-renders this component and
// re-reads it, so there is nothing to subscribe to
const subscribe = () => () => {};

export default function AppInitializer({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    // null on the server and during hydration, true/false once read on the client
    const isInitialized = useSyncExternalStore<boolean | null>(subscribe, readInitFlag, () => null);

    useEffect(() => {
        // Check localStorage only on the client side
        const initialized = readInitFlag();

        console.log(`AppInitializer: Initialized flag = ${initialized}`);

        // If not initialized and not already on the startup page, redirect
        if (!initialized && pathname !== STARTUP_PATH) {
            console.log(`AppInitializer: Redirecting to ${STARTUP_PATH}`);
            router.replace(STARTUP_PATH);
        } else if (initialized && pathname === STARTUP_PATH) {
            // If somehow initialized but still on startup, redirect home
            console.log(`AppInitializer: Already initialized, redirecting from ${STARTUP_PATH} to /`);
            router.replace('/');
        }
    }, [pathname, router]);

    // Don't render children until the initialization check is complete and successful,
    // or if we are already on the startup page (let it handle its own rendering)
    if (isInitialized === null || (!isInitialized && pathname !== STARTUP_PATH) || (isInitialized && pathname === STARTUP_PATH)) {
        // Render minimal content or a loading indicator while checking/redirecting
        // Returning null prevents rendering children during the redirect flicker
        return null;
    }

    // Render children only if initialized and not on the startup page
    return <>{children}</>;
}