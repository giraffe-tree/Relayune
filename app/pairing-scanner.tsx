"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type QrScanner from "qr-scanner";
import {
  authText,
  type AuthCopyKey,
  type AuthLocale,
} from "./auth-language";

const PAIRING_QR_PATTERN =
  /^relayune-pairing:v1:(pair_[A-Za-z0-9_-]{43}):([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})$/;

export type ScannedPairing = {
  pairingId: string;
  code: string;
};

export function parsePairingQrPayload(value: string): ScannedPairing | null {
  if (value.length > 96 || value.includes("://")) return null;
  const match = PAIRING_QR_PATTERN.exec(value);
  if (!match) return null;
  return { pairingId: match[1], code: match[2] };
}

type ScannerState = "idle" | "starting" | "scanning" | "error";

type PairingScannerProps = {
  locale: AuthLocale;
  disabled?: boolean;
  onScan: (pairing: ScannedPairing) => void;
};

function cameraErrorKey(error: unknown): AuthCopyKey {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "cameraPermissionDenied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "cameraNotFound";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "cameraInUse";
  }
  return "cameraUnavailable";
}

export default function PairingScanner({
  locale,
  disabled = false,
  onScan,
}: PairingScannerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const runIdRef = useRef(0);
  const acceptedRef = useRef(false);
  const [scannerState, setScannerState] = useState<ScannerState>("idle");
  const [statusKey, setStatusKey] = useState<AuthCopyKey>("cameraStarting");

  const stopCamera = useCallback(() => {
    runIdRef.current += 1;
    scannerRef.current?.destroy();
    scannerRef.current = null;
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (video) video.srcObject = null;
  }, []);

  const closeScanner = useCallback(
    (restoreFocus = true) => {
      stopCamera();
      acceptedRef.current = false;
      setScannerState("idle");
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
      if (restoreFocus && document.visibilityState === "visible") {
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") closeScanner(false);
    };
    const stopForPageHide = () => closeScanner(false);
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopForPageHide);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopForPageHide);
      stopCamera();
    };
  }, [closeScanner, stopCamera]);

  async function openScanner() {
    if (disabled || dialogRef.current?.open) return;
    acceptedRef.current = false;
    setScannerState("starting");
    setStatusKey("cameraStarting");
    dialogRef.current?.showModal();

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setScannerState("error");
      setStatusKey("cameraUnavailable");
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    try {
      const { default: QrScannerConstructor } = await import("qr-scanner");
      if (runId !== runIdRef.current || !dialogRef.current?.open) return;
      const video = videoRef.current;
      if (!video) throw new Error("camera preview unavailable");
      const scanner = new QrScannerConstructor(
        video,
        (result) => {
          if (acceptedRef.current || runId !== runIdRef.current) return;
          const pairing = parsePairingQrPayload(result.data);
          if (!pairing) {
            setStatusKey("invalidPairingQr");
            return;
          }
          acceptedRef.current = true;
          stopCamera();
          if (dialogRef.current?.open) dialogRef.current.close();
          setScannerState("idle");
          onScan(pairing);
        },
        {
          preferredCamera: "environment",
          maxScansPerSecond: 8,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
          // Decode misses are expected while the camera is moving. Never expose
          // decoder errors or scanned input through user-visible surfaces.
          onDecodeError: () => {},
        },
      );
      scannerRef.current = scanner;
      await scanner.start();
      if (runId !== runIdRef.current || !dialogRef.current?.open) {
        scanner.destroy();
        return;
      }
      setScannerState("scanning");
      setStatusKey("cameraScanHelp");
    } catch (error) {
      if (runId !== runIdRef.current) return;
      stopCamera();
      setScannerState("error");
      setStatusKey(cameraErrorKey(error));
    }
  }

  return (
    <div className="pairing-scanner-entry">
      <button
        ref={triggerRef}
        className="primary-button pairing-scan-button"
        type="button"
        disabled={disabled}
        onClick={() => void openScanner()}
      >
        <span aria-hidden="true">▣</span>
        {authText(locale, "scanPairingQr")}
      </button>
      <small>{authText(locale, "scanPairingQrHelp")}</small>
      <dialog
        ref={dialogRef}
        className="pairing-scanner-dialog"
        aria-labelledby="pairing-scanner-title"
        aria-describedby="pairing-scanner-help pairing-scanner-status"
        onCancel={(event) => {
          event.preventDefault();
          closeScanner();
        }}
        onClose={stopCamera}
      >
        <div className="pairing-scanner-heading">
          <div>
            <h2 id="pairing-scanner-title">
              {authText(locale, "cameraDialogTitle")}
            </h2>
            <p id="pairing-scanner-help">
              {authText(locale, "cameraDialogHelp")}
            </p>
          </div>
          <button
            className="pairing-scanner-close"
            type="button"
            aria-label={authText(locale, "closeScanner")}
            onClick={() => closeScanner()}
          >
            ×
          </button>
        </div>
        <div className="pairing-scanner-preview">
          <video ref={videoRef} autoPlay muted playsInline aria-hidden="true" />
          <span className="pairing-scanner-frame" aria-hidden="true" />
          {scannerState === "starting" && (
            <span className="pairing-scanner-loading" aria-hidden="true">
              <span className="spinner" />
            </span>
          )}
        </div>
        <p
          className={scannerState === "error" ? "scanner-error" : ""}
          id="pairing-scanner-status"
          role={scannerState === "error" ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {authText(locale, statusKey)}
        </p>
        <button
          className="text-button pairing-scanner-fallback"
          type="button"
          onClick={() => closeScanner()}
        >
          {authText(locale, "useManualCode")}
        </button>
      </dialog>
    </div>
  );
}
