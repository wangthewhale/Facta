import React, { useState } from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ShieldCheck, Database, Search, Target, Clock, Trash2, CheckCircle2, ChevronDown, ChevronUp, Camera, ScanLine, BookOpen, AlertCircle, Scale, Users, GitCompareArrows, Menu, X, Share2, Sparkles } from 'lucide-react';
import { useGetScanHistory, useGetUserGoals, useGetGoal, useListCollections, useListMealLogs, useDeleteMealLog, useListSafetyAlerts, useGetProduct, useGetProductEvaluation } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';
import { track } from '@/lib/analytics';

const BETTER_SAMPLE_PRODUCT_ID = 6;
const WORSE_SAMPLE_PRODUCT_ID = 4;

function getScopeLabel(scope: string) {
  if (scope === 'complete') return '完整評分';
  if (scope === 'nutrition_only') return '營養初評';
  if (scope === 'ingredients_only') return '成分初評';
  if (scope === 'water') return '飲用水分析';
  return '資料不足';
}

function getActionTone(code: string) {
  if (code === 'buy') return {
    panel: 'bg-primary text-black',
    border: 'border-primary-strong',
    badge: 'bg-primary text-black',
  };
  if (code === 'limit') return {
    panel: 'bg-[#F2B84B] text-black',
    border: 'border-[#A56A00]',
    badge: 'bg-[#F2B84B] text-black',
  };
  if (code === 'swap') return {
    panel: 'bg-destructive text-destructive-foreground',
    border: 'border-destructive',
    badge: 'bg-destructive text-destructive-foreground',
  };
  return {
    panel: 'bg-foreground text-background',
    border: 'border-foreground',
    badge: 'bg-foreground text-background',
  };
}

function HeroDecisionDemo() {
  const [, setLocation] = useLocation();
  const productQuery = useGetProduct(WORSE_SAMPLE_PRODUCT_ID, { query: { staleTime: 10 * 60 * 1000 } as any });
  const evaluationQuery = useGetProductEvaluation(WORSE_SAMPLE_PRODUCT_ID, undefined, { query: { staleTime: 10 * 60 * 1000 } as any });

  if (productQuery.isLoading || evaluationQuery.isLoading) {
    return <Skeleton className="h-[430px] w-full border-2 border-border" />;
  }

  if (productQuery.isError || evaluationQuery.isError || !productQuery.data || !evaluationQuery.data) {
    return (
      <div className="min-h-72 border-2 border-border bg-card p-6 flex flex-col justify-center gap-4">
        <AlertCircle className="w-7 h-7 text-destructive" />
        <p className="text-lg font-black">真實商品示範暫時載入失敗。</p>
        <button
          onClick={() => { void productQuery.refetch(); void evaluationQuery.refetch(); }}
          className="self-start text-sm font-black underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          重新載入示範
        </button>
      </div>
    );
  }

  const product = productQuery.data;
  const evaluation = evaluationQuery.data;
  const action = evaluation.actionRecommendation;
  const tone = getActionTone(action.code);
  const findings = (evaluation.topReasons ?? []).filter(reason => reason.impact === 'negative').slice(0, 2);

  return (
    <article id="live-decision-demo" className={`bg-card border-2 ${tone.border} overflow-hidden`}>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
        <span className="text-[10px] font-black tracking-[0.18em] uppercase">真實商品・即時結論</span>
        <span className="text-[10px] font-bold text-muted-foreground">{getScopeLabel(evaluation.analysisScope)}</span>
      </div>

      <div className="p-5 flex items-start gap-4">
        <div className="w-20 h-20 bg-muted shrink-0 flex items-center justify-center p-2">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.nameZh || product.name} className="w-full h-full object-contain mix-blend-multiply" />
          ) : <Database className="w-7 h-7 text-muted-foreground/30" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-muted-foreground">{product.brandName || '品牌待確認'}</p>
          <h3 className="font-black text-base leading-snug mt-1">{product.nameZh || product.name}</h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-2">{product.barcode}</p>
        </div>
      </div>

      <div className={`${tone.panel} p-5`}>
        <p className="text-[10px] font-black tracking-[0.2em] uppercase opacity-70">現在怎麼做</p>
        <div className="flex items-center gap-3 mt-3">
          <span className="w-11 h-11 border-2 border-current flex items-center justify-center shrink-0" aria-hidden="true">
            {action.code === 'swap'
              ? <GitCompareArrows className="w-6 h-6" />
              : action.code === 'complete_data'
                ? <Camera className="w-6 h-6" />
                : <CheckCircle2 className="w-6 h-6" />}
          </span>
          <p className="text-4xl font-black tracking-[-0.05em] leading-none">{action.labelZh}</p>
        </div>
        <p className="text-xs font-bold leading-relaxed mt-4">{action.reasonZh}</p>
      </div>

      {findings.length > 0 && (
        <ul className="px-5 py-4 flex flex-col gap-2 border-b border-border">
          {findings.map((reason, index) => (
            <li key={index} className="text-xs font-bold leading-relaxed flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <span>{reason.labelZh || reason.label}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => {
          track('sample_report_viewed', { productId: WORSE_SAMPLE_PRODUCT_ID, source: 'hero_live_demo' });
          setLocation(`/report/${WORSE_SAMPLE_PRODUCT_ID}`);
        }}
        className="w-full min-h-14 px-5 flex items-center justify-between gap-3 text-sm font-black hover:bg-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span>打開完整報告，看證據來源</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </article>
  );
}

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
          <p className="text-[10px] font-bold text-red-900/60">公告日期：{new Date(alert.publishedAt).toLocaleDateString('zh-TW')}</p>
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
function ProductExampleCard({ productId }: { productId: number }) {
  const [, setLocation] = useLocation();
  const productQuery = useGetProduct(productId, { query: { staleTime: 10 * 60 * 1000 } as any });
  const evaluationQuery = useGetProductEvaluation(productId, undefined, { query: { staleTime: 10 * 60 * 1000 } as any });

  if (productQuery.isLoading || evaluationQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (productQuery.isError || evaluationQuery.isError || !productQuery.data || !evaluationQuery.data) {
    return (
      <div className="border-2 border-border bg-card p-5 flex flex-col gap-3">
        <AlertCircle className="w-5 h-5 text-destructive" />
        <p className="text-sm font-bold">這份真實範例暫時載入失敗。</p>
        <button
          onClick={() => { void productQuery.refetch(); void evaluationQuery.refetch(); }}
          className="text-xs font-bold underline text-left"
        >
          重新載入
        </button>
      </div>
    );
  }

  const product = productQuery.data;
  const evaluation = evaluationQuery.data;
  const scopeLabel = getScopeLabel(evaluation.analysisScope);
  const action = evaluation.actionRecommendation;
  const tone = getActionTone(action.code);
  const hasCompleteNumericScore = evaluation.analysisScope === 'complete';
  const findings = (evaluation.topReasons ?? []).filter(reason => reason.impact !== 'neutral').slice(0, 2);

  return (
    <article className={`bg-card border-2 ${tone.border} p-5 flex flex-col gap-4`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[10px] font-black tracking-widest px-2 py-1 ${tone.badge}`}>
          {action.labelZh}
        </span>
        <span className="text-[10px] font-bold text-muted-foreground">{scopeLabel}</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 bg-muted shrink-0 flex items-center justify-center p-1">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.nameZh || product.name} className="w-full h-full object-contain mix-blend-multiply" />
          ) : <Database className="w-5 h-5 text-muted-foreground/30" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-sm leading-snug">{product.nameZh || product.name}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{product.brandName || '品牌待確認'}</p>
        </div>
        <div className="text-right shrink-0">
          {hasCompleteNumericScore ? (
            <>
              <p className="text-4xl font-black font-mono leading-none">{evaluation.overallScore}</p>
              <p className="text-[9px] font-bold text-muted-foreground mt-1">完整分數</p>
            </>
          ) : (
            <>
              <p className="text-lg font-black leading-none">{scopeLabel}</p>
              <p className="text-[9px] font-bold text-muted-foreground mt-1">不當完整分數</p>
            </>
          )}
        </div>
      </div>
      <p className="text-sm font-black leading-relaxed border-l-4 border-border pl-3">
        {action.reasonZh}
      </p>
      {findings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {findings.map((reason, index) => (
            <li key={index} className="text-xs leading-relaxed flex items-start gap-2">
              {reason.impact === 'negative'
                ? <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                : <CheckCircle2 className="w-3.5 h-3.5 text-primary-strong shrink-0 mt-0.5" />}
              <span>{reason.labelZh || reason.label}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => { track('sample_report_viewed', { productId }); setLocation(`/report/${productId}`); }}
        className="mt-auto w-full py-3 border border-foreground font-bold text-xs hover:bg-foreground hover:text-background transition-colors"
      >
        看完整報告與證據
      </button>
    </article>
  );
}

function ProductComparison() {
  return (
    <section id="product-comparison" className="flex flex-col gap-5 scroll-mt-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">不硬湊一個漂亮分數</p>
        <h2 className="text-2xl font-black mt-2 leading-tight">同樣掃一下，FACTA 可能叫你先補資料，也可能直接叫你換一款。</h2>
        <p className="text-xs text-muted-foreground leading-relaxed mt-2">
          已確認的紅燈足以提醒行動；只有營養數字漂亮、成分證據卻不完整時，就停在「先補資料」。初評永遠不冒充完整安全結論。
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProductExampleCard productId={BETTER_SAMPLE_PRODUCT_ID} />
        <ProductExampleCard productId={WORSE_SAMPLE_PRODUCT_ID} />
      </div>
      <Link href="/methodology" className="text-xs font-bold underline">看完整判定規則與門檻 →</Link>
    </section>
  );
}

function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  const close = () => setOpen(false);

  return (
    <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b border-border" aria-label="首頁導覽">
      <div className="h-16 px-5 sm:px-6 md:px-10 lg:px-14 flex items-center justify-between gap-4">
        <a href="#top" onClick={close} className="flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="text-xl font-black tracking-tighter">FACTA</span>
          <span className="hidden sm:inline text-[9px] font-black px-2 py-1 bg-primary text-black tracking-widest">食品決策助手</span>
        </a>

        <div className="hidden md:flex items-center gap-6 text-xs font-black">
          <a href="#live-decision-demo" className="hover:text-primary-strong transition-colors">真實示範</a>
          <a href="#how-it-works" className="hover:text-primary-strong transition-colors">怎麼使用</a>
          <a href="#launch-challenge" className="hover:text-primary-strong transition-colors">Launch 挑戰</a>
          <Link href="/methodology" className="hover:text-primary-strong transition-colors">評分方法</Link>
          <Link href="/preferences" className="hover:text-primary-strong transition-colors">家庭設定</Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { track('hero_free_analysis_clicked', { source: 'landing_nav' }); setLocation('/scan'); }}
            className="min-h-10 px-4 bg-foreground text-background text-xs font-black flex items-center gap-2 hover:bg-foreground/90 transition-colors"
          >
            <ScanLine className="w-4 h-4" /> <span className="hidden sm:inline">現在掃一款</span><span className="sm:hidden">掃描</span>
          </button>
          <button
            type="button"
            aria-label={open ? '關閉選單' : '開啟選單'}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
            className="md:hidden w-10 h-10 border border-foreground flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden absolute top-full inset-x-0 bg-background border-b-2 border-foreground shadow-xl p-4 grid grid-cols-2 gap-2">
          <a href="#live-decision-demo" onClick={close} className="p-3 border border-border text-sm font-black">真實示範</a>
          <a href="#how-it-works" onClick={close} className="p-3 border border-border text-sm font-black">怎麼使用</a>
          <a href="#launch-challenge" onClick={close} className="p-3 border border-border text-sm font-black">Launch 挑戰</a>
          <Link href="/methodology" onClick={close} className="p-3 border border-border text-sm font-black">評分方法</Link>
          <Link href="/search" onClick={close} className="p-3 border border-border text-sm font-black">搜尋商品</Link>
          <Link href="/preferences" onClick={close} className="p-3 border border-border text-sm font-black">家庭設定</Link>
        </div>
      )}
    </nav>
  );
}

function LaunchChallenge() {
  const [, setLocation] = useLocation();

  return (
    <section id="launch-challenge" className="scroll-mt-20 bg-foreground text-background overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr]">
        <div className="p-6 md:p-8 flex flex-col gap-5">
          <span className="self-start bg-primary text-black px-2 py-1 text-[10px] font-black tracking-[0.18em]">FACTA LAUNCH CHALLENGE</span>
          <div>
            <p className="text-xs font-black text-primary tracking-[0.15em]">SCAN IT BEFORE YOU BUY IT</p>
            <h2 className="text-3xl md:text-4xl font-black tracking-[-0.04em] leading-[1.05] mt-3">你家最會演的，<br />可能是那包「看起來很健康」的食品。</h2>
            <p className="text-sm text-background/70 leading-relaxed mt-4 max-w-xl">掃一款最常買的商品，讓 FACTA 把包裝話術翻成一個行動。把最意外的結果分享出去，再指定一位朋友掃他家的那一包。</p>
          </div>

          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              ['01', '掃你最常買的一款'],
              ['02', '拿到買／少吃／換一款'],
              ['03', '分享卡片，點名下一位'],
            ].map(([number, label]) => (
              <li key={number} className="border border-background/25 p-3">
                <span className="font-mono text-[10px] text-primary">{number}</span>
                <p className="text-xs font-black leading-relaxed mt-2">{label}</p>
              </li>
            ))}
          </ol>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => { track('launch_challenge_started'); setLocation('/scan?source=launch_challenge'); }}
              className="min-h-14 px-5 bg-primary text-black font-black text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="w-5 h-5" /> 掃出我家最會演的一包
            </button>
            <button
              type="button"
              onClick={() => { track('launch_sample_shared', { productId: WORSE_SAMPLE_PRODUCT_ID }); setLocation(`/share/${WORSE_SAMPLE_PRODUCT_ID}`); }}
              className="min-h-14 px-5 border-2 border-background font-black text-sm flex items-center justify-center gap-2 hover:bg-background hover:text-foreground transition-colors"
            >
              <Share2 className="w-5 h-5" /> 看可分享的真實卡片
            </button>
          </div>
          <p className="text-[10px] text-background/50">建議標籤：#掃一下再買　#FACTAChallenge</p>
        </div>

        <div className="bg-primary text-black p-6 md:p-8 flex flex-col justify-between gap-8">
          <div>
            <p className="text-[10px] font-black tracking-[0.2em]">LAUNCH PROOF, NOT HYPE</p>
            <h3 className="text-2xl font-black leading-tight mt-3">首頁不放假數字。只放你今天真的能用的能力。</h3>
          </div>
          <dl className="grid grid-cols-1 gap-4">
            <div className="border-t-2 border-black pt-3">
              <dt className="text-3xl font-black font-mono">52,009</dt>
              <dd className="text-xs font-bold mt-1">筆來源候選已匯入；未驗證就不冒充推薦</dd>
            </div>
            <div className="border-t-2 border-black pt-3">
              <dt className="text-3xl font-black font-mono">3</dt>
              <dd className="text-xs font-bold mt-1">個你真正需要的答案：買、少吃、換一款</dd>
            </div>
            <div className="border-t-2 border-black pt-3">
              <dt className="text-3xl font-black font-mono">0</dt>
              <dd className="text-xs font-bold mt-1">品牌可以付費改動的分數</dd>
            </div>
          </dl>
        </div>
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
            <div className="flex items-center justify-between gap-3 mt-3">
              <Link href="/search" className="text-[11px] font-bold underline">看全部已驗證商品</Link>
              <Link href="/compare" className="text-[11px] font-bold flex items-center gap-1">
                <GitCompareArrows className="w-3.5 h-3.5" /> 比較已收藏
              </Link>
            </div>
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
    <Layout surface="landing">
      <div id="top" className="bg-background min-h-full">
        <LandingNavigation />
        <div className="px-5 sm:px-6 md:px-10 lg:px-14 pt-7 md:pt-9 pb-8 flex flex-col gap-12 md:gap-16">

        {/* 1. Hero */}
        <header className="flex flex-col gap-8">
          <div className="self-start flex items-center border border-foreground text-[10px] font-black tracking-[0.16em]">
            <span className="bg-foreground text-background px-2.5 py-1.5">LAUNCH WEEK</span>
            <a href="#launch-challenge" className="px-2.5 py-1.5 hover:bg-primary transition-colors">掃出你家最會演的一包 →</a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr] gap-8 md:gap-12 items-center">
            <div className="flex flex-col gap-4">
              <p className="text-xs font-black tracking-[0.16em] text-primary-strong">食品包裝會推銷，FACTA 只給你答案</p>
              <h2 className="text-[36px] sm:text-[42px] md:text-[52px] font-black leading-[1.04] tracking-[-0.05em]" aria-label="這包能不能買？掃一下，30 秒就知道。">
                <span className="block">這包能不能買？</span>
                <span className="block sm:hidden">掃一下，30 秒</span>
                <span className="block sm:hidden">就知道。</span>
                <span className="hidden sm:block">掃一下，30 秒就知道。</span>
              </h2>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-xl">
                掃描條碼，FACTA 會把營養、成分、過敏原與近期食安消息，翻成一個清楚行動：<strong className="text-foreground">買、少吃，或換一款。</strong>資料不夠，就直接說缺什麼。
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mt-2">
                <button
                  onClick={() => { track('hero_free_analysis_clicked'); setLocation('/scan'); }}
                  className="min-h-14 px-5 bg-foreground text-background font-black tracking-wider text-sm flex-1 flex items-center justify-center gap-3 hover:bg-foreground/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <ScanLine className="w-5 h-5" /> 掃描我手上的產品
                </button>
                <button
                  onClick={() => {
                    track('sample_report_viewed', { productId: WORSE_SAMPLE_PRODUCT_ID, source: 'hero_secondary_cta' });
                    setLocation(`/report/${WORSE_SAMPLE_PRODUCT_ID}`);
                  }}
                  className="min-h-14 px-5 border-2 border-foreground font-black tracking-wider text-sm flex-1 hover:bg-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  看一份真實報告
                </button>
              </div>

              <Link
                href="/search"
                className="self-start py-1 text-xs font-black underline underline-offset-4 flex items-center gap-2"
              >
                <Search className="w-4 h-4" /> 沒有條碼？用商品名稱找
              </Link>

              <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">
                免費試用・不用先註冊・品牌不能付費改分
              </p>

              <ul className="flex flex-col gap-1.5 mt-1">
                {['找不到資料就直說，不亂猜', '品牌事件和商品營養分開算', '每個結論都能回頭看來源'].map(p => (
                  <li key={p} className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                    <ShieldCheck className="w-3.5 h-3.5 text-primary-strong shrink-0" /> {p}
                  </li>
                ))}
              </ul>
            </div>

            <HeroDecisionDemo />
          </div>

          <section aria-labelledby="when-to-use-facta" className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">什麼時候最該用</p>
              <h2 id="when-to-use-facta" className="text-xl md:text-2xl font-black mt-2">不是每餐算分，而是在你要買下去的那一刻，少做一次後悔的決定。</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                '包裝寫高纖、無添加，糖或鈉卻未必比較低',
                '家人常吃同一款，想知道長期最該留意什麼',
                '品牌剛上新聞，不確定手上這一款有沒有被波及',
              ].map((scenario, index) => (
                <div key={scenario} className="flex items-start gap-3 bg-card border border-border p-4">
                  <span className="w-6 h-6 bg-foreground text-background text-[10px] font-black flex items-center justify-center shrink-0">{index + 1}</span>
                  <span className="text-sm font-bold leading-relaxed">{scenario}</span>
                </div>
              ))}
            </div>
          </section>

          <Link
            href="/preferences"
            className="p-5 bg-primary/10 border border-primary flex items-start gap-3 hover:bg-primary/20 transition-colors"
          >
            <Users className="w-5 h-5 text-primary-strong shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-black text-primary-strong">替自己和家人記住飲食限制</span>
              <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">過敏原、想避開的成分與日常習慣，下一份報告直接套用。</span>
            </span>
            <ArrowRight className="w-4 h-4 text-primary-strong shrink-0 ml-auto mt-0.5" />
          </Link>
        </header>

        {/* 2. Why this is needed */}
        <section className="bg-foreground text-background p-6 md:p-8 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 md:gap-6 items-start">
          <Scale className="w-7 h-7 text-primary" />
          <div>
            <h2 className="text-xl md:text-2xl font-black">你以為在比健康，其實常在比誰把「每份」切得更小。</h2>
            <p className="text-sm text-background/75 leading-relaxed mt-3 max-w-3xl">
              15g、30g、100ml 看起來都像「一份」，數字卻完全不能直接比。「無添加」「高纖」也不等於糖、鈉或飽和脂肪比較低。FACTA 先換成每 100g／ml，再把營養、成分證據和近期新聞一件一件拆開。
            </p>
          </div>
        </section>

        {/* 3. Real better/worse examples */}
        <ProductComparison />

        <p className="text-center text-sm md:text-base font-bold border-y border-border py-5">
          「包裝讓你想買；FACTA 先幫你看有沒有哪裡不對勁。」
        </p>

        {/* 4. How it works */}
        <section id="how-it-works" className="flex flex-col gap-4 scroll-mt-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">如何開始</p>
            <h2 className="text-2xl font-black mt-2">第一次不用研究，照這三步就好</h2>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { icon: ScanLine, title: '先掃條碼', desc: '先確認是哪一款；資料已驗證，就直接看報告。' },
              { icon: Camera, title: '不夠就拍背面', desc: '最好一張拍到營養標示和成分；分開印就補第二張。' },
              { icon: CheckCircle2, title: '先看最該擔心哪一項', desc: '糖、鈉、飽和脂肪會統一換算；缺資料就清楚說缺什麼。' },
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
          <button
            onClick={() => { track('hero_free_analysis_clicked', { source: 'how_it_works' }); setLocation('/scan'); }}
            className="w-full md:max-w-sm py-4 bg-primary text-black font-black tracking-widest text-sm hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
          >
            拿一款常買的，現在試試
          </button>
        </section>

        <LaunchChallenge />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {/* 5. How FACTA scores */}
          <section className="bg-card border border-border p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-strong" />
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">FACTA 如何評分</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              分數不是 AI 猜的。鏡頭只負責讀包裝文字；真正的比較依食藥署紅黃綠指引，把固體與液體分開、固定門檻計算。成分證據不夠，就不硬算添加物分數。
            </p>
            <Link href="/methodology" className="text-xs font-bold underline mt-auto">查看完整評分方法 →</Link>
          </section>

          {/* 6. Paid service */}
          <section className="bg-foreground text-background p-6 flex flex-col gap-3">
            <span className="self-start bg-primary text-black px-2 py-0.5 text-[10px] font-black tracking-widest">一次性服務</span>
            <h2 className="text-xl font-black leading-snug">FACTA 家庭食品健檢</h2>
            <p className="text-sm text-background/80 leading-relaxed">
              把家裡每天都在吃的 10 款一次翻底，先找出最值得換掉的那一款，再看成分、行銷話術與替代選擇。24 小時內完成報告。
            </p>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-black">NT$299</span>
              <span className="text-xs text-background/50 line-through mb-1">正式價 NT$499</span>
            </div>
            <Link
              href="/family-check"
              onClick={() => track('family_check_offer_viewed', { source: 'home_new_user' })}
              className="mt-auto w-full py-3.5 bg-primary text-black font-black tracking-widest text-sm text-center hover:bg-primary/90 transition-colors"
            >
              開始檢查家裡的食品
            </Link>
            <p className="text-[10px] text-background/60">若 24 小時內未完成報告，可申請退款。</p>
          </section>
        </div>

        {/* 7. Safety alert — compact collapsed notice */}
        <SafetyAlertNotice />

        {/* Onboarding CTA */}
        <Link href="/onboarding" className="p-5 bg-primary/10 border border-primary flex items-center justify-between hover:bg-primary/20 transition-colors group">
          <div className="flex items-center gap-3 text-primary-strong">
            <Target className="w-6 h-6 shrink-0" />
            <span className="font-bold text-sm">{t('set_goal_cta')}</span>
          </div>
          <ArrowRight className="w-5 h-5 text-primary-strong group-hover:translate-x-1 transition-transform shrink-0" />
        </Link>

        {/* 8. Privacy / independence / disclaimer */}
        <footer className="flex flex-col gap-2 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-5 pb-2">
          <p className="font-bold text-xs text-foreground">隱私與獨立性</p>
          <p>FACTA 不出售你的健康與掃描資料。用來辨識的原始照片不寫入 FACTA 商品資料庫；只保存你確認送出的商品文字與營養數值。評分由固定規則計算，不接受品牌付費改分。</p>
          <p>FACTA 提供的是食品資訊整理與比較，不是醫療診斷或治療建議。若有特殊健康狀況，請諮詢醫師或營養師。</p>
        </footer>

        </div>
      </div>
    </Layout>
  );
}
