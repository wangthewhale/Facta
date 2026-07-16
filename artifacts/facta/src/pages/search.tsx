import React, { useState, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Layout } from '@/components/layout';
import { useSearchProducts } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { Search as SearchIcon, ArrowLeft, SlidersHorizontal, BookOpen, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { getSessionId } from '@/lib/session';

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
      enabled: initialQ.length > 0 || !!activeGoal || !!activeMeal || !!activeRetailer
    } as any
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
                <SearchIcon className="w-5 h-5" />
              </button>
            </form>
          </div>

          {/* Filters Bar */}
          <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto no-scrollbar whitespace-nowrap">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground mr-1" />
            {(activeGoal || activeMeal || activeRetailer) && (
              <button onClick={clearFilters} className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground px-2 hover:text-foreground">
                Clear
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
              <option value="">All Goals</option>
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
              <option value="">All Meals</option>
              <option value="breakfast">早餐 (Breakfast)</option>
              <option value="lunch">午餐 (Lunch)</option>
              <option value="dinner">晚餐 (Dinner)</option>
              <option value="snack">點心 (Snack)</option>
            </select>
          </div>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
          
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
                        {item.product.overallScore}
                      </div>
                    </div>
                    
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1 truncate">
                      {item.product.brandName || 'Unknown Brand'}
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
            </div>
          )}

          {!isLoading && data && data.catalogItems && data.catalogItems.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {lang === 'zh' ? '通路型錄商品' : 'Retail Catalog Items'}
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
                        {lang === 'zh' ? '型錄資料・待標籤驗證' : 'Catalog data · label verification needed'}
                      </span>
                    </div>
                    <button
                      onClick={() => setLocation(`/submit?name=${encodeURIComponent(c.productName)}&brand=${encodeURIComponent(c.brandRaw ?? '')}`)}
                      className="mt-3 self-start text-[11px] font-bold underline text-primary-strong"
                    >
                      {lang === 'zh' ? '拍照補標籤資料，解鎖 FACTA 評分 →' : 'Photograph the label to unlock a FACTA score →'}
                    </button>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                {lang === 'zh'
                  ? '型錄商品來自通路公開網頁，尚未經標籤驗證，因此不顯示評分。'
                  : 'Catalog items come from public retailer listings and are unscored until label-verified.'}
              </p>
            </div>
          )}

          {!isLoading && data && data.products && data.products.length === 0 && (!data.catalogItems || data.catalogItems.length === 0) && (
            <div className="flex flex-col items-center justify-center text-center p-10 bg-card border border-border border-dashed mt-4">
              <AlertCircle className="w-8 h-8 text-muted-foreground mb-4" />
              <p className="text-sm font-semibold mb-2">
                找不到「{initialQ}」
              </p>
              <p className="text-xs text-muted-foreground mb-6 max-w-[200px]">
                目前資料庫中沒有完全符合的紀錄。
              </p>
              <button 
                onClick={() => setLocation('/submit')}
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
                Related Guides
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
