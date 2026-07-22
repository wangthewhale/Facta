import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Layout } from '@/components/layout';
import { useGetProduct, useGetProductEvaluation, useGetAlternatives, useRecordScan, useGetUserGoals, useGetGoalFit, useGetProductNews, useGetProductSafetyCheck } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Droplets, Info, Link as LinkIcon, Share, TriangleAlert, XOctagon, RefreshCw } from 'lucide-react';
import { track } from '@/lib/analytics';
import { startFamilyCheckCheckout } from '@/pages/familyCheck';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { getSessionId } from '@/lib/session';

export function GradeBadge({ grade, className }: { grade: string, className?: string }) {
  const { t, lang } = useTranslation();
  let color = 'bg-muted text-muted-foreground';
  let text = grade;
  
  if (grade === 'Excellent') {
    color = 'bg-primary text-primary-foreground';
    text = t('grade_excellent');
  } else if (grade === 'Good') {
    color = 'bg-primary/80 text-primary-foreground';
    text = t('grade_good');
  } else if (grade === 'Consider') {
    color = 'bg-[#F2B84B] text-black';
    text = t('grade_consider');
  } else if (grade === 'Poor') {
    color = 'bg-destructive text-destructive-foreground';
    text = t('grade_poor');
  }

  return (
    <span className={cn("px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase", color, className)}>
      {text}
    </span>
  );
}

function AnimatedScore({ score, grade }: { score: number, grade: string }) {
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const duration = 1000;
    
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayScore(Math.floor(easeProgress * score));
      
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    
    window.requestAnimationFrame(step);
  }, [score]);

  let textColor = 'text-foreground';
  if (grade === 'Excellent' || grade === 'Good') textColor = 'text-primary-strong';
  if (grade === 'Consider') textColor = 'text-[#F2B84B]';
  if (grade === 'Poor') textColor = 'text-destructive';

  return (
    <div className="flex flex-col items-center justify-center">
      <div className={cn("text-8xl font-black tracking-tighter leading-none font-mono", textColor)}>
        {displayScore}
      </div>
    </div>
  );
}

function SafetyAlertSection({ productId }: { productId: number }) {
  const { lang } = useTranslation();
  const { data } = useGetProductSafetyCheck(productId, { query: { staleTime: 10 * 60 * 1000 } as any });

  if (!data?.affected || !data.matches?.length) return null;

  return (
    <section className="px-6 py-5 bg-red-50 border-y-4 border-red-600">
      {data.matches.map((m, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="bg-red-600 text-white px-2 py-0.5 text-[10px] font-black tracking-widest uppercase">
              {lang === 'zh' ? '政府食安警報' : 'GOV FOOD SAFETY ALERT'}
            </span>
          </div>
          <h3 className="font-black text-red-700 text-sm leading-snug">
            {lang === 'zh' ? m.alert.titleZh : m.alert.title}
          </h3>
          <p className="text-xs text-red-900/90 leading-relaxed">
            {lang === 'zh' ? m.alert.summaryZh : m.alert.summary}
          </p>
          <p className="text-xs font-bold text-red-800">
            {lang === 'zh'
              ? `此品牌／業者「${m.matchedBusiness}」名列食藥署公布的受影響業者名單`
              : `This brand/business "${m.matchedBusiness}" appears on the TFDA affected-business list`}
            {m.productExamples.length > 0 && (
              <span className="font-normal">
                {lang === 'zh' ? '（受波及產品例：' : ' (affected examples: '}
                {m.productExamples.join('、')}
                {lang === 'zh' ? '）' : ')'}
              </span>
            )}
          </p>
          {m.alert.officialUrl && (
            <a
              href={m.alert.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline font-bold text-red-700"
            >
              {lang === 'zh' ? '查看食藥署官方完整下架名單 →' : 'View full official TFDA recall list →'}
            </a>
          )}
          <p className="text-[10px] text-red-900/60">
            {lang === 'zh'
              ? '注意：此為品牌／業者層級比對，實際受影響品項以食藥署公告為準。'
              : 'Note: matched at brand/business level; refer to the official TFDA list for exact affected items.'}
          </p>
        </div>
      ))}
    </section>
  );
}

function NewsSection({ productId }: { productId: number }) {
  const { lang } = useTranslation();
  const { data: news, isLoading, isError, isFetching, refetch } = useGetProductNews(productId, { query: { staleTime: 5 * 60 * 1000 } as any });

  if (isLoading) {
    return (
      <div className="p-6 border-b border-border bg-card/50">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">
          {lang === 'zh' ? '最新品牌與食安消息' : 'Latest brand & safety news'}
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          {lang === 'zh' ? '正在查找商品、品牌與公司層級消息…' : 'Searching product, brand and company coverage…'}
        </div>
      </div>
    );
  }

  if (news?.status === 'identity_unverified') {
    return (
      <div className="p-6 border-b border-border bg-card/50 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
          {lang === 'zh' ? '最新品牌與食安消息' : 'Latest brand & safety news'}
        </h3>
        <div className="border border-[#D9A21B] bg-[#F2B84B]/10 p-4">
          <p className="text-sm font-bold">{lang === 'zh' ? '先確認是哪一款，才不會把新聞套錯商品' : 'Verify the exact product before matching news'}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {lang === 'zh'
              ? '這款商品的品牌或條碼資料還沒驗證完成，因此暫不顯示新聞結果。補拍包裝背面後再查會更可靠。'
              : 'Brand or barcode evidence is incomplete, so news matching is paused until the package is confirmed.'}
          </p>
        </div>
      </div>
    );
  }

  if (isError || !news || news.status === 'unavailable') {
    return (
      <div className="p-6 border-b border-border bg-card/50 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
          {lang === 'zh' ? '最新品牌與食安消息' : 'Latest brand & safety news'}
        </h3>
        <div className="border border-border bg-background p-4">
          <p className="text-sm font-bold">{lang === 'zh' ? '新聞查詢暫時無法使用' : 'News lookup is temporarily unavailable'}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {lang === 'zh' ? '這不代表沒有相關消息；目前無法完成即時查核。' : 'This does not mean no news exists; the live check could not be completed.'}
          </p>
          <button onClick={() => void refetch()} disabled={isFetching} className="mt-3 text-xs font-bold underline flex items-center gap-1 disabled:opacity-50">
            <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
            {lang === 'zh' ? '重新查詢' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (news.status === 'no_results') {
    return (
      <div className="p-6 border-b border-border bg-card/50 flex flex-col gap-3">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
          {lang === 'zh' ? '最新品牌與食安消息' : 'Latest brand & safety news'}
        </h3>
        <div className="border border-border bg-background p-4">
          <p className="text-sm font-bold">{lang === 'zh' ? `近 ${news.lookbackDays} 天未找到可驗證的相關報導` : `No verifiable coverage found in the past ${news.lookbackDays} days`}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {lang === 'zh' ? '這不是安全保證，只代表本次搜尋沒有找到足夠可靠的結果。' : 'This is not a safety guarantee; the search did not find sufficiently reliable results.'}
          </p>
        </div>
        {news.fetchedAt && <p className="text-[10px] text-muted-foreground">查核日期：{new Date(news.fetchedAt).toLocaleDateString('zh-TW')}</p>}
      </div>
    );
  }

  const sentimentStyle =
    news.sentiment === 'negative' ? 'bg-destructive text-destructive-foreground' :
    news.sentiment === 'positive' ? 'bg-primary text-primary-foreground' :
    'bg-[#F2B84B] text-black';
  const sentimentLabel = lang === 'zh'
    ? (news.sentiment === 'negative' ? '負面新聞' : news.sentiment === 'positive' ? '正面新聞' : news.sentiment === 'mixed' ? '正負皆有' : '中立')
    : news.sentiment.toUpperCase();

  return (
    <div className="p-6 border-b border-border bg-card/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase">
          {lang === 'zh' ? '最新品牌與食安消息' : 'Latest brand & safety news'}
        </h3>
        <span className={cn('px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase', sentimentStyle)}>
          {sentimentLabel}
        </span>
      </div>
      {(news.summaryZh || news.summary) && (
        <p className="text-sm mb-3">
          {lang === 'zh' && news.summaryZh ? news.summaryZh : news.summary}
        </p>
      )}
      {news.articles.length > 0 && (
        <div className="flex flex-col gap-2">
          {news.articles.map((a, i) => {
            const rt = a.reportType ?? 'unknown';
            const rtLabel = lang === 'zh'
              ? (rt === 'news' ? '獨立報導' : rt === 'official_record' ? '官方紀錄' : rt === 'advertorial' ? '廣編/業配' : rt === 'press_release' ? '新聞稿' : '來源不明')
              : (rt === 'news' ? 'Journalism' : rt === 'official_record' ? 'Official' : rt === 'advertorial' ? 'Sponsored' : rt === 'press_release' ? 'Press release' : 'Unverified');
            const rtStyle = rt === 'news' || rt === 'official_record'
              ? 'bg-primary-strong text-white'
              : rt === 'advertorial'
              ? 'bg-[#F2B84B] text-black'
              : 'bg-muted text-muted-foreground';
            const scopeLabel = lang === 'zh'
              ? (a.scope === 'product' ? '商品層級' : a.scope === 'company' ? '公司層級' : '品牌層級')
              : a.scope;
            const content = (
              <>
                <LinkIcon className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium leading-relaxed">{a.title}</span>
                  <span className="block text-[10px] text-muted-foreground mt-1">
                    {[a.sourceName, a.publishedAt ? new Date(`${a.publishedAt}T00:00:00`).toLocaleDateString('zh-TW') : null, scopeLabel].filter(Boolean).join(' · ')}
                  </span>
                  {a.affectsProduct === false && (
                    <span className="block text-[10px] text-muted-foreground mt-1">目前來源指向同品牌其他品項，未指向本商品。</span>
                  )}
                  {a.affectsProduct === true && (
                    <span className="block text-[10px] text-destructive font-bold mt-1">來源明確指出本商品受影響。</span>
                  )}
                </span>
                <span className={cn('shrink-0 px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase', rtStyle)}>{rtLabel}</span>
              </>
            );
            return a.url ? (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-3 bg-background border border-border text-xs hover:border-foreground"
              >
                {content}
              </a>
            ) : (
              <div key={i} className="flex items-start gap-2 p-3 bg-background border border-border text-xs">{content}</div>
            );
          })}
        </div>
      )}
      {news.articles.some(a => a.reportType === 'advertorial' || a.reportType === 'press_release') && (
        <p className="text-[10px] text-muted-foreground mt-2">
          {lang === 'zh'
            ? '標示「廣編/業配」或「新聞稿」的內容非獨立報導，不計入情緒判定。'
            : 'Items marked Sponsored or Press release are not independent journalism and do not affect the sentiment rating.'}
        </p>
      )}
      {news.fetchedAt && (
        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1 text-[10px] text-muted-foreground">
          <p>查核日期：{new Date(news.fetchedAt).toLocaleDateString('zh-TW')} · 範圍：近 {news.lookbackDays} 天</p>
          <p>查詢：{news.query}</p>
          {news.status === 'stale' && <p className="font-bold text-[#9A6700]">即時搜尋失敗，目前顯示較舊快取。</p>}
          <p>新聞不納入 FACTA 數字評分，避免把品牌事件混成商品營養分數。</p>
        </div>
      )}
    </div>
  );
}

function GoalFitSection({ productId, activeGoals }: { productId: number, activeGoals: any[] }) {
  const { t, lang } = useTranslation();
  const [, setLocation] = useLocation();

  if (!activeGoals || activeGoals.length === 0) {
    return (
      <div className="p-6 border-b border-border bg-card">
        <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">{t('goal_fit')}</h3>
        <div className="bg-muted border border-border border-dashed p-4 flex items-center justify-between hover:bg-accent transition-colors cursor-pointer group" onClick={() => setLocation('/onboarding')}>
          <span className="text-sm font-bold text-muted-foreground group-hover:text-foreground">{t('set_goals_prompt')}</span>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 border-b border-border bg-card">
      <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">{t('goal_fit')}</h3>
      <div className="flex flex-col gap-4">
        {activeGoals.map(goal => (
          <GoalFitCard key={goal.slug} productId={productId} goal={goal} />
        ))}
      </div>
    </div>
  );
}

function GoalFitCard({ productId, goal }: { productId: number, goal: any }) {
  const { lang, t } = useTranslation();
  const { data: fit, isLoading } = useGetGoalFit(productId, goal.slug);

  const fitColors: Record<string, string> = {
    great_fit: '#B9F24A',
    good_fit: '#B9F24A', 
    mixed_fit: '#F2B84B',
    poor_fit: '#E45145',
    insufficient_data: '#9CA3AF',
  };

  const fitLabels: Record<string, string> = {
    great_fit: t('fit_great'),
    good_fit: t('fit_good'),
    mixed_fit: t('fit_mixed'),
    poor_fit: t('fit_poor'),
    insufficient_data: t('fit_insufficient'),
  };

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!fit) return null;

  return (
    <div className="border border-border bg-background p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">{lang === 'zh' && goal.nameZh ? goal.nameZh : goal.name}</span>
        <span 
          className="px-2 py-0.5 text-[10px] font-bold tracking-widest text-black whitespace-nowrap"
          style={{ backgroundColor: fitColors[fit.fitLevel] || fitColors.insufficient_data, opacity: fit.fitLevel === 'good_fit' ? 0.7 : 1 }}
        >
          {fitLabels[fit.fitLevel]}
        </span>
      </div>

      {fit.fitLevel !== 'insufficient_data' ? (
        <>
          {fit.fitReasons && fit.fitReasons.length > 0 && (
            <ul className="flex flex-col gap-1 mt-1">
              {fit.fitReasons.slice(0, 2).map((r, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary-strong shrink-0 mt-0.5" />
                  <span className="leading-snug">{lang === 'zh' && r.labelZh ? r.labelZh : r.label}</span>
                </li>
              ))}
            </ul>
          )}
          {fit.warnings && fit.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 mt-2 pt-2 border-t border-border border-dashed">
              {fit.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                  <XOctagon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="leading-snug font-medium">{lang === 'zh' && w.labelZh ? w.labelZh : w.label}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const productId = parseInt(id || '0');

  const { data: product, isLoading: productLoading } = useGetProduct(productId, {
    query: { enabled: !!productId } as any
  });
  
  const { data: evaluation, isLoading: evalLoading } = useGetProductEvaluation(productId, {
    query: { enabled: !!productId } as any
  });

  const { data: alternatives, isLoading: altLoading } = useGetAlternatives(productId, {
    query: { enabled: !!productId } as any
  });

  const { data: userGoalsData } = useGetUserGoals(sessionId);
  const activeGoals = userGoalsData?.activeGoals || [];

  const recordScanMutation = useRecordScan();

  useEffect(() => {
    if (product) {
      recordScanMutation.mutate({
        data: {
          eventType: 'report_viewed',
          productId: product.id,
          barcode: product.barcode,
          userSession: sessionId
        }
      });
    }
  }, [product?.id]);

  if (productLoading || evalLoading) {
    return (
      <Layout>
        <div className="p-6 space-y-8 animate-pulse">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-48 w-full" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!product || !evaluation) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <p className="mt-20">Report not found.</p>
        </div>
      </Layout>
    );
  }

  const name = lang === 'zh' && product.nameZh ? product.nameZh : product.name;
  const brand = product.brandName;
  const analysisScope = evaluation.analysisScope;
  const isWaterAnalysis = analysisScope === 'water';
  const hasNumericRating = analysisScope !== 'insufficient' && !isWaterAnalysis;
  const hasCompletedEvidence = analysisScope === 'complete' || isWaterAnalysis;
  const scoreTitle = analysisScope === 'complete' ? 'FACTA 完整評分' :
    analysisScope === 'nutrition_only' ? '營養初評' :
    analysisScope === 'ingredients_only' ? '成分初評' :
    isWaterAnalysis ? '飲用水分析' : '分析狀態';
  const scopeExplanation = analysisScope === 'complete'
    ? '營養與成分證據皆達到目前規則的計分門檻。'
    : analysisScope === 'nutrition_only'
      ? '已完成營養比較；成分與過敏原證據仍未完整，這不是完整安全結論。'
      : analysisScope === 'ingredients_only'
        ? '已完成成分初評；缺少足夠營養標示，這不是完整產品結論。'
        : isWaterAnalysis
          ? '飲用水依法可能免營養標示；FACTA 改看配方是否單純、pH 宣稱的界線，以及官方抽驗與近期消息。'
        : '缺少可公平比較的每份量／營養資料，或成分證據尚未達到門檻，因此不判定好壞。';

  return (
    <Layout>
      <div className="flex flex-col pb-10">
        
        {/* Header Image & Basic Info */}
        <div className="relative pt-8 px-6 pb-6 bg-card border-b border-border">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase">{brand || 'UNKNOWN BRAND'}</p>
              <h1 className="text-2xl font-bold leading-tight mt-1">{name}</h1>
              {product.barcode && <p className="text-xs text-muted-foreground font-mono mt-2">{product.barcode}</p>}
            </div>
            {product.imageUrl && (
              <img src={product.imageUrl} alt={name} className="w-20 h-20 object-contain mix-blend-multiply" />
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                "px-2 py-1 text-[10px] uppercase tracking-widest font-bold border",
                product.verificationStatus === 'verified' ? "border-primary text-primary-strong" : "border-muted-foreground text-muted-foreground"
              )}>
                {product.verificationStatus === 'verified' ? t('verified') : t('provisional')}
              </span>
              {product.catalogSourceUrl && (
                <a href={product.catalogSourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold underline text-muted-foreground">
                  對照商品與標示來源
                </a>
              )}
            </div>
            <button onClick={() => setLocation(`/share/${productId}`)} className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest">
              <Share className="w-4 h-4" /> {t('share_card')}
            </button>
          </div>
          {product.barcodeSourceUrl && product.barcodeSourceUrl !== product.catalogSourceUrl && (
            <a href={product.barcodeSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-[10px] font-bold underline text-muted-foreground">
              對照條碼來源
            </a>
          )}
        </div>

        {/* Score Section */}
        <div className="p-10 flex flex-col items-center justify-center border-b border-border relative overflow-hidden">
          <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">{scoreTitle}</p>
          {isWaterAnalysis ? (
            <div className="flex flex-col items-center text-center gap-3">
              <Droplets className="w-12 h-12 text-primary-strong" aria-hidden="true" />
              <p className="text-3xl font-black tracking-tight text-primary-strong">適合日常補水</p>
              <p className="text-xs font-bold text-muted-foreground">配方單純，但不把 pH 宣稱當成保健功效</p>
            </div>
          ) : hasNumericRating ? (
            <AnimatedScore score={evaluation.overallScore} grade={evaluation.scoreGrade} />
          ) : (
            <p className="text-4xl font-black tracking-tight text-muted-foreground">資料不足</p>
          )}
          <div className="mt-4 flex flex-col items-center gap-2">
            {hasNumericRating && <GradeBadge grade={evaluation.scoreGrade} className="px-4 py-1 text-xs" />}
            <p className="text-center text-sm font-semibold max-w-[250px] mt-2">
              {lang === 'zh' && evaluation.verdictZh ? evaluation.verdictZh : evaluation.verdict}
            </p>
          </div>
        </div>

        <div className={cn(
          'mx-6 my-5 p-4 border flex items-start gap-3',
          hasCompletedEvidence ? 'border-primary-strong bg-primary/10' : 'border-[#D9A21B] bg-[#F2B84B]/10'
        )}>
          {hasCompletedEvidence
            ? <CheckCircle2 className="w-5 h-5 text-primary-strong shrink-0" />
            : <AlertTriangle className="w-5 h-5 text-[#9A6700] shrink-0" />}
          <div>
            <p className="text-xs font-black">{scoreTitle}</p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{scopeExplanation}</p>
          </div>
        </div>

        {/* Evidence Sections */}
        <div className="flex flex-col">
          
          {/* Top Reasons */}
          {evaluation.topReasons && evaluation.topReasons.length > 0 && (
            <div className="p-6 border-b border-border bg-card/50">
              <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">關鍵證據</h3>
              <div className="flex flex-col gap-3">
                {evaluation.topReasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-background border border-border">
                    <div className="mt-0.5">
                      {reason.impact === 'positive' && <CheckCircle2 className="w-4 h-4 text-primary-strong" />}
                      {reason.impact === 'negative' && <XOctagon className="w-4 h-4 text-destructive" />}
                      {reason.impact === 'neutral' && <Info className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {lang === 'zh' && reason.labelZh ? reason.labelZh : reason.label}
                      </p>
                      <div className="text-[10px] text-muted-foreground mt-1 border-t border-border pt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {reason.evidenceStrength && <span>證據強度：{reason.evidenceStrength}</span>}
                        {reason.source && /^https?:\/\//.test(reason.source) ? (
                          <a href={reason.source} target="_blank" rel="noopener noreferrer" className="underline font-bold">查看判定來源</a>
                        ) : reason.source ? <span>來源：{reason.source}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goal Fit */}
          <SafetyAlertSection productId={productId} />

          {isWaterAnalysis ? (
            <section className="p-6 border-b border-border bg-background">
              <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-3">和你的目標有什麼關係</h3>
              <p className="text-sm font-semibold leading-relaxed">
                用無糖飲用水取代含糖飲料，可以少喝進額外的糖；但只喝這瓶水不會直接帶來減脂、增肌或其他療效。
              </p>
            </section>
          ) : (
            <GoalFitSection productId={productId} activeGoals={activeGoals} />
          )}

          {/* Brand News Intelligence */}
          <NewsSection productId={productId} />

          {/* Additives & Allergens */}
          {isWaterAnalysis ? (
            <div className="grid grid-cols-2 divide-x border-b border-border bg-background">
              <div className="p-4 flex flex-col items-center text-center">
                <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">配方</span>
                <span className="text-xl font-mono font-bold text-primary-strong">單純</span>
                <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">成分僅見水類來源，未見糖、甜味劑或香料</p>
              </div>
              <div className="p-4 flex flex-col items-center text-center">
                <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">營養標示</span>
                <span className="text-xl font-mono font-bold">可免</span>
                <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">無營養宣稱的飲用水依法可免標示</p>
              </div>
            </div>
          ) : (
          <div className="grid grid-cols-2 divide-x border-b border-border bg-background">
            <div className="p-4 flex flex-col items-center text-center">
              <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">{t('additives')}</span>
              <span className="text-xl font-mono font-bold">{evaluation.additiveScore == null ? '未完成' : evaluation.additiveFlags?.length || 0}</span>
              {evaluation.additiveScore == null && <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">成分證據尚未完成足夠比例對照</p>}
              {evaluation.additiveScore != null && evaluation.additiveFlags && evaluation.additiveFlags.length > 0 && (
                <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> 需留意
                </div>
              )}
            </div>
            <div className="p-4 flex flex-col items-center text-center">
              <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">{t('allergens')}</span>
              <span className="text-xl font-mono font-bold">{evaluation.allergenAlerts?.length ? evaluation.allergenAlerts.length : '未標記'}</span>
              {!evaluation.allergenAlerts?.length && <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">不代表沒有過敏原，食用前仍須看實體標示</p>}
              {evaluation.allergenAlerts && evaluation.allergenAlerts.length > 0 && (
                <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                  <TriangleAlert className="w-3 h-3" /> 已標記
                </div>
              )}
            </div>
          </div>
          )}

          {/* Personal Alerts */}
          {evaluation.personalAlerts && evaluation.personalAlerts.length > 0 && (
            <div className="p-6 border-b border-border bg-[#F2B84B]/10">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-[#F2B84B]" />
                <h3 className="text-xs font-mono tracking-widest uppercase text-[#F2B84B] font-bold">{t('personal_alerts')}</h3>
              </div>
              <div className="flex flex-col gap-2">
                {evaluation.personalAlerts.map((alert, i) => (
                  <p key={i} className="text-sm font-semibold">
                    {lang === 'zh' && alert.messageZh ? alert.messageZh : alert.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Better Alternatives */}
          <div className="p-6 bg-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase">{t('better_alternatives')}</h3>
              <Link href={`/alternatives/${productId}`} className="text-[10px] uppercase font-bold tracking-widest hover:underline flex items-center">
                查看全部 <ChevronRight className="w-3 h-3 ml-1" />
              </Link>
            </div>
            
            {altLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : alternatives && alternatives.length > 0 ? (
              <div className="flex flex-col gap-3">
                {alternatives.slice(0, 2).map((alt, i) => (
                  <Link key={i} href={`/report/${alt.product.id}`} className="flex items-center justify-between p-4 bg-background border border-border hover:border-primary transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center justify-center w-10 h-10 bg-primary/20 text-primary-strong font-mono font-bold text-sm">
                        {alt.product.overallScore}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold line-clamp-1">{lang === 'zh' && alt.product.nameZh ? alt.product.nameZh : alt.product.name}</span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">{lang === 'zh' && alt.whyBetterZh ? alt.whyBetterZh : alt.whyBetter}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary-strong transition-colors" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-4 border border-border border-dashed text-center text-sm text-muted-foreground">
                {t('no_alternatives')}
              </div>
            )}
          </div>
        </div>

        {/* Post-analysis conversion block */}
        {(() => {
          const attentionCount =
            (evaluation.topReasons?.filter(r => r.impact === 'negative').length || 0) +
            (evaluation.personalAlerts?.length || 0);
          const incomplete = evaluation.analysisScope !== 'complete';
          return (
            <div className="mx-6 mt-6 bg-foreground text-background p-6 flex flex-col gap-3">
              <p className="font-black text-base leading-snug">
                {incomplete
                  ? '這次分析仍有資料未完成，先不要把初評當成安全保證。'
                  : attentionCount > 0
                  ? `這次分析發現 ${attentionCount} 項需要注意的地方。`
                  : '這款商品沒有明顯需要注意的地方。'}
                {' '}家裡其他常吃的食品呢？
              </p>
              <p className="text-xs text-background/75 leading-relaxed">
                FACTA 家庭食品健檢：一次檢查 10 項常吃食品，找出需要注意的成分與更適合的替代品，24 小時內完成。
              </p>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-black">NT$299</span>
                <span className="text-xs text-background/50 line-through mb-1">正式價 NT$499</span>
              </div>
              <button
                onClick={() => {
                  // Go straight to checkout when configured; otherwise show service details
                  if (!startFamilyCheckCheckout('report_bottom')) {
                    setLocation('/family-check');
                  }
                }}
                className="w-full py-3.5 bg-primary text-black font-black tracking-widest text-sm text-center hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-background"
              >
                開始檢查家裡的食品
              </button>
              <Link href="/family-check" onClick={() => track('family_check_offer_viewed', { source: 'report_bottom' })} className="text-[10px] underline text-background/70 text-center">
                查看服務詳情
              </Link>
              <p className="text-[10px] text-background/60">若 24 小時內未完成報告，可申請退款。</p>
            </div>
          );
        })()}

        {/* Health disclaimer */}
        <p className="mx-6 mt-4 text-[10px] text-muted-foreground leading-relaxed">
          FACTA 提供的是食品資訊整理與比較，不是醫療診斷或治療建議。若有特殊健康狀況，請諮詢醫師或營養師。
        </p>

        {/* Footer info */}
        <div className="p-6 flex flex-col items-center justify-center gap-2 mt-4 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Ruleset: {evaluation.rulesetVersion}
          </p>
          <button className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground underline underline-offset-4 mt-2">
            {t('report_error')}
          </button>
        </div>

      </div>
    </Layout>
  );
}
