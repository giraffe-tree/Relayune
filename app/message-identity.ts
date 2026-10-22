type MessageIdentity = {
  id: string;
  role: string;
  clientMessageId?: string | null;
};

// Relay acceptance and the native Agent echo have distinct event/item IDs.
// The client ID identifies one submission, even when identical text is sent twice.
export function sameMessageIdentity(a: MessageIdentity, b: MessageIdentity) {
  return a.id === b.id || (
    a.role === "user" && b.role === "user" &&
    Boolean(a.clientMessageId) && a.clientMessageId === b.clientMessageId
  );
}
