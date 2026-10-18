"use client";
/**
 * QR Code demonstrativo para o modo ensaio e as prévias do editor.
 *
 * No ensaio não existe sessão: em vez de pedir o QR à API pública (daria 404 e consumiria o limite
 * de consultas por IP, que no auditório é compartilhado com os participantes), geramos um QR local
 * e o passamos ao `ScreenView` pela prop `qrUrl`.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export const DEMO_SESSION_CODE = "ENSAIO";

const PLACEHOLDER =
  "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ffffff"/></svg>');

let cached: Promise<string> | null = null;

function demoQr() {
  cached ??= QRCode.toDataURL("Gestalt Live — QR Code demonstrativo do modo ensaio (nenhuma sessão real).", {
    margin: 1,
    width: 512,
    errorCorrectionLevel: "M",
    color: { dark: "#0B1736", light: "#FFFFFF" },
  }).catch(() => PLACEHOLDER);
  return cached;
}

/** URL (data:) do QR demonstrativo; começa com um quadro branco até o QR ficar pronto. */
export function useDemoQr(): string {
  const [url, setUrl] = useState(PLACEHOLDER);
  useEffect(() => {
    let alive = true;
    void demoQr().then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, []);
  return url;
}
