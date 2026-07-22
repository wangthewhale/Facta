import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout';
import { useCreateSubmission, useProcessOcr, useConfirmOcr, useFinalizeSubmission } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Camera, CheckCircle, Clock, ShieldCheck, ArrowLeft, AlertTriangle } from 'lucide-react';
import { track } from '@/lib/analytics';

type Step = 'photo' | 'analyzing' | 'confirm' | 'error';
type SupportedMime = 'image/jpeg' | 'image/png' | 'image/webp';
type NutritionDraft = {
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  calories?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  sodium?: number | null;
  totalCarbs?: number | null;
  dietaryFiber?: number | null;
  totalSugars?: number | null;
  protein?: number | null;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_MIME_TYPES: SupportedMime[] = ['image/jpeg', 'image/png', 'image/webp'];
const WATER_PRODUCT_NAME_PATTERN = /(飲用水|礦泉水|純水|純淨水|天然水|離子水|鹼性水|海洋深層水|深層海水|氣泡水|sparkling\s*water|mineral\s*water|alkaline\s*water)/i;
const WATER_DISQUALIFIER_PATTERN = /(砂糖|蔗糖|果糖|糖漿|葡萄糖|蜂蜜|果汁|香料|甜味|咖啡|茶|乳|奶|酒精|維生素|防腐劑|色素)/i;
const PLAIN_WATER_INGREDIENTS = new Set([
  '水', '飲用水', '純水', '純淨水', '天然水', '礦泉水', '逆滲透水', 'ro水',
  '海水', '深層海水', '海洋深層水', '電解水', '離子水', '鹼性離子水',
  '二氧化碳', '碳酸水', '海洋礦物質', '礦物質', '海水濃縮礦物質液',
  '氯化鈉', '氯化鉀', '氯化鈣', '氯化鎂', '硫酸鎂', '碳酸氫鈉',
]);

function normalizeWaterIngredient(value: string): string {
  return value.toLowerCase().replace(/[（(][^）)]*[）)]/g, '').replace(/[\s·・._-]/g, '').trim();
}

function isPlainWaterDraft(productName: string, ingredientsText: string): boolean {
  const ingredients = ingredientsText.split(/[、,，;；\n]/).map(normalizeWaterIngredient).filter(Boolean);
  if (!WATER_PRODUCT_NAME_PATTERN.test(productName) || ingredients.length === 0) return false;
  if (ingredients.some(name => WATER_DISQUALIFIER_PATTERN.test(name))) return false;
  return ingredients.every(name => PLAIN_WATER_INGREDIENTS.has(name));
}

function normalizeNutritionDraft(value: unknown): NutritionDraft | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const numericKeys: Array<Exclude<keyof NutritionDraft, 'servingSizeUnit'>> = [
    'servingSize', 'calories', 'totalFat', 'saturatedFat', 'transFat', 'sodium',
    'totalCarbs', 'dietaryFiber', 'totalSugars', 'protein',
  ];
  const draft: NutritionDraft = {};
  for (const key of numericKeys) {
    const candidate = typeof raw[key] === 'number' ? raw[key] : typeof raw[key] === 'string' ? Number(raw[key]) : null;
    draft[key] = typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  }
  draft.servingSizeUnit = typeof raw.servingSizeUnit === 'string' ? raw.servingSizeUnit.trim().toLowerCase() : null;
  return draft;
}

export default function Submit() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialBarcode = params.get('barcode') || '';
  const initialName = params.get('name') || '';
  const initialBrand = params.get('brand') || '';
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const [step, setStep] = useState<Step>('photo');
  const [barcode, setBarcode] = useState(initialBarcode);

  // OCR results (user-confirmable)
  const [productName, setProductName] = useState(initialName);
  const [brandName, setBrandName] = useState(initialBrand);
  const [extractedText, setExtractedText] = useState('');
  const [parsedNutrition, setParsedNutrition] = useState<NutritionDraft | null>(null);
  const [nutritionLoading, setNutritionLoading] = useState(false);
  const [consented, setConsented] = useState(false);
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
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('無法讀取照片'));
      reader.readAsDataURL(file);
    });

  const validateImage = (file: File): string | null => {
    if (!SUPPORTED_MIME_TYPES.includes(file.type as SupportedMime)) return '請使用 JPG、PNG 或 WebP 圖片。';
    if (file.size > MAX_IMAGE_BYTES) return '照片不可超過 8MB。';
    return null;
  };

  const getImagePayload = (dataUrl: string): { imageBase64: string; imageMimeType: SupportedMime } => {
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) throw new Error('不支援的圖片格式');
    return { imageMimeType: match[1] as SupportedMime, imageBase64: match[2] };
  };

  /** Photo-first: start reading the label as soon as the back-label photo is chosen. */
  const handleIngredientsPhoto = async (file: File) => {
    const validationError = validateImage(file);
    if (validationError) { setErrorMsg(validationError); return; }
    try {
      const dataUrl = await readFile(file);
      await startAnalysis(dataUrl);
    } catch {
      setErrorMsg('無法讀取這張照片，請改用其他圖片。');
      setStep('error');
    }
  };

  const startAnalysis = async (dataUrl: string) => {
    startedRef.current = true;
    track('photo_selected', { kind: 'ingredients' });
    setStep('analyzing');

    try {
      const payload = getImagePayload(dataUrl);
      const ocrRes = await processOcrMut.mutateAsync({
        data: { ...payload, imageType: 'ingredients' }
      });
      setExtractedText(ocrRes.rawIngredients || ocrRes.extractedText || '');
      setParsedNutrition(normalizeNutritionDraft(ocrRes.parsedNutrition));
      if (ocrRes.productName) setProductName(prev => (ocrRes.productName!.length > prev.length ? ocrRes.productName! : prev));
      if (ocrRes.brandName) setBrandName(prev => prev || ocrRes.brandName!);
      setStep('confirm');
    } catch (err) {
      console.error(err);
      setErrorMsg('AI 辨識暫時無法使用，請稍後再試，或改用手動輸入。');
      setStep('error');
    }
  };

  const handleNutritionPhoto = async (file: File) => {
    const validationError = validateImage(file);
    if (validationError) { setErrorMsg(validationError); return; }
    setNutritionLoading(true);
    setErrorMsg('');
    try {
      const dataUrl = await readFile(file);
      const payload = getImagePayload(dataUrl);
      const ocrRes = await processOcrMut.mutateAsync({ data: { ...payload, imageType: 'nutrition' } });
      const next = normalizeNutritionDraft(ocrRes.parsedNutrition);
      if (!next) throw new Error('no nutrition');
      setParsedNutrition(previous => ({ ...(previous || {}), ...Object.fromEntries(Object.entries(next).filter(([, value]) => value != null)) }));
      if (ocrRes.productName) setProductName(previous => previous || ocrRes.productName!);
      if (ocrRes.brandName) setBrandName(previous => previous || ocrRes.brandName!);
      track('photo_selected', { kind: 'nutrition' });
    } catch {
      setErrorMsg('營養標示沒有辨識成功，可直接在下方手動輸入。');
    } finally {
      setNutritionLoading(false);
    }
  };

  const updateNutritionNumber = (key: Exclude<keyof NutritionDraft, 'servingSizeUnit'>, value: string) => {
    const numericValue = Number(value);
    setParsedNutrition(previous => ({
      ...(previous || {}),
      [key]: value === '' || !Number.isFinite(numericValue) || numericValue < 0 ? null : numericValue,
    }));
  };

  const criticalNutritionCount = ['totalSugars', 'sodium', 'saturatedFat']
    .filter(key => typeof parsedNutrition?.[key as keyof NutritionDraft] === 'number').length;
  const nutritionReady = !!parsedNutrition?.servingSize &&
    ['g', 'ml'].includes(parsedNutrition.servingSizeUnit || '') && criticalNutritionCount >= 2;
  const isPlainWater = isPlainWaterDraft(productName, extractedText);

  /** After the user reviews the auto-recognized data, create + finalize in one go. */
  const handleGenerateReport = async () => {
    if (!extractedText.trim() || !consented) return;
    try {
      setStep('analyzing');
      const sub = await createSubmissionMut.mutateAsync({
        data: {
          productName: productName.trim() || '未命名商品（待確認）',
          brandName: brandName.trim(),
          barcode: barcode.trim(),
          userSession: sessionId,
          userConsented: consented,
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
              <h1 className="text-2xl font-black leading-snug">拍背面，不要只拍正面</h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                最好一張拍到「營養標示＋成分」。如果兩塊分開印，先拍成分，讀完後再補一張營養標示。少一塊，FACTA 就會少算一塊，不會假裝完整。
              </p>
            </div>

            <label className="relative border-2 border-dashed border-foreground bg-card flex flex-col items-center justify-center gap-3 aspect-[4/3] cursor-pointer hover:bg-muted transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-primary">
              <Camera className="w-10 h-10" />
              <span className="font-bold text-sm">拍攝或選擇商品背面照片</span>
              <span className="text-[11px] text-muted-foreground">JPG、PNG、WebP，最多 8MB</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="拍攝或上傳商品背面成分與營養標示照片"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleIngredientsPhoto(e.target.files[0]);
                }}
              />
            </label>

            <ul className="flex flex-col gap-2">
              {[
                { icon: Clock, text: '約 20–30 秒完成' },
                { icon: ShieldCheck, text: '原始照片不寫入 FACTA 商品資料庫' },
                { icon: AlertTriangle, text: '讀錯一個小數點就會差很多，送出前請對照包裝' },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary-strong shrink-0" /> {text}
                </li>
              ))}
            </ul>

            {barcode && (
              <p className="text-[11px] text-muted-foreground font-mono">已帶入條碼：{barcode}</p>
            )}
            {errorMsg && <p className="text-xs font-bold text-destructive bg-destructive/10 border border-destructive p-3">{errorMsg}</p>}
          </div>
        )}

        {/* Step 2: analyzing */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center gap-6">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" role="status" aria-label="分析中"></div>
            <div>
              <h2 className="text-xl font-black mb-2">正在讀包裝背面</h2>
              <p className="text-sm text-muted-foreground">找商品名稱、成分、每份量與關鍵營養數字⋯約 20–30 秒</p>
            </div>
          </div>
        )}

        {/* Step 3: results first, then confirm/edit */}
        {step === 'confirm' && (
          <div className="flex flex-col gap-6 flex-1 mt-2">
            <div>
              <h1 className="text-2xl font-black">
                {isPlainWater ? '這是飲用水，不用硬找營養標示' : '最後對一次，別讓小數點害你判錯'}
              </h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                {isPlainWater
                  ? '請確認商品名稱與成分確實只有水類來源。FACTA 會改用飲用水規則，分析配方、pH 宣稱與近期食安消息，不會因依法免標營養表就判成資料不足。'
                  : '請直接對照手上的包裝。每份量、g／ml、糖、鈉和飽和脂肪會影響換算；資料不夠時，報告不會硬給完整分數。'}
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
              <label htmlFor="ingredients-text" className="text-xs font-bold uppercase tracking-widest">成分表（請對照包裝，可修改）</label>
              <textarea
                id="ingredients-text"
                className="w-full h-40 p-4 border-2 border-border focus:border-foreground bg-card outline-none font-mono text-sm leading-relaxed"
                value={extractedText}
                onChange={e => setExtractedText(e.target.value)}
              />
            </div>

            {isPlainWater ? (
              <section className="flex items-start gap-3 border-2 border-primary-strong bg-primary/10 p-4">
                <CheckCircle className="w-5 h-5 text-primary-strong shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-xs font-black uppercase tracking-widest">已切換為飲用水分析</h2>
                  <p className="text-xs leading-relaxed mt-2">
                    飲用水與礦泉水在未作營養宣稱時，依法可免營養標示。這款將直接分析是否有糖或調味添加、pH 宣稱的意義，以及可查到的品牌與食安紀錄。
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
                    若瓶身另有鈉或礦物質數值，也可以保留；沒有則不會阻擋報告。
                  </p>
                </div>
              </section>
            ) : (
            <section className="flex flex-col gap-3 border-2 border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xs font-black uppercase tracking-widest">營養標示（建議完成）</h2>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">數值請填包裝標示的「每一份」，FACTA 會自動換算每 100g／ml。</p>
                </div>
                {nutritionReady && <CheckCircle className="w-5 h-5 text-primary-strong shrink-0" />}
              </div>

              <label className="relative border border-dashed border-foreground bg-background flex items-center justify-center gap-2 py-3 cursor-pointer hover:bg-muted transition-colors text-xs font-bold">
                <Camera className="w-4 h-4" /> {nutritionLoading ? '辨識營養標示中⋯' : '補拍營養標示，自動帶入'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="拍攝或上傳營養標示照片"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={nutritionLoading}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void handleNutritionPhoto(e.target.files[0]);
                  }}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-[11px] font-bold">
                  每份量
                  <input type="number" min="0" step="any" value={parsedNutrition?.servingSize ?? ''} onChange={e => updateNutritionNumber('servingSize', e.target.value)} className="p-3 border border-border bg-background outline-none focus:border-foreground" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-bold">
                  單位
                  <select value={parsedNutrition?.servingSizeUnit ?? ''} onChange={e => setParsedNutrition(previous => ({ ...(previous || {}), servingSizeUnit: e.target.value || null }))} className="p-3 border border-border bg-background outline-none focus:border-foreground">
                    <option value="">請選擇</option>
                    <option value="g">g（固體）</option>
                    <option value="ml">ml（液體）</option>
                  </select>
                </label>
                {[
                  ['totalSugars', '糖（g）'],
                  ['sodium', '鈉（mg）'],
                  ['saturatedFat', '飽和脂肪（g）'],
                  ['transFat', '反式脂肪（g）'],
                ].map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1 text-[11px] font-bold">
                    {label}
                    <input type="number" min="0" step="any" value={(parsedNutrition?.[key as keyof NutritionDraft] as number | null | undefined) ?? ''} onChange={e => updateNutritionNumber(key as Exclude<keyof NutritionDraft, 'servingSizeUnit'>, e.target.value)} className="p-3 border border-border bg-background outline-none focus:border-foreground" />
                  </label>
                ))}
              </div>

              {!nutritionReady && (
                <div className="flex items-start gap-2 bg-[#F2B84B]/10 border border-[#D9A21B] p-3">
                  <AlertTriangle className="w-4 h-4 text-[#9A6700] shrink-0" />
                  <p className="text-[11px] leading-relaxed">至少需要每份量、g／ml 單位，以及糖／鈉／飽和脂肪中的兩項，否則報告會明確顯示「資料不足」。</p>
                </div>
              )}
            </section>
            )}

            <label className="flex items-start gap-3 border border-border bg-muted/50 p-4 cursor-pointer">
              <input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} className="mt-0.5 w-4 h-4 accent-black" />
              <span className="text-[11px] leading-relaxed">
                我已對照包裝確認，並同意保存上述商品文字與營養數值，供 FACTA 建立待驗證商品。原始照片不寫入 FACTA 商品資料庫。
              </span>
            </label>

            <div className="mt-auto flex flex-col gap-2">
              <button
                onClick={handleGenerateReport}
                disabled={!extractedText.trim() || !consented || finalizeMut.isPending || confirmOcrMut.isPending}
                className="w-full py-4 bg-foreground text-background font-black tracking-widest disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {finalizeMut.isPending || confirmOcrMut.isPending ? '產生報告中⋯' : '確認並產生報告'}
              </button>
              {!extractedText.trim() && (
                <p className="text-[11px] text-muted-foreground text-center">需要成分表文字才能分析，請確認上方成分欄位不是空白。</p>
              )}
              {!consented && <p className="text-[11px] text-muted-foreground text-center">請先確認並同意保存你送出的文字與數值。</p>}
              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                {isPlainWater
                  ? '新商品會先標示為「待驗證」；飲用水會顯示專用分析，不用補不存在的營養數字。'
                  : '新商品會先標示為「待驗證」；資料不足時不會顯示完整評分。'}
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
