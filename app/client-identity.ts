import { sha256Hex } from "../shared/pairing-pake";

// Separate from account credentials: logout and key rotation retain the browser
// identity. Clearing site data intentionally creates a new identity.
export async function browserClientIdentity(): Promise<string | undefined> {
  try {
    const id = await new Promise<string>((resolve, reject) => {
      const open = indexedDB.open("relayune-client-identity", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("identity");
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("identity storage blocked"));
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction("identity", "readwrite");
        const store = transaction.objectStore("identity");
        const read = store.get("id");
        let id: string;
        read.onsuccess = () => {
          id = typeof read.result === "string" && /^[a-f0-9]{64}$/.test(read.result)
            ? read.result
            : Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
          store.put(id, "id");
        };
        transaction.oncomplete = () => { db.close(); resolve(id); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
    return `web:${await sha256Hex(`relayune:web:v1:${id}`)}`;
  } catch {
    // Storage restrictions must not prevent explicit PAKE authorization.
    return undefined;
  }
}
