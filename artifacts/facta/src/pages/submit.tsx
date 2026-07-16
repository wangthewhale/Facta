import React, { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { useCreateSubmission, useProcessOcr, useConfirmOcr, useFinalizeSubmission } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Camera, ChevronRight, Upload, FileText, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function Submit() {
  const { t } = useTranslation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialBarcode = params.get('barcode') || '';
  const initialName = params.get('name') || '';
  const initialBrand = params.get('brand') || '';
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    productName: initialName,
    brandName: initialBrand,
    barcode: initialBarcode,
    frontImageBase64: '',
    ingredientsImageBase64: '',
  });

  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [parsedNutrition, setParsedNutrition] = useState<Record<string, number | null> | null>(null);
  const [detectedProductName, setDetectedProductName] = useState<string | null>(null);
  const [detectedBrandName, setDetectedBrandName] = useState<string | null>(null);

  const createSubmissionMut = useCreateSubmission();
  const processOcrMut = useProcessOcr();
  const confirmOcrMut = useConfirmOcr();
  const finalizeMut = useFinalizeSubmission();

  const handleNextStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.productName) return;
    setStep(2);
  };

  const handleImageCapture = (type: 'front' | 'ingredients', file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setFormData(prev => ({
        ...prev,
        [type === 'front' ? 'frontImageBase64' : 'ingredientsImageBase64']: base64
      }));
    };
    reader.readAsDataURL(file);
  };

  const submitToOcr = async () => {
    setStep(3); // Loading OCR
    
    try {
      // 1. Create submission first
      const sub = await createSubmissionMut.mutateAsync({
        data: {
          productName: formData.productName,
          brandName: formData.brandName,
          barcode: formData.barcode,
          frontImageBase64: formData.frontImageBase64,
          ingredientsImageBase64: formData.ingredientsImageBase64,
          userSession: sessionId,
          userConsented: true
        }
      });
      setSubmissionId(sub.id);

      // 2. Process OCR if ingredients image exists
      if (formData.ingredientsImageBase64) {
        const ocrRes = await processOcrMut.mutateAsync({
          data: {
            imageBase64: formData.ingredientsImageBase64.split(',')[1] || formData.ingredientsImageBase64
          }
        });
        setExtractedText(ocrRes.extractedText);
        setParsedNutrition((ocrRes.parsedNutrition as Record<string, number | null> | null) ?? null);
        // Prefer the detailed label names detected by OCR over hand-typed ones
        if (ocrRes.productName && ocrRes.productName.length > formData.productName.length) {
          setDetectedProductName(ocrRes.productName);
        }
        if (ocrRes.brandName && !formData.brandName) {
          setDetectedBrandName(ocrRes.brandName);
        }
        setStep(4); // Confirm text
      } else {
        // Skip OCR if no image
        setStep(5); // Final confirmation
      }
    } catch (err) {
      console.error(err);
      // Fallback
      setStep(5);
    }
  };

  const handleConfirmText = async () => {
    if (submissionId && extractedText) {
      try {
        await confirmOcrMut.mutateAsync({
          id: submissionId,
          data: {
            confirmedIngredients: extractedText,
            ...(parsedNutrition ? { confirmedNutrition: parsedNutrition } : {}),
            ...(detectedProductName ? { confirmedProductName: detectedProductName } : {}),
            ...(detectedBrandName ? { confirmedBrandName: detectedBrandName } : {}),
          }
        });
        // Instantly create a provisional product + FACTA Report
        const result = await finalizeMut.mutateAsync({ id: submissionId });
        setLocation(`/report/${result.productId}`);
        return;
      } catch (err) {
        console.error(err);
      }
    }
    setStep(5);
  };

  const PhotoBox = ({ label, type }: { label: string, type: 'front' | 'ingredients' }) => {
    const value = type === 'front' ? formData.frontImageBase64 : formData.ingredientsImageBase64;
    return (
      <div className="relative border-2 border-dashed border-border p-4 flex flex-col items-center justify-center aspect-video bg-card">
        {value ? (
          <>
            <img src={value} alt="" className="absolute inset-0 w-full h-full object-cover mix-blend-multiply opacity-50" />
            <div className="relative z-10 bg-background text-foreground px-4 py-2 text-xs font-bold uppercase tracking-widest shadow-md flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary-strong" /> Captured
            </div>
          </>
        ) : (
          <>
            <Camera className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="text-xs uppercase tracking-widest font-mono text-muted-foreground text-center">{label}</span>
          </>
        )}
        <input 
          type="file" 
          accept="image/*" 
          capture="environment"
          className="absolute inset-0 opacity-0 cursor-pointer"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleImageCapture(type, e.target.files[0]);
            }
          }}
        />
      </div>
    );
  };

  return (
    <Layout>
      <div className="p-6 pb-24 min-h-full flex flex-col">
        <div className="flex items-center gap-2 mb-8 mt-4 text-sm font-mono text-muted-foreground uppercase tracking-widest">
          <span className={cn(step >= 1 && "text-foreground font-bold")}>1. Info</span>
          <ChevronRight className="w-3 h-3" />
          <span className={cn(step >= 2 && "text-foreground font-bold")}>2. Photo</span>
          <ChevronRight className="w-3 h-3" />
          <span className={cn(step >= 4 && "text-foreground font-bold")}>3. Verify</span>
        </div>

        {step === 1 && (
          <form onSubmit={handleNextStep1} className="flex flex-col gap-6 flex-1">
            <h1 className="text-2xl font-bold">{t('submit_product')}</h1>
            <p className="text-sm text-muted-foreground -mt-4">Help us map the shelves. Add a missing product to the FACTA database.</p>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-widest">{t('barcode')}</label>
              <input 
                type="text" 
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-mono"
                value={formData.barcode}
                onChange={e => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                placeholder="0000000000"
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-widest">{t('product_name')} *</label>
              <input 
                type="text" 
                required
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-medium"
                value={formData.productName}
                onChange={e => setFormData(prev => ({ ...prev, productName: e.target.value }))}
                placeholder="Product Name"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-widest">{t('brand')}</label>
              <input 
                type="text" 
                className="p-4 border-2 border-border focus:border-foreground bg-background outline-none font-medium"
                value={formData.brandName}
                onChange={e => setFormData(prev => ({ ...prev, brandName: e.target.value }))}
                placeholder="Brand Name"
              />
            </div>

            <div className="mt-auto">
              <button 
                type="submit" 
                disabled={!formData.productName}
                className="w-full py-4 bg-foreground text-background font-bold tracking-widest uppercase disabled:opacity-50"
              >
                Next Step
              </button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6 flex-1">
            <h1 className="text-2xl font-bold">{t('photo_capture')}</h1>
            <p className="text-sm text-muted-foreground -mt-4">Clear photos ensure accurate AI analysis.</p>

            <div className="grid grid-cols-2 gap-4">
              <PhotoBox label="Front of package" type="front" />
              <PhotoBox label="Ingredients list" type="ingredients" />
            </div>

            <div className="mt-auto flex gap-4">
              <button onClick={() => setStep(1)} className="py-4 px-6 border-2 border-border font-bold uppercase tracking-widest">
                Back
              </button>
              <button 
                onClick={submitToOcr}
                className="flex-1 py-4 bg-foreground text-background font-bold tracking-widest uppercase flex items-center justify-center gap-2 disabled:opacity-50"
              >
                Analyze <Upload className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center gap-6">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <div>
              <h2 className="text-xl font-bold font-mono tracking-widest uppercase mb-2">{t('ocr_processing')}</h2>
              <p className="text-sm text-muted-foreground">Extracting ingredients & nutrition data...</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-6 flex-1">
            <h1 className="text-2xl font-bold">{t('confirm_text')}</h1>
            <p className="text-sm text-muted-foreground -mt-4">Review the AI-extracted ingredients list. Edit if needed.</p>

            <textarea 
              className="w-full h-64 p-4 border-2 border-border focus:border-foreground bg-card outline-none font-mono text-sm leading-relaxed"
              value={extractedText}
              onChange={e => setExtractedText(e.target.value)}
            />

            <div className="mt-auto">
              <button 
                onClick={handleConfirmText}
                className="w-full py-4 bg-foreground text-background font-bold tracking-widest uppercase flex items-center justify-center gap-2"
                disabled={confirmOcrMut.isPending}
              >
                {confirmOcrMut.isPending ? 'Saving...' : t('submit_confirm')}
              </button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center gap-6">
            <div className="w-20 h-20 bg-primary/20 flex items-center justify-center text-primary-strong mb-4">
              <CheckCircle className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tighter">Submitted</h1>
            <p className="text-muted-foreground px-6">
              Your submission is in the queue. Our engine will generate a provisional report shortly.
            </p>
            <div className="mt-8">
              <button 
                onClick={() => setLocation('/')}
                className="py-4 px-8 border-2 border-foreground font-bold tracking-widest uppercase"
              >
                Back to Home
              </button>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
