import React, { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout';
import { useDiscoverCatalog, useSearchProducts } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { Search as SearchIcon, ArrowLeft, SlidersHorizontal, BookOpen, AlertCircle, ShieldCheck, Sparkles, ExternalLink, Camera, LoaderCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getSessionId } from '@/lib/session';
import { track } from '@/lib/analytics';

const fitColors: Record<string, string> = {
  great_fit: '#B9F24A',
  good_fit: '#B9F24A', // 70% opacity usually via tailwind or inline style
  mixed_fit: '#F2B84B',
  poor_fit: '#E45145',
  insufficient_data: '#9CA3AF',
};

export default function Search() {
  const [, setLocation] = useLocation();
  const queryString = useSearch();
  const { t, lang } = useTranslation();
  const sessionId = getSessionId();

  const searchParams = new URLSearchParams(queryString);
  const initialQ = searchParams.get('q') || '';
  
  const [q, setQ] = useState(initialQ);
  const [activeGoal, setActiveGoal] = useState(searchParams.get('goal_slug') || '');
  const [activeMeal, setActiveMeal] = useState(searchParams.get('meal_type') || '');
  const [activeRetailer, setActiveRetailer] = useState(searchParams.get('retailer_slug') || '');

  // Perform search
  const { data, isLoading } = useSearchProducts({
    q: initialQ,
    goal_slug: activeGoal || undefined,
    meal_type: activeMeal || undefined,
    retailer_slug: activeRetailer || undefined,
    session_id: sessionId
  }, {
    query: {
      enabled: true
    } as any
  });

  const liveDiscovery = useDiscoverCatalog({ q: initialQ }, {
    query: {
      enabled: initialQ.trim().length > 0,
      staleTime: 6 * 60 * 60 * 1000,
      retry: false,
    } as any,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (activeGoal) params.set('goal_slug', activeGoal);
    if (activeMeal) params.set('meal_type', activeMeal);
    if (activeRetailer) params.set('retailer_slug', activeRetailer);
    setLocation(`/search?${params.toString()}`);
  };

  const clearFilters = () => {
    setActiveGoal('');
    setActiveMeal('');
    setActiveRetailer('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    setLocation(`/search?${params.toString()}`);
  };

  return (
    <Layout>
      <div className="flex flex-col h-full bg-background">
        
        {/* Header Search Bar */}
        <div className="bg-card border-b border-border sticky top-0 z-10 pt-4">
          <div className="flex items-center gap-3 px-4 pb-4">
            <button onClick={() => window.history.back()} className="text-foreground p-2 -ml-2 hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <form onSubmit={handleSearch} className="flex-1 relative flex items-center">
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('search_placeholder')}
                className="w-full h-12 bg-muted border-none pl-4 pr-10 text-sm font-medium focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground"
                autoFocus
              />
              <button type="submit" className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors">
                <span className="sr-only">搜尋</span>
                <SearchIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* Filters Bar */}
          <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto no-scrollbar whitespace-nowrap">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground mr-1" />
            {(activeGoal || activeMeal || activeRetailer) && (
              <button onClick={clearFilters} className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground px-2 hover:text-foreground">
                清除
              </button>
            )}
            
            <select 
              value={activeGoal} 
              onChange={(e) => {
                setActiveGoal(e.target.value);
                const params = new URLSearchParams(queryString);
                if (e.target.value) params.set('goal_slug', e.target.value);
                else params.delete('goal_slug');
                setLocation(`/search?${params.toString()}`);
              }}
              className="text-xs bg-background border border-border px-3 py-1.5 font-medium appearance-none focus:outline-none focus:border-primary"
            >
              <option value="">所有需求</option>
              <option value="skin_health">支持皮膚健康</option>
              <option value="body_fat">降低體脂／管理體重</option>
              <option value="protein">增加蛋白質攝取</option>
            </select>

            <select 
              value={activeMeal} 
              onChange={(e) => {
                setActiveMeal(e.target.value);
                const params = new URLSearchParams(queryString);
                if (e.target.value) params.set('meal_type', e.target.value);
                else params.delete('meal_type');
                setLocation(`/search?${params.toString()}`);
              }}
              className="text-xs bg-background border border-border px-3 py-1.5 font-medium appearance-none focus:outline-none focus:border-primary"
            >
              <option value="">所有時段</option>
              <option value="breakfast">早餐</option>
              <option value="lunch">午餐</option>
              <option value="dinner">晚餐</option>
              <option value="snack">點心</option>
            </select>
          </div>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">

          {!isLoading && data && (
            <div className="bg-card border border-border p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-primary-strong shrink-0 mt-0.5" />
              <div>
                <h1 className="text-sm font-black">{initialQ ? `「${initialQ}」的搜尋結果` : '先看已完成核對的商品'}</h1>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  {initialQ
                    ? '先查已驗證資料與 52,009 筆來源候選；不足時，AI 會接著查現售電商，不用你自己到處找。'
                    : '先從已核對商品開始，也可以輸入名稱、品牌或類別；沒有條碼時一樣能找。'}
                </p>
              </div>
            </div>
          )}
          
          {isLoading && (
            <div className="flex flex-col gap-4">
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="flex gap-4 p-4 bg-card border border-border">
                  <Skeleton className="w-16 h-16" />
                  <div className="flex-1 flex flex-col gap-2">
                    <Skeleton className="w-3/4 h-5" />
                    <Skeleton className="w-1/2 h-4" />
                    <Skeleton className="w-1/3 h-4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {initialQ && liveDiscovery.isLoading && (
            <section className="bg-foreground text-background p-5 flex items-start gap-4" aria-live="polite">
              <LoaderCircle className="w-6 h-6 text-primary animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black tracking-[0.18em] text-primary">FACTA LIVE CATALOG</p>
                <h2 className="font-black text-lg mt-2">AI 正在替你查現售商品</h2>
                <p className="text-xs text-background/65 leading-relaxed mt-2">同步找 momo、PChome、蝦皮、家樂福、全聯、Costco 等 12 個通路；只留下同一商品或同類型的直接商品頁。</p>
              </div>
            </section>
          )}

          {initialQ && liveDiscovery.data && liveDiscovery.data.candidates.length > 0 && (
            <section className="flex flex-col gap-3" aria-labelledby="live-catalog-heading">
              <div className="bg-foreground text-background p-5">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="w-5 h-5" />
                  <p className="text-[10px] font-black tracking-[0.18em]">FACTA LIVE CATALOG</p>
                </div>
                <h2 id="live-catalog-heading" className="font-black text-xl mt-3">網路上找到 {liveDiscovery.data.candidates.length} 款可核對的現售商品</h2>
                <p className="text-xs text-background/65 leading-relaxed mt-2">這些是商品身分與購買線索，不是健康推薦。你選中手上那款後，FACTA 會用包裝標示完成分析。</p>
              </div>

              {liveDiscovery.data.candidates.map((candidate) => (
                <article key={candidate.productUrl} className="bg-card border-2 border-foreground p-4 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-14 h-14 bg-muted shrink-0 flex items-center justify-center">
                      <SearchIcon className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-1 text-[9px] font-black tracking-wide bg-primary text-black">
                          {candidate.matchConfidence === 'exact' ? '高度符合' : '同類商品'}
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground">{candidate.retailerName}{candidate.priceNtd != null ? ` · NT$${candidate.priceNtd.toLocaleString()}` : ''}</span>
                      </div>
                      <h3 className="font-black text-sm leading-snug mt-2">{candidate.name}</h3>
                      {candidate.brandName && <p className="text-[10px] text-muted-foreground mt-1">{candidate.brandName}</p>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed border-l-4 border-primary pl-3">{candidate.whyMatchZh}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        track('live_catalog_candidate_verify_clicked', { query: initialQ, retailer: candidate.retailerName });
                        setLocation(`/submit?name=${encodeURIComponent(candidate.name)}&brand=${encodeURIComponent(candidate.brandName ?? '')}`);
                      }}
                      className="min-h-12 bg-primary text-black px-4 text-xs font-black flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
                    >
                      <Camera className="w-4 h-4" /> 這是手上那款，立即分析
                    </button>
                    <a
                      href={candidate.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track('live_catalog_listing_opened', { query: initialQ, retailer: candidate.retailerName })}
                      className="min-h-12 border-2 border-foreground px-4 text-xs font-black flex items-center justify-center gap-2 hover:bg-foreground hover:text-background transition-colors"
                    >
                      查看商品頁 <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </article>
              ))}
              <p className="text-[10px] text-muted-foreground leading-relaxed">{liveDiscovery.data.caveatZh}</p>
            </section>
          )}

          {initialQ && liveDiscovery.data && liveDiscovery.data.status !== 'complete' && (
            <div className="bg-card border border-border p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black">即時電商搜尋暫時沒有可靠結果</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">FACTA 不會用不確定的網頁硬湊商品。拍下手上包裝，仍可直接建立可核對分析。</p>
              </div>
            </div>
          )}

          {!isLoading && data && data.products && data.products.length > 0 && (
            <div className="flex flex-col gap-4">
              {data.products.map((item, i) => (
                <div key={i} onClick={() => setLocation(`/report/${item.product.id}`)} className="bg-card border border-border p-4 flex gap-4 cursor-pointer hover:border-primary transition-colors group">
                  <div className="w-16 h-16 bg-muted shrink-0 flex items-center justify-center p-1">
                    {item.product.imageUrl ? (
                      <img src={item.product.imageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                    ) : (
                      <SearchIcon className="w-6 h-6 text-muted-foreground/30" />
                    )}
                  </div>
                  
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-bold text-sm line-clamp-2 leading-snug group-hover:text-primary-strong transition-colors">
                        {lang === 'zh' && item.product.nameZh ? item.product.nameZh : item.product.name}
                      </p>
                      <div className="shrink-0 flex items-center justify-center bg-primary/10 text-primary-strong w-8 h-8 font-mono font-bold text-sm">
                        {item.product.overallScore ?? '—'}
                      </div>
                    </div>
                    
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1 truncate">
                      {item.product.brandName || '品牌待確認'}
                    </p>

                    {item.fitLevel && (
                      <div className="mt-3 flex items-center gap-2">
                        <span 
                          className="px-2 py-0.5 text-[10px] font-bold tracking-widest text-black"
                          style={{ backgroundColor: fitColors[item.fitLevel] || fitColors.insufficient_data }}
                        >
                          {lang === 'zh' && item.relevanceLabelZh ? item.relevanceLabelZh : item.relevanceLabel}
                        </span>
                      </div>
                    )}
                    
                    {item.matchReasonsZh && item.matchReasonsZh.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.matchReasonsZh.map((r, ri) => (
                          <span key={ri} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 whitespace-nowrap">
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {!initialQ && (
                <button
                  type="button"
                  onClick={() => setLocation('/scan')}
                  className="p-4 border-2 border-dashed border-foreground text-left hover:bg-card transition-colors"
                >
                  <span className="block text-sm font-black">手上的商品沒出現？直接掃它</span>
                  <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">
                    掃不到時再拍包裝背面；你補完一款，下一位掃到同款就能少走一步。
                  </span>
                </button>
              )}
            </div>
          )}

          {!isLoading && data && data.catalogItems && data.catalogItems.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {lang === 'zh' ? '公開商品資料・待 FACTA 驗證' : 'Public catalog data · FACTA verification pending'}
              </div>
              {data.catalogItems.map((c) => (
                <div key={c.factaSeedId} className="bg-card border border-border p-4 flex gap-4">
                  <div className="w-16 h-16 bg-muted shrink-0 flex items-center justify-center p-1">
                    {c.imageUrl ? (
                      <img src={c.imageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                    ) : (
                      <SearchIcon className="w-6 h-6 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col min-w-0">
                    <p className="font-bold text-sm line-clamp-2 leading-snug">{c.productName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1 truncate">
                      {[c.brandRaw, c.retailer, c.priceTwd != null ? `NT${c.priceTwd}` : null].filter(Boolean).join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 text-[10px] font-bold tracking-wide bg-amber-100 text-amber-800 border border-amber-300">
                        {lang === 'zh'
                          ? c.catalogSourceType === 'official_traceability'
                            ? c.evidenceTier === 'review_ready'
                              ? '官方公開資料・標示待核對'
                              : '官方公開資料・證據待補齊'
                            : '通路型錄・待標籤驗證'
                          : 'Public data · label verification needed'}
                      </span>
                      {c.aiEnrichmentStatus === 'queued' && (
                        <span className="px-2 py-0.5 text-[10px] font-bold tracking-wide border border-border text-muted-foreground">
                          AI 標示擷取待處理
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setLocation(`/submit?name=${encodeURIComponent(c.productName)}&brand=${encodeURIComponent(c.brandRaw ?? '')}`)}
                      className="mt-3 self-start text-[11px] font-bold underline text-primary-strong"
                    >
                      {lang === 'zh' ? '核對手上包裝，解鎖行動建議 →' : 'Verify the package to unlock an action recommendation →'}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                {lang === 'zh'
                  ? '這些資料來自官方公開資料集或通路頁面，尚未經 FACTA 核對，因此不顯示分數，也不會直接叫你買。你核對一款，下一位就能更快得到可靠結論。'
                  : 'These public records remain unscored until FACTA verifies the physical label.'}
              </p>
            </div>
          )}

          {!isLoading && !liveDiscovery.isLoading && data && initialQ && data.products && data.products.length === 0 && (!data.catalogItems || data.catalogItems.length === 0) && (!liveDiscovery.data?.candidates.length) && (
            <div className="flex flex-col items-center justify-center text-center p-10 bg-card border border-border border-dashed mt-4">
              <AlertCircle className="w-8 h-8 text-muted-foreground mb-4" />
              <p className="text-sm font-semibold mb-2">
                找不到「{initialQ}」
              </p>
              <p className="text-xs text-muted-foreground mb-6 max-w-[200px]">
                目前資料庫沒有完全符合的紀錄。拍下包裝背面，FACTA 會先給你一份可核對的初步報告。
              </p>
              <button 
                onClick={() => setLocation(`/submit?name=${encodeURIComponent(initialQ)}`)}
                className="bg-primary text-primary-foreground px-6 py-3 text-xs font-bold uppercase tracking-widest hover:bg-primary/90 transition-colors"
              >
                {t('photo_ingredients')}
              </button>
            </div>
          )}

          {!isLoading && data && data.guides && data.guides.length > 0 && (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <BookOpen className="w-4 h-4" />
                相關指南
              </div>
              <div className="flex flex-col gap-3">
                {data.guides.map((guide, i) => (
                  <div key={i} className="bg-[#F2B84B]/10 border border-[#F2B84B]/30 p-4 hover:bg-[#F2B84B]/20 transition-colors cursor-pointer">
                    <p className="font-bold text-sm">{lang === 'zh' && guide.titleZh ? guide.titleZh : guide.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{lang === 'zh' && guide.summaryZh ? guide.summaryZh : guide.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
