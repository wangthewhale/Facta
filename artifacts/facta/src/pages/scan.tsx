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
    }
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

  useEffect(() => {
    let stream: MediaStream | null = null;
    let animationFrameId: number;
    let mounted = true;

    async function startCamera() {
      if (manualMode) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        setHasCamera(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Need user interaction for some play policies, but often works for muted inline video
          videoRef.current.play().catch(e => console.error(e));
        }

        // Try modern BarcodeDetector first
        if ('BarcodeDetector' in window) {
          // @ts-ignore
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          
          const scanFrame = async () => {
            if (!videoRef.current || !scanning || !mounted) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                const code = barcodes[0].rawValue;
                handleDetect(code);
                return; // Stop scanning
              }
            } catch (e) {
              // ignore
            }
            animationFrameId = requestAnimationFrame(scanFrame);
          };
          scanFrame();
        } else {
          // Fallback to ZXing
          const { BrowserMultiFormatReader } = await import('@zxing/library');
          const codeReader = new BrowserMultiFormatReader();
          if (videoRef.current) {
             codeReader.decodeFromVideoElement(videoRef.current, (result, err) => {
               if (result && mounted && scanning) {
                 handleDetect(result.getText());
               }
             });
          }
        }
      } catch (err) {
        console.error("Camera access denied or unavailable", err);
        setHasCamera(false);
      }
    }

    startCamera();

    return () => {
      mounted = false;
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
            <Flashlight className={cn("w-6 h-6", flashlightOn ? "text-primary" : "text-white opacity-70")} />
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
