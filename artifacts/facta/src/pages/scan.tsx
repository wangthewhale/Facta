import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useTranslation } from '@/lib/i18n';
import { Layout } from '@/components/layout';
import { Camera, Flashlight, ArrowRight, X, Image as ImageIcon, Keyboard, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useRecordScan, useGetProductByBarcode } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';

type RetailerIdentity = {
  retailerName?: string | null;
  retailerSlug?: string | null;
  retailerConfidence?: 'confirmed' | 'strong' | 'possible' | 'unknown';
  retailerEvidence?: 'retailer_record' | 'official_catalog' | 'package_or_brand' | 'restricted_barcode_only' | 'unknown';
  retailerReasonZh?: string;
};

type ExternalBarcodeCandidate = RetailerIdentity & {
  productName: string;
  productNameZh?: string | null;
  brandName?: string | null;
  sourceName: string;
  sourceUrl: string;
  identityEvidenceUrls?: string[];
  evidenceTier: string;
};

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
  const [unverifiedProductName, setUnverifiedProductName] = useState<string>('');
  const [externalCandidate, setExternalCandidate] = useState<ExternalBarcodeCandidate | null>(null);
  const [retailerIdentity, setRetailerIdentity] = useState<RetailerIdentity | null>(null);
  const [invalidBarcode, setInvalidBarcode] = useState<string>('');
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
      if (productData.verificationStatus === 'verified') {
        setLocation(`/report/${productData.id}`);
      } else {
        track('unverified_barcode_detected', { barcode: barcodeStr, productId: productData.id });
        setUnverifiedProductName(productData.nameZh || productData.name);
        setRetailerIdentity({
          retailerName: productData.retailerName,
          retailerSlug: productData.retailerSlug,
          retailerConfidence: productData.retailerConfidence,
          retailerEvidence: productData.retailerEvidence,
          retailerReasonZh: productData.retailerReasonZh,
        });
        setUnknownBarcode(barcodeStr);
      }
    } else if (isError) {
      const status = (error as any)?.status;
      if (status === 404) {
        const candidate = (error as any)?.data?.catalogCandidate as ExternalBarcodeCandidate | null | undefined;
        const identity = (error as any)?.data?.retailerIdentity as RetailerIdentity | null | undefined;
        setExternalCandidate(candidate ?? null);
        setRetailerIdentity(candidate ?? identity ?? null);
        if (candidate) setUnverifiedProductName(candidate.productNameZh || candidate.productName);
        // Not in the verified database — show public identity context, then
        // collect the physical label instead of inventing a health conclusion.
        track('unknown_barcode_detected', { barcode: barcodeStr });
        setUnknownBarcode(barcodeStr);
      } else if (status === 422) {
        setInvalidBarcode(barcodeStr);
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
    const normalizedCode = code.replace(/\D/g, '');
    setScanning(false);
    setLookupFailed(false);
    setUnknownBarcode('');
    setUnverifiedProductName('');
    setExternalCandidate(null);
    setRetailerIdentity(null);
    if (!isValidRetailBarcode(normalizedCode)) {
      setInvalidBarcode(normalizedCode || code);
      setBarcodeStr('');
      track('invalid_barcode_detected', { barcode: normalizedCode || code });
      return;
    }
    setInvalidBarcode('');
    setBarcodeStr(normalizedCode);
    track('scan_started', { barcode: normalizedCode });
    recordScanMutation.mutate({ data: { eventType: 'scan_started', barcode: normalizedCode, userSession: sessionId } });
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

  if (invalidBarcode) {
    return (
      <Layout>
        <div className="flex flex-col min-h-full bg-background text-foreground p-6 pt-16 gap-6">
          <AlertTriangle className="w-10 h-10 text-[#9A6700]" />
          <h1 className="text-2xl font-black leading-snug">這組條碼可能少一碼，或鏡頭掃錯了。</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            商品條碼最後一碼會用來檢查前面的數字。這組號碼沒有通過校驗，所以 FACTA 不會拿它去配對商品。
          </p>
          <p className="text-[11px] font-mono text-muted-foreground break-all">讀到：{invalidBarcode}</p>
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => { setInvalidBarcode(''); setManualMode(false); setHasCamera(null); setScanning(true); setRetryKey(k => k + 1); }}
              className="w-full py-4 bg-foreground text-background font-black tracking-widest"
            >
              對準包裝，再掃一次
            </button>
            <button
              onClick={() => { setInvalidBarcode(''); setManualMode(true); setScanning(false); }}
              className="w-full py-3.5 border-2 border-border font-bold tracking-widest text-sm"
            >
              改成手動輸入
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // Unknown barcode — value-first prompt
  if (unknownBarcode) {
    const submitParams = new URLSearchParams({
      barcode: unknownBarcode,
      ...(externalCandidate ? { name: externalCandidate.productNameZh || externalCandidate.productName } : {}),
      ...(externalCandidate?.brandName ? { brand: externalCandidate.brandName } : {}),
      ...(retailerIdentity?.retailerSlug ? { retailer: retailerIdentity.retailerSlug } : {}),
    }).toString();
    return (
      <Layout>
        <div className="flex flex-col min-h-full bg-background text-foreground p-6 pt-16 gap-6">
          <h1 className="text-2xl font-black leading-snug">
            {unverifiedProductName
              ? `找到「${unverifiedProductName}」，但還不能直接叫你買。`
              : '條碼只認出商品；要判斷值不值得買，還需要背面標示。'}
          </h1>
          {externalCandidate && (
            <div className="border-2 border-[#D9A21B] bg-[#F2B84B]/10 p-4 flex flex-col gap-2">
              <p className="text-xs font-black tracking-wide">公開條碼資料已找到商品身分</p>
              <p className="text-sm font-bold">
                {[externalCandidate.brandName, externalCandidate.productNameZh || externalCandidate.productName].filter(Boolean).join(' · ')}
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {externalCandidate.sourceName === 'Open Food Facts'
                  ? '來源是社群公開資料，商品名稱與圖片尚未經 FACTA 核對；請以你手上的包裝為準。'
                  : 'FACTA 以完整條碼找到公開商品頁；這仍是待驗證身分，請用你手上的包裝確認商品名稱、品牌與通路。'}
              </p>
              <a href={externalCandidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-black underline self-start">
                查看 {externalCandidate.sourceName} 原始紀錄
              </a>
            </div>
          )}
          {retailerIdentity && (
            <div className="border-2 border-border bg-card p-4 flex flex-col gap-2">
              <p className="text-xs font-black tracking-wide">便利商店辨識</p>
              {retailerIdentity.retailerName ? (
                <>
                  <p className="text-lg font-black">{retailerIdentity.retailerName}</p>
                  <p className="text-[11px] font-bold text-primary-strong">
                    {retailerIdentity.retailerConfidence === 'confirmed' ? '已由通路紀錄確認' : '包裝／品牌高度吻合，下一步請再確認'}
                  </p>
                </>
              ) : (
                <p className="text-sm font-black">目前不能只靠這組條碼判定店家</p>
              )}
              {retailerIdentity.retailerReasonZh && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">{retailerIdentity.retailerReasonZh}</p>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground leading-relaxed">
            最好一張拍到「營養標示＋成分」；若分開印，下一步可以再補第二張。FACTA 會換算每 100g／ml，先告訴你糖、鈉、飽和脂肪最該注意哪一項。
          </p>
          <p className="text-[11px] font-mono text-muted-foreground">條碼：{unknownBarcode}</p>
          <ul className="flex flex-col gap-2 border-y border-border py-4">
            {[
              '辨識錯的數字會先讓你確認，不直接下結論',
              '資料不足就明說，不把未知當成安全',
              '營養分數和品牌新聞分開呈現',
            ].map(item => (
              <li key={item} className="flex items-start gap-2 text-xs font-bold leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-primary-strong shrink-0 mt-0.5" /> {item}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={() => setLocation(`/submit?${submitParams}`)}
              className="w-full py-4 bg-foreground text-background font-black tracking-widest flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Camera className="w-5 h-5" /> 拍商品背面，繼續分析
            </button>
            <button
              onClick={() => setLocation('/')}
              className="w-full py-3.5 border-2 border-border font-bold tracking-widest text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              稍後再分析
            </button>
          </div>
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
          <span className="font-mono text-sm font-bold tracking-widest uppercase">先掃條碼</span>
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
                  <h2 className="text-xl font-black">相機打不開，也不會卡住</h2>
                  <p className="text-sm text-white/70 leading-relaxed">先手動輸入條碼；沒有條碼時，再選商品背面「成分＋營養」照片。</p>
                </div>
                <label className="relative w-full py-4 bg-primary text-black font-black tracking-widest text-sm flex items-center justify-center gap-2 cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-white">
                  <ImageIcon className="w-5 h-5" aria-hidden="true" /> 選擇商品背面照片
                  <input
                    type="file"
                    accept="image/*"
                    aria-label="從相簿選擇商品背面成分與營養標示照片"
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
                      查商品與便利商店中⋯
                    </div>
                  )}

                  <div className="absolute -bottom-24 inset-x-0 text-center px-2">
                    <p className="font-black text-sm">把條碼完整放進框內</p>
                    <p className="text-[11px] text-white/70 leading-relaxed mt-1">條碼先確認是哪一款；資料不夠，再拍背面標示。</p>
                  </div>
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
                {isFetching ? '查商品與便利商店中⋯' : '查這個條碼'} <ArrowRight className="w-5 h-5" />
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

function isValidRetailBarcode(value: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;

  const validates = (digits: string): boolean => {
    const payload = digits.slice(0, -1).split('').map(Number).reverse();
    const sum = payload.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
  };
  if (validates(value)) return true;

  if (value.length !== 8 || !/^[01]/.test(value)) return false;
  const [numberSystem, d1, d2, d3, d4, d5, d6, check] = value;
  const payload = d6 === '0' || d6 === '1' || d6 === '2'
    ? `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`
    : d6 === '3'
      ? `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`
      : d6 === '4'
        ? `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`
        : `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return validates(`${payload}${check}`);
}
