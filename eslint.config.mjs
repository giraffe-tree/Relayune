import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "mobile/build/**",
    // Vendored, minified Lucide bundle for offline mobile previews.
    "mobile/assets/visualization/lucide.min.js",
    // Vendored, minified Mermaid bundle for offline mobile diagrams.
    "mobile/assets/mermaid/mermaid.min.js",
    "public/mermaid/mermaid.min.js",
    "desktop/dist/**",
    "desktop/.sidecar-build/**",
    "desktop/src-tauri/target/**",
    ".codex-deploy/**",
    // Local publication reports, downloaded audit tools and synthetic probes.
    ".public-prep/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
