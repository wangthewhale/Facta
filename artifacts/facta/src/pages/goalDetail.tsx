import React, { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Layout } from '@/components/layout';
import { useGetGoal, useListGuides, useListCollections } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import { ArrowLeft, Target, ShieldCheck, ArrowRight, BookOpen, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { getSessionId } from '@/lib/session';

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

export default function GoalDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { t, lang } = useTranslation();

  const [activeMeal, setActiveMeal] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>(getCurrentMealType());

  const { data: goal, isLoading } = useGetGoal(slug || '', { query: { enabled: !!slug } as any });
  const { data: guides, isLoading: guidesLoading } = useListGuides({ goal_slug: slug });
  const { data: collections, isLoading: collectionsLoading } = useListCollections({ goal_slug: slug });

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 space-y-8 animate-pulse">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-48 w-full" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!goal) {
    return (
      <Layout>
        <div className="p-6 text-center mt-20">Goal not found.</div>
      </Layout>
    );
  }

  const mealContext = goal.mealContexts?.find(m => m.meal === activeMeal);
  const goalCollections = collections?.filter(c => c.mealType === activeMeal || !c.mealType) || [];

  return (
    <Layout>
      <div className="flex flex-col pb-10 bg-background">
        
        {/* Header */}
        <div className="pt-8 px-6 pb-8 bg-card border-b border-border">
          <button onClick={() => window.history.back()} className="mb-6 flex items-center text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </button>
          
          <Target className="w-8 h-8 text-primary-strong mb-4" />
          <h1 className="text-3xl font-bold leading-tight mb-3">
            {lang === 'zh' && goal.nameZh ? goal.nameZh : goal.name}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {lang === 'zh' && goal.descriptionZh ? goal.descriptionZh : goal.description}
          </p>
        </div>

        {/* Meal Timing Intelligence */}
        {mealContext && (
          <div className="border-b border-border bg-foreground text-background">
            
            <div className="flex overflow-x-auto no-scrollbar border-b border-background/20 px-2">
              {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setActiveMeal(m)}
                  className={cn(
                    "px-4 py-4 text-xs font-bold uppercase tracking-widest whitespace-nowrap transition-colors",
                    activeMeal === m ? "text-primary-strong border-b-2 border-primary" : "text-background/50 hover:text-background"
                  )}
                >
                  {mealLabels[m]}
                </button>
              ))}
            </div>

            <div className="p-6 flex flex-col gap-6">
              <div className="flex items-center gap-2 text-primary-strong">
                <Clock className="w-5 h-5" />
                <h2 className="font-bold text-lg">{lang === 'zh' && mealContext.headlineZh ? mealContext.headlineZh : mealContext.headline}</h2>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background/10 p-4 flex flex-col gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">{t('choose_more')}</p>
                  <ul className="text-sm flex flex-col gap-1.5">
                    {(mealContext.chooseMore || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-primary-strong mt-0.5">•</span>
                        <span className="leading-snug">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-background/10 p-4 flex flex-col gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#F2B84B]/80">{t('choose_less')}</p>
                  <ul className="text-sm flex flex-col gap-1.5">
                    {(mealContext.chooseLess || []).map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-[#F2B84B] mt-0.5">•</span>
                        <span className="leading-snug">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {mealContext.ctaText && (
                <button 
                  onClick={() => setLocation(`/search?goal_slug=${goal.slug}&meal_type=${activeMeal}`)}
                  className="w-full py-3 border border-primary text-primary-strong font-bold text-sm uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-all flex items-center justify-center gap-2"
                >
                  {mealContext.ctaText} <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Collections for this goal + meal */}
        {goalCollections.length > 0 && (
          <div className="p-6 border-b border-border bg-card">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Recommended for {mealLabels[activeMeal]}</h3>
            <div className="flex flex-col gap-4">
              {goalCollections.map(col => (
                <div key={col.slug} className="border border-border p-4 bg-background hover:border-primary transition-colors cursor-pointer flex justify-between items-center group">
                  <div className="flex flex-col gap-1">
                    <p className="font-bold text-sm group-hover:text-primary-strong transition-colors">{lang === 'zh' && col.nameZh ? col.nameZh : col.name}</p>
                    <p className="text-xs text-muted-foreground">{col.productCount} products</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary-strong transition-colors" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Methodology / Signals */}
        <div className="p-6 border-b border-border bg-background">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> FACTA Evaluation Rules
          </h3>
          
          <div className="space-y-6">
            <div>
              <p className="font-bold text-sm mb-2 border-l-2 border-primary pl-3">FACTA 評估這個目標時看什麼</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {(['protein', 'fiber', 'sugar', 'sodium', 'calories', 'saturated fat'] as const).map((n, i) => (
                  <span key={i} className="px-2 py-1 bg-primary/10 text-primary-strong text-xs font-bold">{n}</span>
                ))}
              </div>
            </div>

            <div>
              <p className="font-bold text-sm mb-2 border-l-2 border-muted-foreground pl-3 text-muted-foreground">FACTA 目前看不到或不能判斷什麼</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                我們依據食品標示的公開資訊分析。個人體質、過敏反應與醫療需求無法完全反映在分數中。
              </p>
            </div>
          </div>
        </div>

        {/* Guides */}
        {!guidesLoading && guides && guides.length > 0 && (
          <div className="p-6 bg-card border-b border-border">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
              <BookOpen className="w-4 h-4" /> Related Guides
            </h3>
            <div className="flex flex-col gap-3">
              {guides.map(guide => (
                <div key={guide.slug} className="p-4 border border-border bg-background hover:bg-muted transition-colors cursor-pointer group">
                  <p className="font-bold text-sm group-hover:text-primary-strong transition-colors">{lang === 'zh' && guide.titleZh ? guide.titleZh : guide.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{lang === 'zh' && guide.summaryZh ? guide.summaryZh : guide.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="p-6 bg-background">
          <div className="bg-muted p-4 flex gap-3 text-muted-foreground border border-border">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-xs leading-relaxed">
              {t('goal_limit_statement')}
            </p>
          </div>
        </div>

      </div>
    </Layout>
  );
}
