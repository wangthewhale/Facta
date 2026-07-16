import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Layout } from '@/components/layout';
import { useGetProduct, useGetProductEvaluation, useGetAlternatives, useRecordScan } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Info, Link, Share, TriangleAlert, XOctagon } from 'lucide-react';
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
  if (grade === 'Excellent' || grade === 'Good') textColor = 'text-primary';
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

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();

  const productId = parseInt(id || '0');

  const { data: product, isLoading: productLoading } = useGetProduct(productId, {
    query: { enabled: !!productId }
  });
  
  const { data: evaluation, isLoading: evalLoading } = useGetProductEvaluation(productId, {
    query: { enabled: !!productId }
  });

  const { data: alternatives, isLoading: altLoading } = useGetAlternatives(productId, {
    query: { enabled: !!productId }
  });

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
                product.verificationStatus === 'verified' ? "border-primary text-primary" : "border-muted-foreground text-muted-foreground"
              )}>
                {product.verificationStatus === 'verified' ? t('verified') : t('provisional')}
              </span>
            </div>
            <button onClick={() => setLocation(`/share/${productId}`)} className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest">
              <Share className="w-4 h-4" /> {t('share_card')}
            </button>
          </div>
        </div>

        {/* Score Section */}
        <div className="p-10 flex flex-col items-center justify-center border-b border-border relative overflow-hidden">
          <p className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">{t('score')}</p>
          <AnimatedScore score={evaluation.overallScore} grade={evaluation.scoreGrade} />
          <div className="mt-4 flex flex-col items-center gap-2">
            <GradeBadge grade={evaluation.scoreGrade} className="px-4 py-1 text-xs" />
            <p className="text-center text-sm font-semibold max-w-[250px] mt-2">
              {lang === 'zh' && evaluation.verdictZh ? evaluation.verdictZh : evaluation.verdict}
            </p>
          </div>
        </div>

        {/* Evidence Sections */}
        <div className="flex flex-col">
          
          {/* Top Reasons */}
          {evaluation.topReasons && evaluation.topReasons.length > 0 && (
            <div className="p-6 border-b border-border bg-card/50">
              <h3 className="text-xs font-mono tracking-widest text-muted-foreground uppercase mb-4">Key Evidence</h3>
              <div className="flex flex-col gap-3">
                {evaluation.topReasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-background border border-border">
                    <div className="mt-0.5">
                      {reason.impact === 'positive' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      {reason.impact === 'negative' && <XOctagon className="w-4 h-4 text-destructive" />}
                      {reason.impact === 'neutral' && <Info className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {lang === 'zh' && reason.labelZh ? reason.labelZh : reason.label}
                      </p>
                      {reason.evidenceStrength && (
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1 border-t border-border pt-1">
                          Evidence: {reason.evidenceStrength}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additives & Allergens */}
          <div className="grid grid-cols-2 divide-x border-b border-border bg-background">
            <div className="p-4 flex flex-col items-center text-center">
              <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">{t('additives')}</span>
              <span className="text-2xl font-mono font-bold">{evaluation.additiveFlags?.length || 0}</span>
              {evaluation.additiveFlags && evaluation.additiveFlags.length > 0 && (
                <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Found
                </div>
              )}
            </div>
            <div className="p-4 flex flex-col items-center text-center">
              <span className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2">{t('allergens')}</span>
              <span className="text-2xl font-mono font-bold">{product.allergens?.length || 0}</span>
              {product.allergens && product.allergens.length > 0 && (
                <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                  <TriangleAlert className="w-3 h-3" /> Found
                </div>
              )}
            </div>
          </div>

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
                View All <ChevronRight className="w-3 h-3 ml-1" />
              </Link>
            </div>
            
            {altLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : alternatives && alternatives.length > 0 ? (
              <div className="flex flex-col gap-3">
                {alternatives.slice(0, 2).map((alt, i) => (
                  <Link key={i} href={`/report/${alt.product.id}`} className="flex items-center justify-between p-4 bg-background border border-border hover:border-primary transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center justify-center w-10 h-10 bg-primary/20 text-primary font-mono font-bold text-sm">
                        {alt.product.overallScore}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold line-clamp-1">{lang === 'zh' && alt.product.nameZh ? alt.product.nameZh : alt.product.name}</span>
                        <span className="text-[10px] text-muted-foreground mt-0.5">{lang === 'zh' && alt.whyBetterZh ? alt.whyBetterZh : alt.whyBetter}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
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
