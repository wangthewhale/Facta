import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useTranslation } from '@/lib/i18n';
import { Layout } from '@/components/layout';
import { Camera, Flashlight, ArrowRight, X, Image as ImageIcon, Keyboard, RefreshCw } from 'lucide-react';
import { useRecordScan, useGetProductByBarcode } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';

export default function Scan() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(true);
  const [barcodeStr, setBarcodeStr] = useState<string>('');
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [unknownBarcode, setUnknownBarcode] = useState<string>('');
  const [lookupFailed, setLookupFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
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
      const status = (error as any)?.status;
      if (status === 404) {
        // Not in database — show a value-first prompt instead of dumping the user into a form
        track('unknown_barcode_detected', { barcode: barcodeStr });
        setUnknownBarcode(barcodeStr);
      } else {
        // Transport/server failure — let the user retry instead of a misleading "not found"
        setLookupFailed(true);
      }
    }
  }, [productData, isError, error, setLocation, barcodeStr]);

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
  }, [scanning, manualMode, retryKey]);

  const handleDetect = (code: string) => {
    setScanning(false);
    setBarcodeStr(code);
    track('scan_started', { barcode: code });
    recordScanMutation.mutate({ data: { eventType: 'scan_started', barcode: code, userSession: sessionId } });
  };

  const retryCamera = () => {
    setHasCamera(null);
    setScanning(true);
    setRetryKey(k => k + 1);
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

  // Lookup failed (network/server) — retry state, not "unknown product"
  if (lookupFailed) {
    return (
      <Layout>
        <div className="flex flex-col min-h-full bg-background text-foreground p-6 pt-16 gap-6">
          <h1 className="text-2xl font-black leading-snug">暫時查詢失敗</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">連線或伺服器發生問題，這不代表商品不存在。請再試一次。</p>
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => { setLookupFailed(false); setBarcodeStr(''); setScanning(true); }}
              className="w-full py-4 bg-foreground text-background font-black tracking-widest"
            >
              重新掃描
            </button>
            <button
              onClick={() => setLocation('/')}
              className="w-full py-3.5 border-2 border-border font-bold tracking-widest text-sm text-muted-foreground hover:text-foreground"
            >
              回首頁
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // Unknown barcode — value-first prompt
  if (unknownBarcode) {
    return (
      <Layout>
        <div className="flex flex-col min-h-full bg-background text-foreground p-6 pt-16 gap-6">
          <h1 className="text-2xl font-black leading-snug">這項商品還沒收錄，但仍然可以立即分析。</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            拍攝成分表，FACTA 會自動辨識商品資訊，約需 30 秒。
          </p>
          <p className="text-[11px] font-mono text-muted-foreground">條碼：{unknownBarcode}</p>
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => setLocation(`/submit?barcode=${unknownBarcode}`)}
              className="w-full py-4 bg-foreground text-background font-black tracking-widest flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Camera className="w-5 h-5" /> 拍攝成分表
            </button>
            <button
              onClick={() => setLocation('/')}
              className="w-full py-3.5 border-2 border-border font-bold tracking-widest text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              稍後再分析
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-4 mt-2">
            協助確認商品資料，可獲得一次免費深度分析。
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-full bg-black text-white relative">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
          <button onClick={() => setLocation('/')} className="p-2" aria-label="關閉掃描">
            <X className="w-6 h-6 text-white" />
          </button>
          <span className="font-mono text-sm font-bold tracking-widest uppercase">{t('scan_product')}</span>
          <button onClick={toggleFlashlight} className="p-2" aria-label="開關手電筒" disabled={!hasCamera || manualMode}>
            <Flashlight className={cn("w-6 h-6", flashlightOn ? "text-primary-strong" : "text-white opacity-70")} />
          </button>
        </div>

        {/* Camera View */}
        {!manualMode ? (
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            {hasCamera === false ? (
              <div className="p-8 flex flex-col gap-4 w-full max-w-sm">
                <div className="flex flex-col items-center text-center gap-3 mb-2">
                  <Camera className="w-10 h-10 opacity-60" aria-hidden="true" />
                  <h2 className="text-xl font-black">暫時無法使用相機</h2>
                  <p className="text-sm text-white/70 leading-relaxed">你仍然可以從相簿選擇照片，或手動輸入條碼。</p>
                </div>
                <label className="relative w-full py-4 bg-primary text-black font-black tracking-widest text-sm flex items-center justify-center gap-2 cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-white">
                  <ImageIcon className="w-5 h-5" aria-hidden="true" /> 從相簿選擇照片
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="從相簿選擇成分表照片"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        try { sessionStorage.setItem('facta_pending_photo', reader.result as string); } catch { /* quota */ }
                        setLocation('/submit?autophoto=1');
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <button
                  onClick={retryCamera}
                  className="w-full py-3.5 border-2 border-white/40 font-bold tracking-widest text-sm flex items-center justify-center gap-2 hover:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" /> 重新允許相機權限
                </button>
                <button
                  onClick={() => setManualMode(true)}
                  className="w-full py-3.5 border-2 border-white/40 font-bold tracking-widest text-sm flex items-center justify-center gap-2 hover:border-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Keyboard className="w-4 h-4" aria-hidden="true" /> 手動輸入條碼
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
                      查詢中⋯
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
              <label htmlFor="manual-barcode" className="text-xs font-bold uppercase tracking-widest text-muted-foreground">條碼號碼</label>
              <input 
                id="manual-barcode"
                type="text" 
                name="barcode"
                inputMode="numeric"
                placeholder="例：4710000000000"
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
              返回相機掃描
            </button>
          </div>
        )}
        
      </div>
    </Layout>
  );
}
