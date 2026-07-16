import React, { useState } from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ShieldCheck, Database, Search, Target, Clock, Trash2, CheckCircle2, ChevronDown, ChevronUp, Camera, ScanLine, BookOpen } from 'lucide-react';
import { useGetScanHistory, useGetUserGoals, useGetGoal, useListCollections, useListMealLogs, useDeleteMealLog, useListSafetyAlerts, useGetProduct, useGetProductEvaluation } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';
import { track } from '@/lib/analytics';

/** Verified product with complete data used as the public sample report. */
const SAMPLE_PRODUCT_ID = 6;

function SafetyAlertNotice() {
  const [expanded, setExpanded] = useState(false);
  const { data } = useListSafetyAlerts({ query: { staleTime: 10 * 60 * 1000 } as any });

  const alerts = data?.alerts ?? [];
  if (alerts.length === 0) return null;
  const alert = alerts[0];

  return (
    <div className="bg-red-50 border-l-4 border-red-600">
      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600"
      >
        <span className="bg-red-600 text-white px-1.5 py-0.5 text-[9px] font-black tracking-widest shrink-0">食安警報</span>
        <span className="text-xs font-bold text-red-800 leading-snug flex-1 line-clamp-2">{alert.titleZh || alert.title}</span>
        <span className="text-[10px] font-bold text-red-700 shrink-0 flex items-center gap-0.5">
          {expanded ? '收合' : '查看詳情'}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <p className="text-xs text-red-900/90 leading-relaxed">{alert.summaryZh || alert.summary}</p>
          {alert.officialUrl && (
            <a href={alert.officialUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline font-bold text-red-700">
              查看食藥署官方完整下架名單 →
            </a>
          )}
          <p className="text-[10px] text-red-900/60">掃描商品時，FACTA 會自動比對受影響品牌並警示。</p>
        </div>
      )}
    </div>
  );
}

/** Compact preview of a real, verified FACTA report. */
function SampleReport() {
  const [, setLocation] = useLocation();
  const [whyOpen, setWhyOpen] = useState(false);
  const { data: product } = useGetProduct(SAMPLE_PRODUCT_ID, { query: { staleTime: 10 * 60 * 1000 } as any });
  const { data: evaluation } = useGetProductEvaluation(SAMPLE_PRODUCT_ID, { query: { staleTime: 10 * 60 * 1000 } as any });

  if (!product || !evaluation || product.verificationStatus !== 'verified') return null;

  const findings = (evaluation.topReasons ?? []).slice(0, 3);

  return (
    <section id="sample-report" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">真實分析報告範例</h2>
        <span className="text-[10px] font-bold bg-primary/15 text-primary-strong px-2 py-0.5">已驗證商品</span>
      </div>

      <div className="bg-card border-2 border-foreground p-5 flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-muted shrink-0 flex items-center justify-center p-1">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.nameZh || product.name} className="w-full h-full object-contain mix-blend-multiply" />
            ) : (
              <Database className="w-6 h-6 text-muted-foreground/30" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-base leading-snug">{product.nameZh || product.name}</p>
            <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-0.5">{product.brandName}</p>
          </div>
          <div className="shrink-0 flex flex-col items-center">
            <span className="text-3xl font-black font-mono text-primary-strong">{evaluation.overallScore}</span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">FACTA 評分</span>
          </div>
        </div>

        {evaluation.verdictZh && (
          <p className="text-sm font-bold border-l-4 border-primary pl-3 py-0.5">{evaluation.verdictZh}</p>
        )}

        {findings.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">主要發現</p>
            {findings.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary-strong" />
                <span className="leading-relaxed">{r.labelZh || r.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-muted/60 p-3 flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">個人化提醒</p>
          <p className="text-xs leading-relaxed">設定你的過敏原與健康目標後，FACTA 會針對你的需求標示需要注意的成分。</p>
        </div>

        <button
          onClick={() => setWhyOpen(v => !v)}
          aria-expanded={whyOpen}
          className="flex items-center justify-between text-xs font-bold py-2 border-t border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          為什麼這樣評分？
          {whyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {whyOpen && (
          <div className="text-xs text-muted-foreground leading-relaxed flex flex-col gap-2 -mt-2">
            <p>FACTA 評分（0–100）由公開的評分規則計算：營養成分依台灣衛福部與國際營養基準評估，食品添加物依法規許可狀態與現有證據分級。每項結論都附資料來源，演算法版本 {evaluation.rulesetVersion}。</p>
            <Link href="/methodology" className="underline font-bold text-foreground">查看完整評分方法 →</Link>
          </div>
        )}

        <button
          onClick={() => { track('sample_report_viewed', { productId: SAMPLE_PRODUCT_ID }); setLocation(`/report/${SAMPLE_PRODUCT_ID}`); }}
          className="w-full py-3.5 border-2 border-foreground font-bold tracking-widest text-sm hover:bg-foreground hover:text-background transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          看完整報告（含替代品建議）
        </button>
      </div>
    </section>
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

export default function Home() {
  const { t, lang, setLang } = useTranslation();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const [searchQuery, setSearchQuery] = useState('');
  const currentMeal = getCurrentMealType();
  const todayStr = new Date().toLocaleDateString('sv-SE');

  const { data: history, isLoading: historyLoading } = useGetScanHistory({ user_session: sessionId, limit: 3 });

  const { data: userGoalsData } = useGetUserGoals(sessionId);
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
      onSuccess: () => { window.location.reload(); }
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
              aria-label="切換語言"
              className="text-[10px] font-bold px-2 py-1 bg-muted hover:bg-muted/80 transition-colors uppercase tracking-widest"
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </header>

          <div className="px-6 pt-4">
            <SafetyAlertNotice />
          </div>

          {/* Search */}
          <div className="px-6 py-6 bg-card border-b border-border">
            <form onSubmit={handleSearch} className="relative">
              <label htmlFor="home-search" className="sr-only">搜尋商品</label>
              <input
                id="home-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                className="w-full h-14 bg-background border border-border px-4 pr-12 text-sm font-medium focus:ring-2 focus:ring-primary outline-none transition-all placeholder:text-muted-foreground placeholder:font-normal shadow-sm"
              />
              <button type="submit" aria-label="搜尋" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
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
                      <span className="text-sm font-bold uppercase tracking-widest">{mealLabels[currentMeal]}建議</span>
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
                  <CheckCircle2 className="w-4 h-4" /> 推薦商品
                </h2>
                <Link href={`/search?goal_slug=${activeGoalSlug}`} className="text-[10px] font-bold uppercase tracking-widest hover:text-primary-strong transition-colors">查看全部</Link>
              </div>

              {collLoading ? (
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                  {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="w-48 h-64 shrink-0" />)}
                </div>
              ) : collections && collections.length > 0 ? (
                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-6 px-6">
                  {collections.slice(0,3).map((col) => (
                    <Link key={col.slug} href={`/search?goal_slug=${activeGoalSlug}&meal_type=${col.mealType}`} className="shrink-0 w-64 bg-card border border-border p-4 flex flex-col gap-3 hover:border-primary transition-colors group">
                      <div className="w-full h-32 bg-muted flex items-center justify-center p-2 mb-2">
                        <Database className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                      <h3 className="font-bold text-sm leading-snug group-hover:text-primary-strong transition-colors line-clamp-2">{lang === 'zh' && col.nameZh ? col.nameZh : col.name}</h3>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-auto">{col.productCount} 項商品 <ArrowRight className="w-3 h-3 inline-block ml-1" /></p>
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
                        商品 #{log.productId}
                      </Link>
                    </div>
                    <button onClick={() => handleDeleteLog(log.id)} aria-label="刪除這筆紀錄" className="text-muted-foreground hover:text-destructive transition-colors p-2 -mr-2">
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
              <Link href="/history" className="text-[10px] font-bold uppercase tracking-widest hover:text-primary-strong transition-colors">查看全部</Link>
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

          {/* Family Check offer */}
          <div className="px-6 py-4">
            <Link
              href="/family-check"
              onClick={() => track('family_check_offer_viewed', { source: 'home_returning' })}
              className="block bg-foreground text-background p-5 hover:bg-foreground/90 transition-colors"
            >
              <p className="font-black text-base">FACTA 家庭食品健檢</p>
              <p className="text-xs text-background/70 mt-1 leading-relaxed">一次檢查家裡最常吃的 10 項食品。首發價 NT$299。</p>
              <span className="inline-flex items-center gap-1 mt-3 text-xs font-bold text-primary">了解服務內容 <ArrowRight className="w-3.5 h-3.5" /></span>
            </Link>
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
      <div className="px-6 pt-12 pb-6 flex flex-col gap-10 bg-background min-h-full">

        {/* 1. Hero */}
        <header className="flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <h1 className="text-5xl font-black tracking-tighter text-foreground">FACTA</h1>
            <button
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              aria-label="切換語言"
              className="text-[10px] font-bold px-2 py-1 bg-muted hover:bg-muted/80 transition-colors uppercase tracking-widest"
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>

          <h2 className="text-2xl font-black leading-snug mt-4">
            拍一張成分表，<br />30 秒知道這款商品適不適合你。
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            FACTA 依據台灣法規、營養證據與你的個人需求，找出需要注意的成分，並推薦更適合的選擇。
          </p>

          <div className="flex flex-col gap-3 mt-5">
            <button
              onClick={() => { track('hero_free_analysis_clicked'); setLocation('/submit'); }}
              className="w-full py-4 bg-foreground text-background font-black tracking-widest text-base flex items-center justify-center gap-3 hover:bg-foreground/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Camera className="w-5 h-5" /> 免費分析第一款
            </button>
            <button
              onClick={() => {
                track('sample_report_viewed', { source: 'hero_secondary_cta' });
                document.getElementById('sample-report')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full py-3.5 border-2 border-foreground font-bold tracking-widest text-sm hover:bg-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              先看一份真實報告
            </button>
          </div>

          <ul className="flex flex-col gap-1.5 mt-4">
            {['每項結論附資料來源', '不接受品牌付費改分', '不出售你的健康與掃描資料'].map(p => (
              <li key={p} className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-primary-strong shrink-0" /> {p}
              </li>
            ))}
          </ul>
        </header>

        {/* 2. Sample report */}
        <SampleReport />

        <p className="text-center text-sm font-bold border-y border-border py-4">
          「包裝負責說故事。FACTA 負責看證據。」
        </p>

        {/* 3. How it works */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">三步驟</h2>
          <ol className="flex flex-col gap-3">
            {[
              { icon: Camera, title: '拍攝成分表', desc: '拍一張商品背面的成分表，或掃描條碼。' },
              { icon: ScanLine, title: 'AI 自動辨識', desc: 'FACTA 自動辨識商品名稱、成分與營養標示，約 20–30 秒。' },
              { icon: CheckCircle2, title: '看懂該注意什麼', desc: '取得 0–100 評分、需要注意的成分，以及更適合的替代品。' },
            ].map((s, i) => (
              <li key={i} className="flex items-start gap-4 bg-card border border-border p-4">
                <span className="w-8 h-8 shrink-0 bg-foreground text-background font-black flex items-center justify-center">{i + 1}</span>
                <div>
                  <p className="font-bold text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* 4. How FACTA scores */}
        <section className="bg-card border border-border p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary-strong" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">FACTA 如何評分</h2>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            評分依據台灣衛福部法規、食品添加物許可狀態與公開營養科學證據，由固定的公開規則計算，不受品牌影響。每項結論附資料來源。
          </p>
          <Link href="/methodology" className="text-xs font-bold underline">查看完整評分方法 →</Link>
        </section>

        {/* 5. Paid service */}
        <section className="bg-foreground text-background p-6 flex flex-col gap-3">
          <span className="self-start bg-primary text-black px-2 py-0.5 text-[10px] font-black tracking-widest">一次性服務</span>
          <h2 className="text-xl font-black leading-snug">FACTA 家庭食品健檢</h2>
          <p className="text-xs text-background/80 leading-relaxed">
            一次檢查家裡最常吃的 10 項食品，找出需要注意的成分、行銷話術與更適合的替代品。24 小時內完成報告。
          </p>
          <div className="flex items-end gap-2 mt-1">
            <span className="text-2xl font-black">NT$299</span>
            <span className="text-xs text-background/50 line-through mb-1">正式價 NT$499</span>
          </div>
          <Link
            href="/family-check"
            onClick={() => track('family_check_offer_viewed', { source: 'home_new_user' })}
            className="mt-2 w-full py-3.5 bg-primary text-black font-black tracking-widest text-sm text-center hover:bg-primary/90 transition-colors"
          >
            開始檢查家裡的食品
          </Link>
          <p className="text-[10px] text-background/60">若 24 小時內未完成報告，可申請退款。</p>
        </section>

        {/* 6. Safety alert — compact collapsed notice */}
        <SafetyAlertNotice />

        {/* Onboarding CTA */}
        <Link href="/onboarding" className="p-5 bg-primary/10 border border-primary flex items-center justify-between hover:bg-primary/20 transition-colors group">
          <div className="flex items-center gap-3 text-primary-strong">
            <Target className="w-6 h-6 shrink-0" />
            <span className="font-bold text-sm">{t('set_goal_cta')}</span>
          </div>
          <ArrowRight className="w-5 h-5 text-primary-strong group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>

        {/* 7. Privacy / independence / disclaimer */}
        <footer className="flex flex-col gap-2 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-5 pb-2">
          <p className="font-bold text-xs text-foreground">隱私與獨立性</p>
          <p>FACTA 不出售你的健康與掃描資料，照片只用於辨識商品資訊，分析完成後可刪除。評分由公開規則計算，不接受品牌付費改分。</p>
          <p>FACTA 提供的是食品資訊整理與比較，不是醫療診斷或治療建議。若有特殊健康狀況，請諮詢醫師或營養師。</p>
        </footer>

      </div>
    </Layout>
  );
}
