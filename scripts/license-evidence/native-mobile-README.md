# Mobile native license evidence

`native-mobile-evidence/manifest.json` pins the original documents by byte size and
SHA-256. It deliberately distinguishes a same-version source/materials superset
from an exact linked-binary inventory. Project MIT is appended as its own section;
it does not relicense third-party code, supplier SDKs or trademarks.

Run from the repository root, using Node >=22.13:

```sh
node scripts/native-mobile-notices.mjs generate
node --test tests/native-mobile-notices.test.mjs
node scripts/native-mobile-notices.mjs verify-ios-app /absolute/path/Runner.app
node scripts/native-mobile-notices.mjs verify-android-archive /absolute/path/app.apk
# The same archive verifier accepts an Android .aab.
```

Generation uses only committed evidence, project LICENSE and the two mobile lock
files. It does not require CocoaPods, a Flutter installation, Gradle, networking,
signing or an application build. It writes the cross-platform superset to
`mobile/assets/native-notices/THIRD_PARTY_LICENSES.txt` and `COVERAGE.json`.
Register the text under `flutter: licenses:` and include that asset directory;
final verification checks both the compressed Flutter notice registry and the
separate resource files. The application exposes the registry with Flutter's
`showLicensePage`; merely placing an unregistered text asset in a package is not
the intended attribution mechanism.

Flutter 3.32.8 / engine ef0cd000916d64fa0c5d09cc809fa7ad244a5767 already supplies its
large complete engine license through `sky_engine/LICENSE`. Verification follows
the SDK license collector's exact composite-body/name algorithm. The built app's
library headings need not contain the Pub package name `sky_engine`.

PDFium Apple v10 is tied to its published build recipe/source revision and actual
cached static archive hashes. Its recipe selects chromium/7202, without XFA/V8 or
Skia. The bundled WASM separately matches the publisher's immutable Git blob for
138.0.7162.0. Both corresponding distributions' complete license materials are
retained; they are explicit supersets, not independently reproduced linker maps.
Two original documents contain one isolated Latin-1 copyright byte among UTF-8:
original evidence remains byte-for-byte hashed, and only that marked byte is
transcoded to UTF-8 for Flutter's text registry.

WebRTC 150.7871.01 keeps current generated build NOTICE plus fixed source-license
materials. The Android repository's old M92 `Licenses/WEBRTC.md` was not used as
M150 evidence. All 45 paths in the M150 generator are accounted for: 37 fixed-source
original files, 3 complete sections in the current generated NOTICE, an original
license for the upstream-deleted base64 component, and 4 obsolete Java build-dep
mapping paths absent from both the fixed tree and current generated dependency
set. No author statement is fabricated for those nonexistent paths. APK/AAR,
framework and source-material hashes are recorded separately: the publisher's
prefixed-stripped AAR is not claimed to be byte-identical to the resolved standard
Maven SDK or to an Apple framework.

The resolved Android graph includes 96 artifacts (91 distinct Maven coordinates),
with original AAR/JAR and nested `classes.jar` LICENSE/NOTICE/TXT/JSON material,
exact-version source copyright statements and declarations, and complete applicable
standard terms. Google ML Kit / Android SDK supplier terms retain their original
identity and links; they are not relabeled Apache. JPush/JCore retain their Maven
Apache declarations and the additional supplier-agreement copyright acknowledgement
required on an application's visible About/license surface. Supplier-account terms,
privacy behavior, signing and functional device acceptance are separate checks.

`notices_complete` concerns the selected original materials. Actual app verification
returns `notice_checks_passed`, actual resource/native hashes and pending independent
runtime/rebuild boundaries; it is not an assertion that an arbitrary application is
ready for release. There is no install, launch, signing, upload or publishing action
in this script. Refresh fixed evidence and version bindings when dependencies or
SDKs change; do not waive mismatches by editing generated output alone.
