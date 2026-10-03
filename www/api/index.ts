// Vercel Function (Node.js runtime): vercel.json rewrites every /api/* request here, and the request keeps
// its original URL, so the Hono router sees the real path.
import app from '../server/app.js';

export default {
    fetch: (request: Request) => app.fetch(request),
};
