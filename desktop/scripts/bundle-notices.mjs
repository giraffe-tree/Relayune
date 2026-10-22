import { cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { collectBundleNotices, collectPackageNotices } from "../../scripts/bundle-notices.mjs";
import { bundleLicenseSupplements } from "../../scripts/license-supplements.mjs";

async function projectLicense(repositoryDirectory) {
  const source = join(repositoryDirectory, "LICENSE");
  if (!(await lstat(source)).isFile()) throw new Error("Project LICENSE must be a regular file, not a symlink.");
  const filename = await realpath(source);
  const location = relative(repositoryDirectory, filename);
  if (isAbsolute(location) || location === ".." || location.startsWith(`..${sep}`) || !(await stat(filename)).isFile()) {
    throw new Error("Project LICENSE must be a regular file inside the repository.");
  }
  return readFile(filename);
}

export async function writeDesktopBundleNotices({ repositoryDirectory, outputDirectory, resourceDirectory, moduleIds, metafile, artifactName }) {
  const collected = await collectBundleNotices({
    projectRoot: repositoryDirectory,
    workingDirectory: repositoryDirectory,
    supplementalLicenseFiles: bundleLicenseSupplements,
    ...(metafile ? { metafile } : { moduleIds }),
  });
  const coverage = {
    ...collected.coverage,
    artifact: artifactName,
    native_artifact_verified: false,
    native_runtime_review: {
      status: "unverified",
      scope: "This manifest covers actual embedded JavaScript inputs only; it is not a native application or installer license audit.",
      components: ["Node.js sidecar runtime and its bundled third-party components", "pkg-injected bootstrap/native payload", "Rust crates and linked native libraries", "system WebView and platform SDKs"],
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "THIRD_PARTY_NOTICES.txt"), collected.text);
  await writeFile(join(outputDirectory, "PROJECT-LICENSE.txt"), await projectLicense(repositoryDirectory));
  if (artifactName === "sidecar-javascript") {
    const tools = await collectPackageNotices({
      projectRoot: repositoryDirectory,
      packages: ["desktop/node_modules/@yao-pkg/pkg", "desktop/node_modules/@yao-pkg/pkg-fetch"],
      selection: "packaging-tool-source-provenance-only",
    });
    coverage.packaging_tool_evidence = {
      ...tools.coverage,
      notices_file: "PACKAGING-TOOL-NOTICES.txt",
      requested_node_target: "node22",
      verification: "Tool source metadata only. The final selected/cached runtime binary, its Node license and its embedded native dependencies have not been inspected by this JavaScript build step.",
    };
    await writeFile(join(outputDirectory, "PACKAGING-TOOL-NOTICES.txt"), tools.text);
  }
  await writeFile(join(outputDirectory, "COVERAGE.json"), `${JSON.stringify(coverage, null, 2)}\n`);
  // Replace only this bundle's generated subtree. A frontend build must not
  // remove notices already produced for the sidecar (or the reverse).
  await rm(resourceDirectory, { recursive: true, force: true });
  await mkdir(dirname(resourceDirectory), { recursive: true });
  await cp(outputDirectory, resourceDirectory, { recursive: true });
  return coverage;
}

export function desktopBundleNoticesPlugin({ desktopDirectory, repositoryDirectory }) {
  let moduleIds = [];
  return {
    name: "relayune-actual-bundle-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      moduleIds = [...new Set(Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .flatMap((chunk) => Object.entries(chunk.modules)
          .filter(([, module]) => module.renderedLength > 0)
          .map(([id]) => id)))].sort();
    },
    async writeBundle(options) {
      const outputDirectory = options.dir
        ? resolve(desktopDirectory, options.dir)
        : dirname(resolve(desktopDirectory, options.file));
      await writeDesktopBundleNotices({
        repositoryDirectory,
        outputDirectory: join(outputDirectory, "third-party-notices"),
        resourceDirectory: join(desktopDirectory, "src-tauri", "resources", "generated-notices", "desktop-web"),
        moduleIds,
        artifactName: "desktop-web-javascript",
      });
    },
  };
}
