import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useTranslation } from '@/lib/i18n';
import { Layout } from '@/components/layout';
import { Camera, Flashlight, ArrowRight, X } from 'lucide-react';
import { useRecordScan, useGetProductByBarcode } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function Scan() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(true);
  const [barcodeStr, setBarcodeStr] = useState<string>('');
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const sessionId = getSessionId();

  const recordScanMutation = useRecordScan();
  const { data: productData, isError, error, isFetching } = useGetProductByBarcode(barcodeStr, {
    query: {
      enabled: !!barcodeStr,
      retry: false,
    } as any
  });

  useEffect(() => {
    if (!productData && !isError) return;
    
    if (productData) {
      setLocation(`/report/${productData.id}`);
    } else if (isError) {
      // 404
      setLocation(`/submit?barcode=${barcodeStr}`);
    }
  }, [productData, isError, setLocation, barcodeStr]);

  const detectedRef = useRef(false);

  useEffect(() => {
    if (manualMode || !scanning) return;
    detectedRef.current = false;

    let stream: MediaStream | null = null;
    let animationFrameId: number;
    let mounted = true;
    let zxingReader: any = null;

    const videoConstraints: MediaTrackConstraints = {
      facingMode: 'environment',
      // High resolution dramatically improves 1D barcode detection
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        setHasCamera(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.error(e));
        }

        // Try modern BarcodeDetector first (Chrome/Android)
        if ('BarcodeDetector' in window) {
          // @ts-ignore
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });

          const scanFrame = async () => {
            if (!videoRef.current || !mounted || detectedRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && !detectedRef.current) {
                detectedRef.current = true;
                handleDetect(barcodes[0].rawValue);
                return;
              }
            } catch (e) {
              // ignore per-frame errors
            }
            animationFrameId = requestAnimationFrame(scanFrame);
          };
          scanFrame();
        } else {
          // Fallback to ZXing (iOS Safari) — continuous decoding with TRY_HARDER
          const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import('@zxing/library');
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          ]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          // 150ms between decode attempts keeps the UI responsive
          zxingReader = new BrowserMultiFormatReader(hints, 150);

          if (videoRef.current && mounted) {
            // Let ZXing manage its own stream so it can decode continuously;
            // release ours first to free the camera.
            stream.getTracks().forEach(t => t.stop());
            stream = null;
            await zxingReader.decodeFromConstraints(
              { video: videoConstraints },
              videoRef.current,
              (result: any) => {
                if (result && mounted && !detectedRef.current) {
                  detectedRef.current = true;
                  handleDetect(result.getText());
                }
                // NotFoundException per frame is expected — keep scanning
              }
            );
          }
        }
      } catch (err) {
        console.error("Camera access denied or unavailable", err);
        if (mounted) setHasCamera(false);
      }
    }

    startCamera();

    return () => {
      mounted = false;
      if (zxingReader) { try { zxingReader.reset(); } catch { /* noop */ } }
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [scanning, manualMode]);

  const handleDetect = (code: string) => {
    setScanning(false);
    setBarcodeStr(code);
    recordScanMutation.mutate({ data: { eventType: 'scan_started', barcode: code, userSession: sessionId } });
  };

  const toggleFlashlight = async () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;
    const track = (videoRef.current.srcObject as MediaStream).getVideoTracks()[0];
    const capabilities = track.getCapabilities() as any;
    if (capabilities.torch) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: !flashlightOn }] as any
        });
        setFlashlightOn(!flashlightOn);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const submitManual = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const code = formData.get('barcode') as string;
    if (code) {
      handleDetect(code);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col h-full bg-black text-white relative">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <button onClick={() => setLocation('/')} className="p-2">
            <X className="w-6 h-6 text-white" />
          </button>
          <span className="font-mono text-sm font-bold tracking-widest uppercase">{t('scan_product')}</span>
          <button onClick={toggleFlashlight} className="p-2" disabled={!hasCamera || manualMode}>
            <Flashlight className={cn("w-6 h-6", flashlightOn ? "text-primary-strong" : "text-white opacity-70")} />
          </button>
        </div>

        {/* Camera View */}
        {!manualMode ? (
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            {hasCamera === false ? (
              <div className="text-center p-8 flex flex-col items-center gap-4">
                <Camera className="w-12 h-12 opacity-50" />
                <p>{t('camera_denied')}</p>
                <button 
                  onClick={() => setManualMode(true)}
                  className="mt-4 px-6 py-3 bg-white text-black font-bold uppercase tracking-widest text-sm"
                >
                  {t('manual_input')}
                </button>
              </div>
            ) : (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="absolute inset-0 w-full h-full object-cover"
                />
                
                {/* Scanner Frame UI */}
                <div className="relative z-10 w-[80%] aspect-square border-2 border-primary/50 flex flex-col items-center justify-center">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary -translate-x-1 -translate-y-1"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary translate-x-1 -translate-y-1"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary -translate-x-1 translate-y-1"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary translate-x-1 translate-y-1"></div>
                  
                  {scanning && (
                    <div className="w-full h-0.5 bg-primary/80 animate-[scan_2s_ease-in-out_infinite]" style={{ boxShadow: '0 0 10px 2px var(--color-primary)' }} />
                  )}
                  
                  {isFetching && (
                    <div className="bg-black/80 px-4 py-2 text-white font-mono text-xs uppercase tracking-widest animate-pulse">
                      Looking up...
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => setManualMode(true)}
                  className="absolute bottom-10 px-6 py-3 bg-black/50 backdrop-blur text-white font-mono uppercase tracking-widest text-xs border border-white/20"
                >
                  {t('manual_input')}
                </button>
              </>
            )}
          </div>
        ) : (
          /* Manual Input Mode */
          <div className="flex-1 bg-background text-foreground flex flex-col items-center justify-center p-6">
            <h2 className="text-2xl font-bold mb-6">{t('manual_input')}</h2>
            <form onSubmit={submitManual} className="w-full flex flex-col gap-4">
              <input 
                type="text" 
                name="barcode"
                placeholder="e.g. 4710000000000"
                className="w-full px-4 py-4 text-xl font-mono border-2 border-foreground bg-transparent text-center focus:outline-none focus:border-primary transition-colors"
                autoFocus
              />
              <button 
                type="submit" 
                className="w-full py-4 bg-foreground text-background font-bold tracking-widest flex items-center justify-center gap-2"
                disabled={isFetching}
              >
                {isFetching ? '...' : t('scan_product')} <ArrowRight className="w-5 h-5" />
              </button>
            </form>
            <button 
              onClick={() => { setManualMode(false); setScanning(true); }}
              className="mt-8 text-sm text-muted-foreground underline uppercase tracking-widest font-mono"
            >
              Back to Camera
            </button>
          </div>
        )}
        
      </div>
    </Layout>
  );
}
