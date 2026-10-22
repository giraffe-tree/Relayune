# Homepage task example

The homepage illustrates a **synthetic font-size settings task**.
`font-size-task.json` contains invented messages and placeholder timestamps for
an offline demonstration. It contains no source conversation ID, original user
quotation, private Git revision, or evidence of a real execution or test result.
The fixed date in message records is a rendering fixture, not an event date.
Do not export private task histories into this fixture.

The four stages reveal 1, 3, 5 and 6 messages from the same synthetic scenario.
The path `/Projects/Relayune`, device `Mac`, connection status and account state
are neutral fixtures. The accessible description identifies the content as a
synthetic offline example. The site-wide motion control and reduced-motion
preference pause the sequence.

The checked-in images are synthetic illustrations, not captures of production
widgets. `capture-manifest.json` describes their provenance. The
regeneration commands below render product components with the synthetic fixture;
they do not connect to an Agent or establish that the example task was executed.

## Regenerate

Use a clean, isolated checkout for consistent product source. The capture
scripts do not alter the production workbench, authentication or encryption.
Required: project Node dependencies, Flutter SDK, local Chrome and Playwright.
Set `PLAYWRIGHT_MODULE` to Playwright's `index.mjs` if it is not installed in
the project; set `CHROME_PATH` if Chrome is in a nonstandard location.

```sh
CAPTURE_CJK_FONT=/path/to/local/PingFang.ttc node scripts/marketing/capture.mjs
```

- Web: the actual `app/workbench-page.tsx`, CSS and child components are bundled
  into a temporary localhost renderer. An AST transform supplies initial React
  state and omits the page's lifecycle effects only in this temporary build.
  Missing state bindings fail the capture. Agent order is a local GET fixture;
  all other API requests and external network requests fail the capture.
  Screens are 1280 × 708 CSS pixels at 2× resolution.
- Phone: the actual Flutter `WorkbenchScreen`, theme and default small-font
  scope are rendered at 390 × 844 logical pixels at 3× resolution. The Flutter
  widget harness uses iOS layout, real local CJK/fonts and Material icons,
  without logging in, opening a Relay connection or running an Agent. This is
  a production-widget capture, not an iOS simulator screen recording. The
  system status area and hardware frame are presentation chrome. Host fonts
  are loaded locally for rendering and are not copied or distributed.
- PNG intermediates stay in ignored `work/marketing-capture/`. Eight WebP
  images go to `public/marketing/task-replay/`. The UI package version and synthetic-fixture
  provenance are recorded in `capture-manifest.json`; generated media have no
  network dependency or private Git history.

Inspect all eight images after regeneration, especially fonts, message
clipping, collapsed activities, and synthetic-example disclosure. Then build the
site and check synchronized playback, reduced motion, mobile widths and RTL
layouts.
Regenerate when the workbench UI or synthetic scenario changes; no automatic
production publishing is part of this workflow.

Serve the built `out/` directory locally, then run the browser checks:

```sh
REPLAY_BASE_URL=http://127.0.0.1:4178 node scripts/marketing/verify-replay.mjs
```

`REPLAY_WIDTH=390` selects a width for focused reruns. Screenshots go to ignored
`work/replay-qa/`. The checks use real browser timing and block external network
requests; only the site's existing unauthenticated entry check may call an API.
