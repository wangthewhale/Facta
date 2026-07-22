import React, { useRef, useState } from 'react';
import { useParams } from 'wouter';
import { useGetShareCard } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { ArrowLeft, Check, Copy, Download, Share2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { track } from '@/lib/analytics';

export default function ShareCard() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id || '0');
  const { lang } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const [shareStatus, setShareStatus] = useState('');

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
      track('share_completed', { productId, method: 'image' });
      setShareStatus('圖片已準備下載');
    } catch (err) {
      console.error('Failed to generate image', err);
      setShareStatus('圖片暫時無法儲存，請改用分享連結');
    }
  };

  if (isLoading) {
    return <div className="h-screen bg-black flex items-center justify-center text-white">載入分享卡片中⋯</div>;
  }

  if (!shareData) {
    return <div className="h-screen bg-black flex items-center justify-center text-white">找不到這份報告</div>;
  }

  const name = lang === 'zh' && shareData.productNameZh ? shareData.productNameZh : shareData.productName;
  const brand = shareData.brandName;
  const verdict = lang === 'zh' && shareData.verdictZh ? shareData.verdictZh : shareData.verdict;
  const isWaterAnalysis = shareData.analysisScope === 'water';
  const hasNumericRating = shareData.analysisScope !== 'insufficient' && !isWaterAnalysis;
  const scopeLabel = shareData.analysisScope === 'complete' ? '完整評分' :
    shareData.analysisScope === 'nutrition_only' ? '營養初評' :
    shareData.analysisScope === 'ingredients_only' ? '成分初評' :
    isWaterAnalysis ? '飲用水分析' : '資料不足';
  const reportUrl = `${window.location.origin}/report/${productId}`;
  const scoreText = isWaterAnalysis ? '飲用水分析' : hasNumericRating ? `${shareData.overallScore} 分` : '資料不足';
  const actionLabel = lang === 'zh' ? shareData.actionRecommendation.labelZh : shareData.actionRecommendation.label;
  const actionReason = lang === 'zh' ? shareData.actionRecommendation.reasonZh : shareData.actionRecommendation.reason;
  const shareText = `${name}｜FACTA 建議：${actionLabel}\n${actionReason}\n${scoreText}（${scopeLabel}）`;

  const handleShare = async () => {
    track('share_started', { productId, source: 'share_page' });
    if (navigator.share) {
      try {
        await navigator.share({ title: `FACTA｜${name}`, text: shareText, url: reportUrl });
        track('share_completed', { productId, method: 'native' });
        setShareStatus('已開啟分享選單');
        return;
      } catch {
        // The user may have closed the native share sheet; keep the page usable.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText}\n${reportUrl}`);
      track('share_link_copied', { productId });
      setShareStatus('報告連結已複製');
    } catch {
      setShareStatus('瀏覽器無法自動複製，請直接複製網址列連結');
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(reportUrl);
      track('share_link_copied', { productId });
      setShareStatus('報告連結已複製');
    } catch {
      setShareStatus('瀏覽器無法自動複製，請直接複製網址列連結');
    }
  };

  let scoreColor = '#F4F1E8';
  if (shareData.actionRecommendation.code === 'buy') scoreColor = '#B9F24A';
  if (shareData.actionRecommendation.code === 'limit') scoreColor = '#F2B84B';
  if (shareData.actionRecommendation.code === 'swap') scoreColor = '#E45145';

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col items-center pb-20">
      <div className="w-full max-w-md p-4 flex justify-between items-center bg-neutral-900 sticky top-0 z-10 gap-2">
        <button onClick={() => window.history.back()} className="text-white p-2">
          <span className="sr-only">返回商品報告</span>
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <button onClick={handleCopyLink} className="flex items-center gap-2 px-3 py-2 border border-white/50 text-white font-bold text-xs">
            <Copy className="w-4 h-4" /> 複製
          </button>
          <button onClick={handleShare} className="flex items-center gap-2 px-4 py-2 bg-primary text-black font-black text-xs">
            <Share2 className="w-4 h-4" /> 分享給家人
          </button>
        </div>
      </div>

      {shareStatus && (
        <p role="status" className="w-full max-w-md px-4 pb-3 text-xs text-primary flex items-center gap-2">
          <Check className="w-3.5 h-3.5" /> {shareStatus}
        </p>
      )}

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

            {/* Decision Block */}
            <div className="mb-16">
              <p className="text-2xl font-mono uppercase tracking-[0.25em] opacity-60 mb-5">現在怎麼做</p>
              <div
                className="text-[170px] leading-none font-black tracking-[-0.08em]"
                style={{ color: scoreColor }}
              >
                {actionLabel}
              </div>
              <p className="text-4xl font-semibold max-w-4xl leading-snug mt-8 opacity-90">
                {actionReason}
              </p>
              <div className="flex items-center gap-5 mt-8">
                <div 
                  className="px-6 py-2 text-2xl font-bold tracking-widest uppercase mb-4 inline-block"
                  style={{ backgroundColor: scoreColor, color: '#11120F' }}
                >
                  {scopeLabel}
                </div>
                <p className="text-3xl font-mono font-black mb-4">
                  {scoreText}
                </p>
              </div>
            </div>

            {/* Top Reasons */}
            {shareData.topReasons && shareData.topReasons.length > 0 && (
              <div className="flex-1 border-t-4 border-dashed border-[#F4F1E8]/20 pt-12">
                <h3 className="text-2xl font-mono uppercase tracking-widest opacity-60 mb-8">先看這 3 件事</h3>
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
            <p className="text-3xl font-bold">掃完就知道：買、少吃，還是換一款。</p>
            <p className="text-2xl font-mono font-bold tracking-widest">facta.replit.app</p>
          </div>
          
        </div>
      </div>

      <button onClick={handleDownload} className="mt-4 flex items-center gap-2 px-5 py-3 border border-white/50 text-white font-bold text-xs">
        <Download className="w-4 h-4" /> 另存分享圖片
      </button>
      <p className="max-w-sm px-6 mt-3 text-center text-xs text-white/60 leading-relaxed">
        分享的是可開啟的商品報告；對方可以查看證據，再掃自己手上的包裝確認。
      </p>
    </div>
  );
}
