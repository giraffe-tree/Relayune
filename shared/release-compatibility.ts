/**
 * Product-version compatibility for the current E2EE pairing profile.
 *
 * Client 0.3.6 introduced the RFC 9382 SPAKE2 profile. Desktop 0.3.9 is the
 * first desktop release that accepts the profile's complete P-256 share.
 * Keep these bounds independent from the current release version: compatible
 * peers do not need to run identical releases.
 */
export const RELAYUNE_COMPATIBILITY = {
  desktop: {
    minimumClientVersion: "0.3.6",
  },
  web: {
    minimumDesktopVersion: "0.3.9",
  },
  mobile: {
    minimumDesktopVersion: "0.3.9",
  },
} as const;
