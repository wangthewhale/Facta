import React, { useEffect, useRef } from 'react';
import { useParams } from 'wouter';
import { useGetShareCard } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { ArrowLeft, Download } from 'lucide-react';
import html2canvas from 'html2canvas';

export default function ShareCard() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id || '0');
  const { t, lang } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);

  const { data: shareData, isLoading } = useGetShareCard(productId, {
    query: { enabled: !!productId } as any
  });

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2, // High res
        useCORS: true,
        backgroundColor: '#11120F' // Near-black background for share card
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const link = document.createElement('a');
      link.download = `facta-report-${productId}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to generate image', err);
    }
  };

  if (isLoading) {
    return <div className="h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
  }

  if (!shareData) {
    return <div className="h-screen bg-black flex items-center justify-center text-white">Not found</div>;
  }

  const name = lang === 'zh' && shareData.productNameZh ? shareData.productNameZh : shareData.productName;
  const brand = shareData.brandName;
  const verdict = lang === 'zh' && shareData.verdictZh ? shareData.verdictZh : shareData.verdict;

  let scoreColor = '#F4F1E8';
  if (shareData.scoreGrade === 'Excellent' || shareData.scoreGrade === 'Good') scoreColor = '#B9F24A';
  if (shareData.scoreGrade === 'Consider') scoreColor = '#F2B84B';
  if (shareData.scoreGrade === 'Poor') scoreColor = '#E45145';

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center pb-20">
      <div className="w-full max-w-md p-4 flex justify-between items-center bg-neutral-900 sticky top-0 z-10">
        <button onClick={() => window.history.back()} className="text-white p-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <button onClick={handleDownload} className="flex items-center gap-2 px-4 py-2 bg-white text-black font-bold uppercase tracking-widest text-xs">
          <Download className="w-4 h-4" /> Save
        </button>
      </div>

      {/* 1080x1350 aspect ratio container (4:5 vertical) */}
      <div className="w-full max-w-md aspect-[4/5] p-4">
        <div 
          ref={cardRef} 
          className="w-full h-full bg-[#11120F] text-[#F4F1E8] flex flex-col relative overflow-hidden font-sans border-2 border-[#F4F1E8]"
          style={{ width: '1080px', height: '1350px', transform: 'scale(0.33)', transformOrigin: 'top left' }} // scale for preview only
        >
          {/* Card Content - rendered at full 1080x1350 resolution */}
          
          {/* Header */}
          <div className="p-12 flex justify-between items-start border-b border-[#F4F1E8]/20">
            <h1 className="text-5xl font-black tracking-tighter">FACTA</h1>
            <p className="text-2xl font-mono opacity-60 uppercase">{new Date().toISOString().split('T')[0]}</p>
          </div>

          <div className="flex-1 flex flex-col p-12">
            
            {/* Product Info */}
            <div className="mb-16">
              <p className="text-3xl font-mono uppercase tracking-widest opacity-80 mb-4">{brand || 'UNKNOWN BRAND'}</p>
              <h2 className="text-7xl font-bold leading-tight">{name}</h2>
            </div>

            {/* Score Block */}
            <div className="flex items-end gap-12 mb-16">
              <div 
                className="text-[250px] leading-none font-black font-mono tracking-tighter"
                style={{ color: scoreColor }}
              >
                {shareData.overallScore}
              </div>
              <div className="pb-12">
                <div 
                  className="px-6 py-2 text-2xl font-bold tracking-widest uppercase mb-4 inline-block"
                  style={{ backgroundColor: scoreColor, color: '#11120F' }}
                >
                  {shareData.scoreGrade}
                </div>
                <p className="text-4xl font-semibold max-w-lg leading-snug opacity-90">
                  {verdict}
                </p>
              </div>
            </div>

            {/* Top Reasons */}
            {shareData.topReasons && shareData.topReasons.length > 0 && (
              <div className="flex-1 border-t-4 border-dashed border-[#F4F1E8]/20 pt-12">
                <h3 className="text-2xl font-mono uppercase tracking-widest opacity-60 mb-8">Key Evidence</h3>
                <div className="flex flex-col gap-6">
                  {shareData.topReasons.slice(0, 3).map((reason, i) => (
                    <div key={i} className="text-4xl font-medium flex items-center gap-6">
                      <span className="w-4 h-4 bg-[#F4F1E8] rotate-45" />
                      {lang === 'zh' && reason.labelZh ? reason.labelZh : reason.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
          </div>

          {/* Footer */}
          <div className="p-12 bg-[#F4F1E8] text-[#11120F] flex justify-between items-center mt-auto">
            <p className="text-3xl font-bold">{t('tagline_en')}</p>
            <p className="text-2xl font-mono font-bold tracking-widest">facta.app</p>
          </div>
          
        </div>
      </div>
    </div>
  );
}