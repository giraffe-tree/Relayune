import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopBundleNoticesPlugin } from "./scripts/bundle-notices.mjs";

const desktopDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clearScreen: false,
  plugins: [desktopBundleNoticesPlugin({ desktopDirectory, repositoryDirectory: resolve(desktopDirectory, "..") })],
  server: {
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "safari16",
    minify: "esbuild",
    // Packaged WebViews do not need source maps. Omitting them keeps original
    // TypeScript and DEV-only QA harness references out of release bundles.
    sourcemap: false,
  },
});
