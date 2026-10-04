// Cloudflare Workers entry (wrangler.jsonc). Workers static assets serve the SPA and only hand /api/* to
// this Worker (run_worker_first), so the Worker is just the API.
import app from './app.js';

export default app;
