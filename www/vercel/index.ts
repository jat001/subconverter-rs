// Vercel's explicit proxy entry runs in Node.js and only matches /api/* (vercel.json).
// Return the shared API response directly; no rewrite or downstream function is needed.
import app from '../server/app.js';

export default (request: Request) => app.fetch(request);
