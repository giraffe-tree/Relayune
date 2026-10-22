export const CONVERSATION_BOTTOM_TOLERANCE_PX = 96;

export function conversationDistanceFromBottom(viewport) {
  return Math.max(
    0,
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
  );
}

export function isConversationNearBottom(
  viewport,
  tolerance = CONVERSATION_BOTTOM_TOLERANCE_PX,
) {
  return conversationDistanceFromBottom(viewport) <= tolerance;
}

/** @param {HTMLElement} viewport */
export function captureConversationPosition(viewport) {
  const bounds = viewport.getBoundingClientRect();
  const anchors = Array.from(
    viewport.querySelectorAll("[data-conversation-message-id]"),
  ).flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
      return [];
    }
    return [{
      id: element.getAttribute("data-conversation-message-id"),
      offset: rect.top - bounds.top,
    }];
  });
  return { top: viewport.scrollTop, anchors };
}

/**
 * @param {HTMLElement} viewport
 * @param {ReturnType<typeof captureConversationPosition>} position
 */
export function restoreConversationPosition(viewport, position) {
  const bounds = viewport.getBoundingClientRect();
  const elements = Array.from(
    viewport.querySelectorAll("[data-conversation-message-id]"),
  );
  for (const anchor of position.anchors) {
    const element = elements.find(
      (candidate) => candidate.getAttribute("data-conversation-message-id") === anchor.id,
    );
    if (!element || element.getBoundingClientRect().height === 0) continue;
    // Measure the anchor, not total height: new content below the reader must
    // not move them, and native browser scroll anchoring may already have run.
    viewport.scrollTop += element.getBoundingClientRect().top - bounds.top - anchor.offset;
    return;
  }
  viewport.scrollTop = position.top;
}
