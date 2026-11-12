"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

type ScanResult = {
  orderItemId: string;
  itemName: string;
  unit: string;
  qty: number;
  kind: "unidade" | "caixa";
  code: string;
};

type Props = {
  orderId: string;
  context: "saida" | "retorno";
  onScan: (result: ScanResult) => void;
  disabled?: boolean;
};

/**
 * Scanner de código de barras/QR pela câmera do celular.
 * Usa BarcodeDetector quando disponível (Chrome/Android); sempre oferece
 * digitação manual do código como fallback.
 */
export default function Scanner({ orderId, context, onScan, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldownRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const supported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  async function resolveCode(code: string) {
    if (!code || busy) return;
    const now = Date.now();
    if (now < cooldownRef.current) return;
    cooldownRef.current = now + 800; // evita leitura dupla do mesmo quadro

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pedidos/${orderId}/bipagem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, context }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha na bipagem");
      setLastCode(`${d.code} → +${d.qty} ${d.unit} (${d.itemName})`);
      onScanRef.current(d as ScanResult);
      setManual("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);

      if (supported) {
        // @ts-experimental BarcodeDetector é padrão no Chrome
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (o: { formats?: string[] }) => {
              detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        const detector = new Detector({
          formats: [
            "qr_code",
            "code_128",
            "code_39",
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "itf",
          ],
        });
        const tick = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              await resolveCode(codes[0].rawValue);
            }
          } catch {
            // frame sem código — ignora
          }
          if (streamRef.current) {
            requestAnimationFrame(() => void tick());
          }
        };
        void tick();
      } else {
        setError("Câmera ativa, mas o leitor automático não é suportado neste navegador. Digite o código.");
      }
    } catch {
      setError("Não foi possível abrir a câmera. Autorize o acesso ou digite o código.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }

  useEffect(() => () => stopCamera(), []);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-emerald-900">Bipagem</p>
        {active ? (
          <button
            type="button"
            onClick={stopCamera}
            className="text-xs font-semibold text-emerald-700 underline"
          >
            Parar câmera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={disabled}
            className="text-xs font-semibold text-emerald-700 underline"
          >
            Abrir câmera
          </button>
        )}
      </div>

      {active && (
        <video
          ref={videoRef}
          className="aspect-video w-full rounded-lg bg-black object-cover"
          muted
          playsInline
        />
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void resolveCode(manual.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Ou digite o código (ex.: LOC-XXXX-XXXX)"
          disabled={disabled}
          className="min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-base uppercase"
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <Button type="submit" disabled={disabled || busy || !manual.trim()} className="!w-auto">
          OK
        </Button>
      </form>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
      {lastCode && <p className="text-xs font-semibold text-emerald-800">Última: {lastCode}</p>}
      {active && !supported && (
        <p className="text-xs text-emerald-700">
          Dica: no Chrome/Android a câmera lê sozinha; no iPhone digite o código.
        </p>
      )}
    </div>
  );
}
