// Netlify platform entry (Functions v2, Node.js), registered for /api/* through `config.path`. The SPA is
// the publish directory, served from Netlify's CDN.
import app from '../../server/app.js';

export default (request: Request) => app.fetch(request);

export const config = {
    path: '/api/*',
};
