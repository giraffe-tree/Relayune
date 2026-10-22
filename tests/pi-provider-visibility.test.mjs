import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("provider rail defaults to the three stable agents even when beta options exist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relayune-pi-rail-"));
  try {
    const outfile = join(directory, "rail.cjs");
    await build({ stdin: { contents: `import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import Rail from './app/agent-provider-options.tsx';
      export const render = (ids) => renderToStaticMarkup(React.createElement(Rail, {
        options: ids.map(id=>({id,label:id,shortLabel:id,icon:'terminal'})), selected:'codex',
        onSelect:()=>{},locale:'en',request:async()=>({agent_order:ids})}));`, resolveDir: process.cwd() },
      bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", logLevel: "silent" });
    const { render } = await import(pathToFileURL(outfile));
    assert.doesNotMatch(render(["codex"]), /data-agent-id="pi"/);
    const html = render(["codex", "claude", "kimi", "pi", "mcode", "zcode", "opencode", "claude-cowork"]);
    assert.doesNotMatch(html, /data-agent-id="(?:pi|mcode|zcode|opencode|claude-cowork)"/);
    for (const id of ["codex", "claude", "kimi"]) assert.ok(html.includes(`data-agent-id="${id}"`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
