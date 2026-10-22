# Fixed supplemental license evidence

These files add missing permission terms to specifically reviewed JavaScript package notices.
They do not replace publisher notices, select a project-wide license for dependencies, establish copyright assignments, or clear native/application redistribution.
The collector verifies exact package identity/version, repository-relative paths, source-file SHA-256 and safe fixed upstream URLs.

## Complete upstream texts

| Applicable package | Evidence file | SHA-256 | Fixed upstream source |
| --- | --- | --- | --- |
| `@next/env@16.3.8` | `node_modules/next/license.md` | `ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224` | [source](https://github.com/vercel/next.js/blob/v16.3.8/license.md) |
| `@tauri-apps/plugin-process@2.3.1` | `scripts/license-evidence/tauri-plugins-LICENSE_MIT` | `89ff9689dcf9dd53968785d05a26f7898bb169dbfcada8d032b3e68cf0d55607` | [source](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/process-v2.3.1/LICENSE_MIT) |
| `@tauri-apps/plugin-process@2.3.1` | `scripts/license-evidence/tauri-plugins-LICENSE_APACHE-2.0` | `0cec06e0e55fbc3dc5cee4fca9b607f66cb8f4e4dbcf3b3c013594dd156732e9` | [source](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/process-v2.3.1/LICENSE_APACHE-2.0) |
| `@tauri-apps/plugin-updater@2.10.1` | `scripts/license-evidence/tauri-plugins-LICENSE_MIT` | `89ff9689dcf9dd53968785d05a26f7898bb169dbfcada8d032b3e68cf0d55607` | [source](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/updater-v2.10.1/LICENSE_MIT) |
| `@tauri-apps/plugin-updater@2.10.1` | `scripts/license-evidence/tauri-plugins-LICENSE_APACHE-2.0` | `0cec06e0e55fbc3dc5cee4fca9b607f66cb8f4e4dbcf3b3c013594dd156732e9` | [source](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/updater-v2.10.1/LICENSE_APACHE-2.0) |
| `werift@0.24.4` | `scripts/license-evidence/werift-0.24.4-LICENSE` | `b83683f3f71b5971e6c2e33a8b894a49d752fd24c11b8ae08b53ca20f594fca5` | [source](https://raw.githubusercontent.com/shinyoshiaki/werift-webrtc/v0.24.4/LICENSE) |
| `dijkstrajs@1.0.3` | `scripts/license-evidence/SPDX-MIT-standard-terms.txt` | `b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5` | [source](https://raw.githubusercontent.com/spdx/license-list-data/d46e94e2c78ceede1cfc63cfa0396472d2798d4c/text/MIT.txt) |

Tauri process/updater package names and versions were also checked against each fixed tag's `plugins/process/package.json` / `plugins/updater/package.json`. Their package-owned `LICENSE.spdx` attribution remains in the generated notices.
The root integration independently verified Next16.3.8 official `license.md` bytes and the same-tag `packages/next-env/package.json` MIT declaration before supplying the exact @next/env mapping.

## Dijkstra standard terms are distinct evidence

`dijkstrajs@1.0.3` ships `LICENSE.md` with Wyatt Baldwin's original2008 copyright, an explicit MIT declaration and OSI MIT URL, and a disclaimer, but omits the grant paragraph. The upstream `v1.0.3/LICENSE.md` matches the installed file byte-for-byte.
The collector keeps that original text and separately appends unmodified SPDX License List Data v3.27.0 MIT standard terms at commit `d46e94e2c78ceede1cfc63cfa0396472d2798d4c`.
The standard `<year>` / `<copyright holders>` template is retained exactly; no person, year or authorization is invented or copied from another package.
Coverage labels this `standard-license-terms` and records the original `publisher_declaration` path/hash/source separately. This is a readable copy of the terms identified by the publisher's link, not an independent legal opinion.

Original declaration: `desktop/node_modules/dijkstrajs/LICENSE.md`; SHA-256 `c46324e45a005413535a6fb7a97e9eacd3cc6bf30335b7d5c10b8ee3af9e60c2`; [fixed source](https://raw.githubusercontent.com/tcort/dijkstrajs/v1.0.3/LICENSE.md).

## Reviewed README License sections

The complete MIT grant, condition, disclaimer and original attribution are read only from the License section of these exact package versions, never the entire README. Markdown subheadings and reference definitions terminate the extracted section.

| Package | Source/review basis |
| --- | --- |
| `fastdom@1.0.12` | Complete MIT text and Wilson Page2016 attribution in the published package README. |
| `strictdom@1.0.1` | Complete MIT text and Wilson Page2013 attribution in the published package README. |
| `agent-base@6.0.2` | Published README matches npm gitHead upstream [source](https://raw.githubusercontent.com/TooTallNate/node-agent-base/c4b8ea2e1a11bae023bb09b708050a50418204e9/README.md); full README SHA-256 `f1425c3b72330fe4fb2aa5a2fb152e939bdf534692a32b5f0b38f74147b98556`. Only its Setext License section is retained. |
| `https-proxy-agent@5.0.1` | Published README matches npm gitHead upstream [source](https://raw.githubusercontent.com/TooTallNate/node-https-proxy-agent/d0d80cc0482f20495aa8595f802e1a9f3b1b3409/README.md); full README SHA-256 `32f0856d2c43df7d05cca960fdee84e1e38ab545bd7b2186433dfa41aa90a712`. Only its Setext License section is retained. |

## Explicit unresolved evidence

`client-only@0.0.1` declares MIT in package metadata but supplies no authentic copyright/permission text or npm gitHead. No Meta copyright or unrelated React license has been guessed for it.
Only the Web runtime superset may report this exact reviewed package path and package.json hash as unresolved when its caller supplies the explicit descriptor. The resulting materials state `notices_complete:false` and `risk_accepted:false`. Actual bundle/package collection still fails by default; every new unknown gap fails.
Code already prebundled inside published npm files is not automatically enumerated as separately versioned embedded libraries. The generated exclusions retain that boundary.

## Artifact-bound Web exclusion

The absence of package-owned permission text for `client-only@0.0.1` is **not** repaired or waived. For the static Web export only, the normal build wrapper enables private production browser source maps and verifies the actual emitted `out/_next/static/**/*.js` files before generating notices. Every linked map's complete `sources` and `sourcesContent` inventory is checked, including sources without selected mapping segments. A `client-only` path or the exact nonempty published `error.js` content blocks exclusion. Its empty `index.js`, original `error.js`, package metadata and the exact package file set are pinned; changed bytes require review.

Unmapped JavaScript must be byte-identical to installed Next's `polyfill-nomodule.js`, or a strictly parsed generated data manifest. Exported HTML scripts must reference reviewed chunks, contain JSON Flight data, or equal the project's reviewed 404 bootstrap. Unknown JavaScript or inline executable code fails. Turbopack currently emits shifted generated columns around some Unicode/multiline templates, so this is compiler-provided source-inventory evidence, **not** a claim that source-map positions cover each emitted byte or a general legal clearance.

The wrapper saves source maps and provenance under ignored `.public-prep/web-license-provenance/`, removes only the exact final standalone map directive from JS/CSS, and removes maps from `out`. It binds each final JS hash, private map hash, current source/build input snapshot and HTML script inventory. The Web collector independently rechecks that evidence before removing this one unused package from the conservative runtime superset. Missing/stale evidence, new scripts, changed source inputs or altered package/map bytes fail. The public coverage records `artifact_excluded_packages`, the artifact manifest hash and the explicit scope; other package/bundle collectors retain their default failure for missing permission text.

This proof concerns the emitted static Web export. It does not clear `client-only` for another output, the Next server installation, native executables, or undiscovered components already prebundled inside published npm files. No upstream author or copyright has been inferred for this package.
