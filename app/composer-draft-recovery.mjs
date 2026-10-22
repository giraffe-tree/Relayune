// A delivery failure can arrive after the user has started the next message.
// Keep both drafts, in their original order, without automatically resending.
export function restoreFailedComposerDraft(submittedDraft, nextDraft) {
  if (!submittedDraft) return nextDraft;
  if (!nextDraft) return submittedDraft;
  return `${submittedDraft}\n\n${nextDraft}`;
}
