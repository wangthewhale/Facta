import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout';
import { useCreateSubmission, useProcessOcr, useConfirmOcr, useFinalizeSubmission } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Camera, CheckCircle, Clock, ShieldCheck, ArrowLeft, Trash2 } from 'lucide-react';
import { track } from '@/lib/analytics';

type Step = 'photo' | 'analyzing' | 'confirm' | 'error';

export default function Submit() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialBarcode = params.get('barcode') || '';
  const initialName = params.get('name') || '';
  const initialBrand = params.get('brand') || '';
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const [step, setStep] = useState<Step>('photo');
  const [ingredientsImage, setIngredientsImage] = useState('');
  const [frontImage, setFrontImage] = useState('');
  const [barcode, setBarcode] = useState(initialBarcode);

  // OCR results (user-confirmable)
  const [productName, setProductName] = useState(initialName);
  const [brandName, setBrandName] = useState(initialBrand);
  const [extractedText, setExtractedText] = useState('');
  const [parsedNutrition, setParsedNutrition] = useState<Record<string, number | null> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const processOcrMut = useProcessOcr();
  const createSubmissionMut = useCreateSubmission();
  const confirmOcrMut = useConfirmOcr();
  const finalizeMut = useFinalizeSubmission();

  // Track abandonment: photo selected but analysis never completed
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  useEffect(() => () => {
    if (startedRef.current && !completedRef.current) {
      track('analysis_abandoned');
    }
  }, []);

  // Photo handed off from the scan page (camera-unavailable fallback)
  const autoPhotoHandled = useRef(false);
  useEffect(() => {
    if (autoPhotoHandled.current) return;
    if (params.get('autophoto') === '1') {
      try {
        const pending = sessionStorage.getItem('facta_pending_photo');
        if (pending) {
          autoPhotoHandled.current = true;
          sessionStorage.removeItem('facta_pending_photo');
          startAnalysis(pending);
        }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  /** Photo-first: as soon as the ingredients photo is chosen, start AI recognition. */
  const handleIngredientsPhoto = async (file: File) => {
    const base64 = await readFile(file);
    startAnalysis(base64);
  };

  const startAnalysis = async (base64: string) => {
    setIngredientsImage(base64);
    startedRef.current = true;
    track('photo_selected', { kind: 'ingredients' });
    setStep('analyzing');

    try {
      const ocrRes = await processOcrMut.mutateAsync({
        data: { imageBase64: base64.split(',')[1] || base64 }
      });
      setExtractedText(ocrRes.extractedText || '');
      setParsedNutrition((ocrRes.parsedNutrition as Record<string, number | null> | null) ?? null);
      if (ocrRes.productName) setProductName(prev => (ocrRes.productName!.length > prev.length ? ocrRes.productName! : prev));
      if (ocrRes.brandName) setBrandName(prev => prev || ocrRes.brandName!);
      setStep('confirm');
    } catch (err) {
      console.error(err);
      setErrorMsg('AI 辨識暫時無法使用，請稍後再試，或改用手動輸入。');
      setStep('error');
    }
  };

  const handleFrontPhoto = async (file: File) => {
    const base64 = await readFile(file);
    setFrontImage(base64);
    track('photo_selected', { kind: 'front' });
  };

  /** After the user reviews the auto-recognized data, create + finalize in one go. */
  const handleGenerateReport = async () => {
    if (!extractedText.trim()) return;
    try {
      setStep('analyzing');
      const sub = await createSubmissionMut.mutateAsync({
        data: {
          productName: productName.trim() || '未命名商品（待確認）',
          brandName: brandName.trim(),
          barcode: barcode.trim(),
          frontImageBase64: frontImage,
          ingredientsImageBase64: ingredientsImage,
          userSession: sessionId,
          userConsented: true,
        }
      });
      await confirmOcrMut.mutateAsync({
        id: sub.id,
        data: {
          confirmedIngredients: extractedText,
          ...(parsedNutrition ? { confirmedNutrition: parsedNutrition } : {}),
          ...(productName.trim() ? { confirmedProductName: productName.trim() } : {}),
          ...(brandName.trim() ? { confirmedBrandName: brandName.trim() } : {}),
        }
      });
      const result = await finalizeMut.mutateAsync({ id: sub.id });
      completedRef.current = true;
      track('analysis_completed', { productId: result.productId });
      setLocation(`/report/${result.productId}`);
    } catch (err) {
      console.error(err);
      setErrorMsg('產生報告時發生錯誤，請再試一次。你的辨識結果已保留。');
      setStep('confirm');
    }
  };

  return (
    <Layout>
      <div className="p-6 pb-24 min-h-full flex flex-col">
        <button onClick={() => window.history.back()} aria-label="返回上一頁"
          className="self-start p-2 -ml-2 mt-2 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Step 1: ingredients photo only */}
        {step === 'photo' && (
          <div className="flex flex-col gap-6 flex-1 mt-2">
            <div>
              <h1 className="text-2xl font-black leading-snug">拍攝成分表</h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                只需要一張商品背面的成分表照片，FACTA 會自動辨識商品名稱、品牌與成分。
              </p>
            </div>

            <label className="relative border-2 border-dashed border-foreground bg-card flex flex-col items-center justify-center gap-3 aspect-[4/3] cursor-pointer hover:bg-muted transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-primary">
              <Camera className="w-10 h-10" />
              <span className="font-bold text-sm">拍攝或從相簿選擇成分表照片</span>
              <span className="text-[11px] text-muted-foreground">支援相機拍攝與相簿上傳</span>
              <input
                type="file"
                accept="image/*"
                aria-label="拍攝或上傳成分表照片"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleIngredientsPhoto(e.target.files[0]);
                }}
              />
            </label>

            <ul className="flex flex-col gap-2">
              {[
                { icon: Clock, text: '約 20–30 秒完成' },
                { icon: ShieldCheck, text: '照片只用於辨識商品資訊' },
                { icon: Trash2, text: '分析完成後可刪除照片' },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary-strong shrink-0" /> {text}
                </li>
              ))}
            </ul>

            {barcode && (
              <p className="text-[11px] text-muted-foreground font-mono">已帶入條碼：{barcode}</p>
            )}
          </div>
        )}

        {/* Step 2: analyzing */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center gap-6">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" role="status" aria-label="分析中"></div>
            <div>
              <h2 className="text-xl font-black mb-2">AI 辨識中</h2>
              <p className="text-sm text-muted-foreground">正在辨識商品名稱、成分與營養標示⋯約 20–30 秒</p>
            </div>
          </div>
        )}

        {/* Step 3: results first, then confirm/edit */}
        {step === 'confirm' && (
          <div className="flex flex-col gap-6 flex-1 mt-2">
            <div>
              <h1 className="text-2xl font-black">確認辨識結果</h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                AI 已自動辨識以下資料，確認或修改後立即產生 FACTA 報告。
              </p>
            </div>

            {errorMsg && (
              <p className="text-xs font-bold text-destructive bg-destructive/10 border border-destructive p-3">{errorMsg}</p>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="product-name" className="text-xs font-bold uppercase tracking-widest">商品名稱</label>
              <input
                id="product-name"
                type="text"
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-medium"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="AI 未能辨識，可留空或手動輸入"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="brand-name" className="text-xs font-bold uppercase tracking-widest">品牌（選填）</label>
              <input
                id="brand-name"
                type="text"
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-medium"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="barcode-input" className="text-xs font-bold uppercase tracking-widest">條碼（選填）</label>
              <input
                id="barcode-input"
                type="text"
                inputMode="numeric"
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-mono"
                value={barcode}
                onChange={e => setBarcode(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="ingredients-text" className="text-xs font-bold uppercase tracking-widest">成分表（AI 辨識結果，可修改）</label>
              <textarea
                id="ingredients-text"
                className="w-full h-40 p-4 border-2 border-border focus:border-foreground bg-card outline-none font-mono text-sm leading-relaxed"
                value={extractedText}
                onChange={e => setExtractedText(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-widest">商品正面照片（選填）</span>
              <label className="relative border-2 border-dashed border-border bg-card flex items-center justify-center gap-2 py-4 cursor-pointer hover:bg-muted transition-colors text-xs font-bold text-muted-foreground">
                {frontImage ? (
                  <><CheckCircle className="w-4 h-4 text-primary-strong" /> 已加入商品正面照片</>
                ) : (
                  <><Camera className="w-4 h-4" /> 加入商品正面照片（幫助其他人辨識）</>
                )}
                <input
                  type="file"
                  accept="image/*"
                  aria-label="上傳商品正面照片"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFrontPhoto(e.target.files[0]);
                  }}
                />
              </label>
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <button
                onClick={handleGenerateReport}
                disabled={!extractedText.trim() || finalizeMut.isPending || confirmOcrMut.isPending}
                className="w-full py-4 bg-foreground text-background font-black tracking-widest disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {finalizeMut.isPending || confirmOcrMut.isPending ? '產生報告中⋯' : '確認並產生報告'}
              </button>
              {!extractedText.trim() && (
                <p className="text-[11px] text-muted-foreground text-center">需要成分表文字才能分析，請確認上方成分欄位不是空白。</p>
              )}
              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                確認後這項商品會加入待驗證資料庫，其他人掃描時也能立即看到報告。
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {step === 'error' && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center gap-6">
            <h2 className="text-xl font-black">辨識失敗</h2>
            <p className="text-sm text-muted-foreground px-6 leading-relaxed">{errorMsg}</p>
            <div className="flex flex-col gap-3 w-full px-6">
              <button
                onClick={() => { setStep('photo'); setErrorMsg(''); }}
                className="w-full py-4 bg-foreground text-background font-bold tracking-widest"
              >
                重新拍攝成分表
              </button>
              <button
                onClick={() => { setStep('confirm'); setErrorMsg(''); }}
                className="w-full py-3.5 border-2 border-border font-bold tracking-widest text-sm"
              >
                改用手動輸入
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
