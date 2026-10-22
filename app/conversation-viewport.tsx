"use client";

import { Component, type ReactNode, type RefObject, type UIEventHandler } from "react";
import {
  captureConversationPosition,
  restoreConversationPosition,
} from "./conversation-auto-scroll.mjs";

type Props = {
  sessionId: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  followsLatest: RefObject<boolean>;
  onScroll: UIEventHandler<HTMLDivElement>;
  latestLabel?: string;
  children: ReactNode;
};

type Position = ReturnType<typeof captureConversationPosition> | null;

// A commit snapshot sees the user's position immediately before React changes
// the DOM, including any scrolling done while a history request was in flight.
export class ConversationViewport extends Component<Props> {
  state = { awayFromLatest: false };
  private positions = new Map<string, { position: NonNullable<Position>; followsLatest: boolean }>();

  componentDidMount() {
    // A newly mounted workbench has no previous DOM/position cache (for example
    // after renewing membership). Do not inherit a stale parent's scroll flag.
    this.props.followsLatest.current = true;
    const viewport = this.props.viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }

  getSnapshotBeforeUpdate(previous: Props): Position {
    const viewport = this.props.viewportRef.current;
    if (viewport && previous.sessionId !== this.props.sessionId) {
      this.positions.delete(previous.sessionId);
      this.positions.set(previous.sessionId, {
        position: captureConversationPosition(viewport),
        followsLatest: this.props.followsLatest.current,
      });
      if (this.positions.size > 30) this.positions.delete(this.positions.keys().next().value!);
      return null;
    }
    if (
      !viewport ||
      previous.sessionId !== this.props.sessionId ||
      this.props.followsLatest.current
    ) return null;
    return captureConversationPosition(viewport);
  }

  componentDidUpdate(previous: Props, _state: unknown, position: Position) {
    const viewport = this.props.viewportRef.current;
    if (viewport && previous.sessionId !== this.props.sessionId) {
      const saved = this.positions.get(this.props.sessionId);
      this.props.followsLatest.current = saved?.followsLatest ?? true;
      if (saved && !saved.followsLatest) restoreConversationPosition(viewport, saved.position);
      else viewport.scrollTop = viewport.scrollHeight;
      if (this.state.awayFromLatest !== !this.props.followsLatest.current) {
        this.setState({ awayFromLatest: !this.props.followsLatest.current });
      }
      return;
    }
    if (viewport && this.props.followsLatest.current) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    if (viewport && position) restoreConversationPosition(viewport, position);
  }

  render() {
    return (
      <>
      <div
        className="message-scroll"
        tabIndex={-1}
        ref={this.props.viewportRef}
        onScroll={(event) => {
          this.props.onScroll(event);
          const awayFromLatest = !this.props.followsLatest.current;
          if (awayFromLatest !== this.state.awayFromLatest) this.setState({ awayFromLatest });
        }}
      >
        {this.props.children}
      </div>
      {this.state.awayFromLatest && this.props.latestLabel && <div className="conversation-latest-bar">
        <button type="button" onClick={() => {
          const viewport = this.props.viewportRef.current;
          if (!viewport) return;
          this.props.followsLatest.current = true;
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
          viewport.focus({ preventScroll: true });
          this.setState({ awayFromLatest: false });
        }}>↓ {this.props.latestLabel}</button>
      </div>}
      </>
    );
  }
}
