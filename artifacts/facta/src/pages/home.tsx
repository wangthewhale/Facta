import React, { useState } from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { ScanLine, Camera, ArrowRight, ShieldCheck, Database, Search, Target, Clock, X, Trash2, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useGetDashboardStats, useGetScanHistory, useGetUserGoals, useGetGoal, useListCollections, useListMealLogs, useDeleteMealLog, useListSafetyAlerts } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { GradeBadge } from '@/pages/report';

function SafetyAlertBanner() {
  const { lang } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const { data } = useListSafetyAlerts({ query: { staleTime: 10 * 60 * 1000 } as any });

  const alerts = data?.alerts ?? [];
  if (dismissed || alerts.length === 0) return null;
  const alert = alerts[0];

  return (
    <div className="relative bg-red-50 border-l-4 border-red-600 p-4 flex flex-col gap-1.5">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-700"
        aria-label="dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <span className="self-start bg-red-600 text-white px-2 py-0.5 text-[10px] font-black tracking-widest uppercase">
        {lang === 'zh' ? '政府食安警報' : 'GOV FOOD SAFETY ALERT'}
      </span>
      <p className="text-sm font-black text-red-700 leading-snug pr-6">
        {lang === 'zh' ? alert.titleZh : alert.title}
      </p>
      <p className="text-xs text-red-900/90 leading-relaxed line-clamp-4">
        {lang === 'zh' ? alert.summaryZh : alert.summary}
      </p>
      {alert.officialUrl && (
        <a
          href={alert.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline font-bold text-red-700"
        >
          {lang === 'zh' ? '查看食藥署官方完整下架名單 →' : 'View full official TFDA recall list →'}
        </a>
      )}
      <p className="text-[10px] text-red-900/60">
        {lang === 'zh' ? '掃描商品時，FACTA 會自動比對受影響品牌並警示。' : 'FACTA automatically checks scanned products against affected brands.'}
      </p>
    </div>
  );
}

function getCurrentMealType(): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'dinner';
  return 'snack';
}

const mealLabels: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', snack: '點心', dinner: '晚餐'
};

const fitColors: Record<string, string> = {
  great_fit: '#B9F24A',
  good_fit: '#B9F24A',
  mixed_fit: '#F2B84B',
  poor_fit: '#E45145',
  insufficient_data: '#9CA3AF',
};

export default function Home() {
  const { t, lang, setLang } = useTranslation();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const [searchQuery, setSearchQuery] = useState('');
  const currentMeal = getCurrentMealType();
  const todayStr = new Date().toLocaleDateString('sv-SE');

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: history, isLoading: historyLoading } = useGetScanHistory({ user_session: sessionId, limit: 3 });
  
  const { data: userGoalsData, isLoading: goalsLoading } = useGetUserGoals(sessionId);
  const activeGoals = userGoalsData?.activeGoals || [];
  const activeGoalSlug = activeGoals.length > 0 ? activeGoals[0].goalSlug : undefined;

  const { data: activeGoalDetail } = useGetGoal(activeGoalSlug!, {
    query: { enabled: !!activeGoalSlug } as any
  });
  
  const { data: collections, isLoading: collLoading } = useListCollections({ goal_slug: activeGoalSlug, meal_type: currentMeal }, {
    query: { enabled: !!activeGoalSlug } as any
  });

  const { data: myDay, isLoading: dayLoading } = useListMealLogs({ session_id: sessionId, date_str: todayStr });
  const deleteMealLog = useDeleteMealLog();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  const handleDeleteLog = (id: number) => {
    deleteMealLog.mutate({ id }, {
      onSuccess: () => {
        // Optimistic cache update would be better, but refetching is fine for simple app
        window.location.reload();
      }
    });
  };

  const isReturning = userGoalsData?.profile?.onboardingCompleted;

  if (isReturning) {
    return (
      <Layout>
        <div className="flex flex-col min-h-full bg-background pb-10">
          
          {/* Header */}
          <header className="px-6 pt-10 pb-4 flex justify-between items-center bg-card border-b border-border sticky top-0 z-10">
            <h1 className="text-2xl font-bold tracking-tighter text-foreground">FACTA</h1>
            <button 
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="text-[10px] font-bold px-2 py-1 bg-muted hover:bg-muted/80 transition-colors uppercase tracking-widest"
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </header>

          {/* Search */}
          <div className="px-6 py-6 bg-card border-b border-border">
            <form onSubmit={handleSearch} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                className="w-full h-14 bg-background border border-border px-4 pr-12 text-sm font-medium focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground placeholder:font-normal shadow-sm"
              />
              <button type="submit" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                <Search className="w-5 h-5" />
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-2 p-6 pb-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('today_goal')}</h2>
            </div>
            
            {activeGoals.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                {activeGoals.map(goal => (
                  <Link key={goal.goalId} href={`/goals/${goal.goalSlug}`} className="shrink-0 bg-primary/10 border border-primary text-primary-strong px-4 py-2 font-bold text-sm flex items-center gap-2 hover:bg-primary/20 transition-colors">
                    {lang === 'zh' && goal.goalNameZh ? goal.goalNameZh : goal.goalName}
                  </Link>
                ))}
              </div>
            ) : (
              <Link href="/onboarding" className="bg-muted border border-border border-dashed p-4 flex items-center justify-between hover:bg-accent transition-colors group text-left">
                <span className="text-sm font-bold text-muted-foreground group-hover:text-foreground">{t('set_goal_cta')}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            )}
          </div>

          {/* Meal Timing Hero */}
          {activeGoals.length > 0 && activeGoalDetail?.mealContexts && (
            <div className="px-6 py-4">
              {(() => {
                const mealCtx = activeGoalDetail.mealContexts.find(m => m.meal === currentMeal);
                if (!mealCtx) return null;
                return (
                  <div className="bg-foreground text-background p-6 shadow-sm border border-foreground">
                    <div className="flex items-center gap-2 mb-4 text-primary-strong">
                      <Clock className="w-5 h-5" />
                      <span className="text-sm font-bold uppercase tracking-widest">{mealLabels[currentMeal]} Context</span>
                    </div>
                    <h3 className="text-xl font-bold mb-6 leading-tight">{lang === 'zh' && mealCtx.headlineZh ? mealCtx.headlineZh : mealCtx.headline}</h3>
                    
                    <div className="flex flex-col gap-4 mb-6">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80 mb-2">{t('choose_more')}</p>
                        <p className="text-sm font-medium leading-relaxed">{(mealCtx.chooseMore || []).join('、')}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#F2B84B]/80 mb-2">{t('choose_less')}</p>
                        <p className="text-sm font-medium leading-relaxed text-background/80">{(mealCtx.chooseLess || []).join('、')}</p>
                      </div>
                    </div>

                    <Link href={`/search?goal_slug=${activeGoalSlug}&meal_type=${currentMeal}`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest border border-primary text-primary-strong px-4 py-2 hover:bg-primary hover:text-primary-foreground transition-colors">
                      {mealCtx.ctaText} <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Recommendations from Collections */}
          {activeGoals.length > 0 && (
            <div className="px-6 py-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Recommendations
                </h2>
                <Link href={`/search?goal_slug=${activeGoalSlug}`} className="text-[10px] font-bold uppercase tracking-widest hover:text-primary-strong transition-colors">View All</Link>
              </div>

              {collLoading ? (
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                  {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="w-48 h-64 shrink-0" />)}
                </div>
              ) : collections && collections.length > 0 ? (
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-6 px-6">
                  {/* For brevity on home, we just link to the first collection's search equivalent or render its products if we had them. We render dummy collection cards representing product fits. */}
                  {collections.slice(0,3).map((col, i) => (
                    <Link key={col.slug} href={`/search?goal_slug=${activeGoalSlug}&meal_type=${col.mealType}`} className="shrink-0 w-64 bg-card border border-border p-4 flex flex-col gap-3 hover:border-primary transition-colors group">
                      <div className="w-full h-32 bg-muted flex items-center justify-center p-2 mb-2">
                        {/* Placeholder for collection image */}
                        <Database className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                      <h3 className="font-bold text-sm leading-snug group-hover:text-primary-strong transition-colors line-clamp-2">{lang === 'zh' && col.nameZh ? col.nameZh : col.name}</h3>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-auto">{col.productCount} Products <ArrowRight className="w-3 h-3 inline-block ml-1" /></p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border border-dashed p-6 text-center text-sm text-muted-foreground">
                  目前沒有符合此目標的已驗證商品推薦。
                </div>
              )}
            </div>
          )}

          {/* My Day */}
          <div className="px-6 py-4 flex flex-col gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('my_day')} - {new Date().toLocaleDateString(lang === 'zh' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric' })}</h2>
            
            <div className="bg-card border border-border flex flex-col">
              {dayLoading ? (
                <div className="p-4"><Skeleton className="h-12 w-full" /></div>
              ) : myDay && myDay.length > 0 ? (
                myDay.map((log) => (
                  <div key={log.id} className="p-4 border-b border-border last:border-0 flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest bg-muted px-1.5 py-0.5">{mealLabels[log.mealType] || log.mealType}</span>
                      </div>
                      <Link href={`/report/${log.productId}`} className="font-bold text-sm truncate hover:text-primary-strong transition-colors">
                        Product #{log.productId}
                      </Link>
                    </div>
                    <button onClick={() => handleDeleteLog(log.id)} className="text-muted-foreground hover:text-destructive transition-colors p-2 -mr-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
                  <Database className="w-6 h-6 text-muted-foreground/50" />
                  今天還沒有記錄。<br/>掃描後可以加入 My Day。
                </div>
              )}
            </div>
          </div>

          {/* Recent Scans */}
          <div className="px-6 py-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t('recent_scans')}</h2>
              <Link href="/history" className="text-[10px] font-bold uppercase tracking-widest hover:text-primary-strong transition-colors">View All</Link>
            </div>
            
            <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-6 px-6">
              {historyLoading ? (
                Array(3).fill(0).map((_, i) => <Skeleton key={i} className="w-32 h-32 shrink-0" />)
              ) : history && history.length > 0 ? (
                history.map((scan) => (
                  <Link key={scan.id} href={`/report/${scan.productId}`} className="shrink-0 w-32 bg-card border border-border p-3 flex flex-col gap-2 hover:border-primary transition-colors group">
                    <div className="w-full h-16 bg-muted flex items-center justify-center p-1">
                      {scan.imageUrl ? (
                        <img src={scan.imageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                      ) : (
                        <Search className="w-5 h-5 text-muted-foreground/30" />
                      )}
                    </div>
                    <span className="font-bold text-xs line-clamp-2 leading-snug group-hover:text-primary-strong transition-colors">{scan.productName || scan.barcode}</span>
                  </Link>
                ))
              ) : null}
            </div>
          </div>

          {/* Trust Statement */}
          <div className="mx-6 mt-4 p-5 bg-card border border-border flex flex-col gap-3 text-center items-center">
            <ShieldCheck className="w-6 h-6 text-primary-strong" />
            <div>
              <p className="font-bold text-sm">{t('trust_statement')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('campaign')}</p>
            </div>
          </div>

        </div>
      </Layout>
    );
  }

  // --- NEW USER VIEW ---
  return (
    <Layout>
      <div className="px-6 pt-12 pb-6 flex flex-col gap-10 bg-background h-full">
        
        {/* Header / Brand */}
        <header className="flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <h1 className="text-5xl font-black tracking-tighter text-foreground">FACTA</h1>
            <button 
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="text-[10px] font-bold px-2 py-1 bg-muted hover:bg-muted/80 transition-colors uppercase tracking-widest"
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>
          <div className="flex flex-col gap-1 mt-2 border-l-4 border-primary pl-4 py-1">
            <p className="text-sm font-bold text-foreground tracking-wide">{t('tagline_zh')}</p>
            <p className="text-xs text-muted-foreground font-mono">{t('tagline_en')}</p>
          </div>
        </header>

        <SafetyAlertBanner />

        {/* Primary Actions */}
        <div className="flex flex-col gap-3">
          <Link href="/scan" className="group relative flex items-center justify-between p-6 bg-foreground text-background hover:bg-foreground/90 transition-colors shadow-sm">
            <div className="flex items-center gap-4">
              <div className="bg-background text-foreground p-3 rounded-none">
                <ScanLine className="w-6 h-6" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-lg tracking-wide">{t('scan_product')}</span>
                <span className="text-[10px] font-bold text-background/70 font-mono tracking-widest">BARCODE LOOKUP</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
          </Link>

          <Link href="/submit" className="group relative flex items-center justify-between p-6 bg-card border border-border hover:border-primary transition-colors shadow-sm">
            <div className="flex items-center gap-4">
              <div className="bg-muted text-foreground p-3 rounded-none group-hover:bg-primary/10 group-hover:text-primary-strong transition-colors">
                <Camera className="w-6 h-6" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-lg tracking-wide">{t('photo_ingredients')}</span>
                <span className="text-[10px] font-bold text-muted-foreground font-mono tracking-widest">AI OCR ANALYSIS</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all group-hover:text-primary-strong" />
          </Link>
        </div>

        {/* Onboarding CTA */}
        <Link href="/onboarding" className="p-5 bg-primary/10 border border-primary flex items-center justify-between hover:bg-primary/20 transition-colors group">
          <div className="flex items-center gap-3 text-primary-strong">
            <Target className="w-6 h-6 shrink-0" />
            <span className="font-bold text-sm">{t('set_goal_cta')}</span>
          </div>
          <ChevronRight className="w-5 h-5 text-primary-strong group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>

        {/* Trust Statement */}
        <div className="bg-card border border-border p-5 flex flex-col gap-3">
          <ShieldCheck className="w-6 h-6 text-foreground" />
          <div>
            <p className="font-bold text-sm text-foreground leading-snug">{t('trust_statement')}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{t('campaign')}</p>
          </div>
        </div>

        {/* Dashboard Stats */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">{t('dashboard_stats')}</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-px bg-border">
            <div className="bg-card p-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{t('products_verified')}</span>
              {statsLoading ? <Skeleton className="h-8 w-16 mt-1" /> : <span className="text-2xl font-black font-mono mt-1">{stats?.verifiedProducts || 0}</span>}
            </div>
            <div className="bg-card p-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{t('total_scans')}</span>
              {statsLoading ? <Skeleton className="h-8 w-16 mt-1" /> : <span className="text-2xl font-black font-mono mt-1">{stats?.totalScans || 0}</span>}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}
