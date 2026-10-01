// Minimal typing for the Workers runtime module; only `env` (the wrangler.jsonc bindings) is used
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
