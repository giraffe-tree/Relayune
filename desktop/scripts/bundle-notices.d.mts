import type { Metafile } from "esbuild";
import type { Plugin } from "vite";

export function writeDesktopBundleNotices(options: {
  repositoryDirectory: string;
  outputDirectory: string;
  resourceDirectory: string;
  moduleIds?: string[];
  metafile?: Metafile;
  artifactName: "desktop-web-javascript" | "sidecar-javascript";
}): Promise<Record<string, unknown>>;

export function desktopBundleNoticesPlugin(options: {
  desktopDirectory: string;
  repositoryDirectory: string;
}): Plugin;
