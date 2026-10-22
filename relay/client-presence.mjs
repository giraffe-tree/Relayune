// Reconstructible local UI metadata; never persist this snapshot or infer it from last_seen_at.
export function onlineBrowserIds(relay) {
  if (!relay.ready || relay.closed) return [];
  const ids = new Set();
  for (const peer of relay.onlineTransport?.peers.values() ?? []) {
    if (relay.onlineTransport.valid(peer)) ids.add(peer.browserId);
  }
  for (const peer of relay.directHost?.peers.values() ?? []) {
    if (relay.directHost.valid(peer) && peer.channel?.readyState === "open") ids.add(peer.browserId);
  }
  return [...ids].filter(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id)).sort().slice(0, 256);
}
