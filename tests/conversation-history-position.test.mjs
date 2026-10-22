import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";
import {
  captureConversationPosition,
  restoreConversationPosition,
} from "../app/conversation-auto-scroll.mjs";

const directory = await mkdtemp(join(tmpdir(), "relayune-history-position-"));
after(() => rm(directory, { recursive: true, force: true }));
const outfile = join(directory, "viewport.mjs");
await build({
  entryPoints: ["app/conversation-viewport.tsx"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { ConversationViewport } = await import(pathToFileURL(outfile));

function fixture() {
  const viewport = {
    scrollTop: 450,
    scrollHeight: 2000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    querySelectorAll: () => elements,
  };
  const messages = [
    { id: "previous", top: 0, height: 400 },
    { id: "reading", top: 400, height: 500 },
    { id: "next", top: 900, height: 400 },
  ];
  const elements = messages.map((message) => ({
    getAttribute: () => message.id,
    getBoundingClientRect: () => ({
      top: 100 + message.top - viewport.scrollTop,
      bottom: 100 + message.top + message.height - viewport.scrollTop,
      height: message.height,
    }),
  }));
  const props = {
    sessionId: "a",
    viewportRef: { current: viewport },
    followsLatest: { current: false },
  };
  return { viewport, messages, elements, props, component: new ConversationViewport(props) };
}

test("history commit preserves the line reached while the request was in flight", () => {
  const { viewport, messages, props, component } = fixture();
  viewport.scrollTop = 650; // User scrolls after the request starts.
  const position = component.getSnapshotBeforeUpdate(props);
  for (const message of messages) message.top += 800;
  viewport.scrollHeight += 800;
  component.componentDidUpdate(props, null, position);
  assert.equal(viewport.scrollTop, 1450);
  assert.equal(messages[1].top - viewport.scrollTop, -250);
});

test("new content below the reader does not count as prepended history", () => {
  const { viewport, messages } = fixture();
  const position = captureConversationPosition(viewport);
  for (const message of messages) message.top += 300;
  viewport.scrollHeight += 1100; // 300 above, 800 streamed below.
  restoreConversationPosition(viewport, position);
  assert.equal(viewport.scrollTop, 750);
});

test("refreshing latest history while reading does not jump to the bottom", () => {
  const { viewport, props, component } = fixture();
  const position = component.getSnapshotBeforeUpdate(props);
  viewport.scrollHeight += 800;
  component.componentDidUpdate(props, null, position);
  assert.equal(viewport.scrollTop, 450);
});

test("browser scroll anchoring is not applied a second time", () => {
  const { viewport, messages } = fixture();
  const position = captureConversationPosition(viewport);
  for (const message of messages) message.top += 800;
  viewport.scrollTop += 800;
  restoreConversationPosition(viewport, position);
  assert.equal(viewport.scrollTop, 1250);
});

test("a surviving visible message anchors a page even if the first one was replaced", () => {
  const { viewport, messages, elements } = fixture();
  const position = captureConversationPosition(viewport);
  elements.splice(1, 1);
  messages[2].top += 200;
  restoreConversationPosition(viewport, position);
  assert.equal(viewport.scrollTop, 650);
});

test("missing anchors preserve the absolute position without using total height", () => {
  const { viewport, elements } = fixture();
  const position = captureConversationPosition(viewport);
  elements.length = 0;
  viewport.scrollHeight += 800;
  restoreConversationPosition(viewport, position);
  assert.equal(viewport.scrollTop, 450);
});

test("switching sessions never restores the previous session's position", () => {
  const { props, component } = fixture();
  component.props = { ...props, sessionId: "b" };
  assert.equal(component.getSnapshotBeforeUpdate(props), null);
});

test("readers following the latest messages still allow automatic tail scrolling", () => {
  const { props, component } = fixture();
  props.followsLatest.current = true;
  assert.equal(component.getSnapshotBeforeUpdate(props), null);
});


test("returning to a session restores its reading anchor, including new content above", () => {
  const { viewport, messages, props, component } = fixture();
  component.setState = (next) => { component.state = { ...component.state, ...next }; };
  const other = { ...props, sessionId: "b" };
  component.props = other;
  component.getSnapshotBeforeUpdate(props);
  component.componentDidUpdate(props, null, null);
  assert.equal(props.followsLatest.current, true);
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
  component.props = props;
  component.getSnapshotBeforeUpdate(other);
  for (const message of messages) message.top += 300;
  component.componentDidUpdate(other, null, null);
  assert.equal(props.followsLatest.current, false);
  assert.equal(viewport.scrollTop, 750);
  assert.equal(messages[1].top - viewport.scrollTop, -50);
  assert.equal(component.state.awayFromLatest, true);
});

test("returning to a session that followed latest still follows new output", () => {
  const { viewport, props, component } = fixture();
  component.setState = (next) => { component.state = { ...component.state, ...next }; };
  props.followsLatest.current = true;
  const other = { ...props, sessionId: "b" };
  component.props = other;
  component.getSnapshotBeforeUpdate(props);
  component.componentDidUpdate(props, null, null);
  component.props = props;
  component.getSnapshotBeforeUpdate(other);
  viewport.scrollHeight += 500;
  component.componentDidUpdate(other, null, null);
  assert.equal(viewport.scrollTop, 2500);
  assert.equal(props.followsLatest.current, true);
});


test("a fresh workbench mount resets a stale reading flag and immediately shows the tail", () => {
  const { viewport, props, component } = fixture();
  props.followsLatest.current = false;
  component.componentDidMount();
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
  assert.equal(props.followsLatest.current, true);
});

test("opening and late history commits reach the tail before paint", () => {
  const { viewport, props, component } = fixture();
  props.followsLatest.current = true;
  component.componentDidMount();
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
  viewport.scrollHeight += 900;
  component.componentDidUpdate(props, null, null);
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
});

test("switching away from a scrolled-up session opens the new session at its tail", () => {
  const { viewport, props, component } = fixture();
  component.props = { ...props, sessionId: "b" };
  component.componentDidUpdate(props, null, null);
  assert.equal(props.followsLatest.current, true);
  assert.equal(viewport.scrollTop, viewport.scrollHeight);
});
