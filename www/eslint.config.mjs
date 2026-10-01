import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Build output (flat config does not read .gitignore)
  globalIgnores([
    ".next/**",
    ".vercel/**",
    ".netlify/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vinext (Cloudflare Workers) output and local state
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
  ]),
  {
    // eslint-plugin-react's "detect" calls context.getFilename(), which ESLint 10 removed
    settings: { react: { version: "19" } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-expect-error": "allow-with-description"
      }]
    }
  }
]);

export default eslintConfig;
