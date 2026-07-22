import React from 'react';
import { useLocation, useParams } from 'wouter';
import { Layout } from '@/components/layout';
import { useGetAlternatives, useGetProduct } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { ArrowLeft, ArrowRight, ScanLine, Search, ShieldCheck, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { track } from '@/lib/analytics';

export default function Alternatives() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id || '0');
  const { t, lang } = useTranslation();
  const [, setLocation] = useLocation();

  const { data: originalProduct, isLoading: originalLoading } = useGetProduct(productId, {
    query: { enabled: !!productId } as any
  });

  const { data: alternatives, isLoading: altLoading } = useGetAlternatives(productId, {
    query: { enabled: !!productId } as any
  });

  return (
    <Layout>
      <div className="flex flex-col">
        {/* Header */}
        <div className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <button onClick={() => window.history.back()} className="mb-4 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-bold">{t('better_alternatives')}</h1>
          {originalLoading ? (
            <Skeleton className="h-4 w-48 mt-2" />
          ) : originalProduct ? (
            <p className="text-sm text-muted-foreground mt-1">
              {lang === 'zh' ? '這款：' : 'For: '}
              <span className="font-semibold text-foreground">{lang === 'zh' && originalProduct.nameZh ? originalProduct.nameZh : originalProduct.name}</span>
            </p>
          ) : null}
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4">
          {altLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="border border-border p-4 space-y-4 animate-pulse">
                <div className="flex gap-4">
                  <Skeleton className="w-16 h-16" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              </div>
            ))
          ) : alternatives && alternatives.length > 0 ? (
            alternatives.map((alt, i) => (
              <div key={i} className="border border-border bg-background p-4 flex flex-col gap-4 relative group cursor-pointer hover:border-primary transition-colors" onClick={() => setLocation(`/report/${alt.product.id}`)}>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-primary/20 text-primary-strong flex items-center justify-center text-xl font-mono font-bold">
                      {alt.product.overallScore}
                    </div>
                    <div>
                      <p className="text-xs font-mono tracking-widest uppercase text-muted-foreground">{alt.product.brandName || 'Brand'}</p>
                      <h3 className="font-bold text-lg leading-tight mt-0.5 pr-8">
                        {lang === 'zh' && alt.product.nameZh ? alt.product.nameZh : alt.product.name}
                      </h3>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary-strong transition-colors absolute top-6 right-4" />
                </div>

                <div className="bg-card border border-border p-3 text-sm font-medium">
                  {lang === 'zh' && alt.whyBetterZh ? alt.whyBetterZh : alt.whyBetter}
                </div>

                <div className="flex gap-2">
                  {alt.scoreImprovement && alt.scoreImprovement > 0 && (
                    <span className="px-2 py-1 bg-primary/10 text-primary-strong text-[10px] uppercase tracking-widest font-bold flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 rotate-180" /> +{alt.scoreImprovement} Score
                    </span>
                  )}
                  {alt.priceDifferenceNtd && alt.priceDifferenceNtd < 0 && (
                    <span className="px-2 py-1 bg-card border border-border text-foreground text-[10px] uppercase tracking-widest font-bold">
                      {t('price_diff')}: {alt.priceDifferenceNtd} NTD
                    </span>
                  )}
                  {alt.sameRetailer && (
                    <span className="px-2 py-1 bg-card border border-border text-muted-foreground text-[10px] uppercase tracking-widest font-bold">
                      Same store
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="p-6 border border-dashed border-border mt-4 flex flex-col gap-5">
              <div className="w-10 h-10 bg-primary/10 text-primary-strong flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-black">還沒有足夠的同類驗證商品</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                  這不代表沒有更好的選擇，只代表目前找不到「同類、可買到、標示已核對」的商品。FACTA 不會拿不同種類硬湊推薦。
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    track('alternative_empty_cta_clicked', { productId, action: 'scan' });
                    setLocation('/scan');
                  }}
                  className="py-4 bg-primary text-black font-black text-sm flex items-center justify-center gap-2"
                >
                  <ScanLine className="w-4 h-4" /> 掃另一款同類食品
                </button>
                <button
                  type="button"
                  onClick={() => {
                    track('alternative_empty_cta_clicked', { productId, action: 'search' });
                    setLocation('/search');
                  }}
                  className="py-4 border-2 border-foreground font-black text-sm flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" /> 用商品名稱找
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                找到候選品後，先確認包裝名稱與營養標示；兩份報告都可收藏到「紀錄」頁一起比較。
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
