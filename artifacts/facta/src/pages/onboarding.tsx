import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from '@/lib/i18n';
import { useListGoals, useSetUserGoals, useSaveUserProfile } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { ArrowLeft, Target, CheckCircle2, Store, WheatOff, Clock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { t, lang } = useTranslation();
  const sessionId = getSessionId();

  const [step, setStep] = useState(1);
  
  // Data fetch
  const { data: goals, isLoading: goalsLoading } = useListGoals({ status: 'active' });

  // State
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>([]);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [selectedDiet, setSelectedDiet] = useState<string>('');
  const [mealTiming, setMealTiming] = useState<boolean | null>(null);

  // Mutations
  const setGoalsMut = useSetUserGoals();
  const saveProfileMut = useSaveUserProfile();

  const RETAILERS = ['7-ELEVEN', '全家', '全聯', '家樂福', 'Costco'];
  const ALLERGENS = ['乳', '蛋', '花生', '堅果', '芝麻', '大豆', '小麥', '魚', '甲殼類'];
  const DIETS = ['純素', '蛋奶素', '清真', '猶太潔食'];

  const toggleGoal = (id: string) => {
    if (selectedGoals.includes(id)) {
      setSelectedGoals(selectedGoals.filter(g => g !== id));
    } else if (selectedGoals.length < 2) {
      setSelectedGoals([...selectedGoals, id]);
    }
  };

  const toggleRetailer = (r: string) => {
    if (selectedRetailers.includes(r)) setSelectedRetailers(selectedRetailers.filter(x => x !== r));
    else setSelectedRetailers([...selectedRetailers, r]);
  };

  const toggleAllergen = (a: string) => {
    if (selectedAllergens.includes(a)) setSelectedAllergens(selectedAllergens.filter(x => x !== a));
    else setSelectedAllergens([...selectedAllergens, a]);
  };

  const handleComplete = async (timingChoice: boolean) => {
    setMealTiming(timingChoice);
    
    // Save goals
    if (selectedGoals.length > 0) {
      const goalsToSave = selectedGoals.map((id, index) => {
        const goal = goals?.find(g => g.slug === id);
        return { goalId: goal?.id || 0, priority: index === 0 ? 'primary' : 'secondary' };
      }).filter(g => g.goalId !== 0);
      
      await setGoalsMut.mutateAsync({
        sessionId,
        data: { goals: goalsToSave }
      });
    }

    // Save profile / preferences
    await saveProfileMut.mutateAsync({
      sessionId,
      data: {
        onboardingCompletedAt: new Date().toISOString(),
        preferredRetailers: selectedRetailers,
        wantsMealTiming: mealTiming === true,
      }
    });

    setLocation('/');
  };

  const nextStep = () => setStep(s => Math.min(4, s + 1));
  const prevStep = () => setStep(s => Math.max(1, s - 1));

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      
      {/* Header */}
      <header className="flex items-center px-4 h-16 border-b border-border shrink-0">
        <button onClick={step === 1 ? () => setLocation('/') : prevStep} className="p-2 -ml-2 text-foreground hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map(s => (
              <div key={s} className={cn("h-1 w-8 transition-colors", s <= step ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
        </div>
        <div className="w-9" /> {/* Spacer */}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        
        {step === 1 && (
          <div className="flex flex-col h-full">
            <div className="p-6 pb-2 shrink-0">
              <Target className="w-8 h-8 text-primary-strong mb-6" />
              <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight">{t('onboarding_title')}</h1>
              <p className="text-sm text-muted-foreground mb-8">選擇 1-2 個目標，FACTA 將根據目標為你篩選推薦。</p>
            </div>
            
            <div className="px-6 flex flex-col gap-3 flex-1 overflow-y-auto pb-6">
              {goalsLoading ? (
                Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : goals ? (
                goals.map(goal => {
                  const isSelected = selectedGoals.includes(goal.slug);
                  const isComingSoon = goal.status === 'coming_soon';
                  
                  return (
                    <button
                      key={goal.id}
                      onClick={() => !isComingSoon && toggleGoal(goal.slug)}
                      disabled={isComingSoon}
                      className={cn(
                        "text-left p-5 border transition-all relative flex flex-col gap-1",
                        isComingSoon ? "opacity-50 border-border bg-muted cursor-not-allowed" : 
                        isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50",
                      )}
                    >
                      <div className="flex items-start justify-between w-full">
                        <span className={cn("font-bold text-lg", isSelected && "text-primary-strong")}>
                          {lang === 'zh' && goal.nameZh ? goal.nameZh : goal.name}
                        </span>
                        {isSelected && <CheckCircle2 className="w-5 h-5 text-primary-strong shrink-0" />}
                        {isComingSoon && <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground px-2 py-0.5 border border-border">Coming Soon</span>}
                      </div>
                      <span className="text-xs text-muted-foreground leading-relaxed mt-1">
                        {lang === 'zh' && goal.descriptionZh ? goal.descriptionZh : goal.description}
                      </span>
                    </button>
                  );
                })
              ) : null}
            </div>

            <div className="p-6 bg-card border-t border-border mt-auto shrink-0 flex flex-col gap-4">
              <div className="text-[10px] text-muted-foreground bg-muted p-3 border border-border leading-relaxed">
                <p className="font-bold mb-1 uppercase tracking-widest">{t('goal_disclaimer')}</p>
                <p>{t('goal_limit_statement')}</p>
              </div>
              <button 
                onClick={nextStep}
                disabled={selectedGoals.length === 0}
                className={cn(
                  "w-full py-4 font-bold uppercase tracking-widest text-sm transition-all flex items-center justify-center gap-2",
                  selectedGoals.length > 0 ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col h-full p-6">
            <Store className="w-8 h-8 text-primary-strong mb-6" />
            <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight">{t('preferred_retailers')}</h1>
            <p className="text-sm text-muted-foreground mb-8">選擇你常去的通路，方便我們優先顯示那裡的商品。</p>

            <div className="grid grid-cols-2 gap-3 mb-auto">
              {RETAILERS.map(r => (
                <button
                  key={r}
                  onClick={() => toggleRetailer(r)}
                  className={cn(
                    "p-4 border text-sm font-bold transition-all text-center",
                    selectedRetailers.includes(r) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-4">
              <button 
                onClick={nextStep}
                className="w-full py-4 font-bold uppercase tracking-widest text-sm bg-foreground text-background hover:bg-foreground/90 transition-all flex items-center justify-center gap-2"
              >
                Continue
              </button>
              <button onClick={nextStep} className="text-xs text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest py-2">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col h-full p-6">
            <WheatOff className="w-8 h-8 text-primary-strong mb-6" />
            <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight">{t('allergens_dietary')}</h1>
            <p className="text-sm text-muted-foreground mb-8">FACTA 會在分析報告中特別標示這些成分。</p>

            <div className="flex flex-col gap-6 mb-auto overflow-y-auto">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Allergens</p>
                <div className="flex flex-wrap gap-2">
                  {ALLERGENS.map(a => (
                    <button
                      key={a}
                      onClick={() => toggleAllergen(a)}
                      className={cn(
                        "px-4 py-2 border text-sm font-medium transition-all",
                        selectedAllergens.includes(a) ? "border-destructive bg-destructive/10 text-destructive font-bold" : "border-border bg-card hover:bg-muted"
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Dietary</p>
                <div className="grid grid-cols-2 gap-2">
                  {DIETS.map(d => (
                    <button
                      key={d}
                      onClick={() => setSelectedDiet(d === selectedDiet ? '' : d)}
                      className={cn(
                        "px-4 py-3 border text-sm font-medium transition-all text-center",
                        selectedDiet === d ? "border-primary bg-primary text-primary-foreground font-bold" : "border-border bg-card hover:bg-muted"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4 shrink-0">
              <button 
                onClick={nextStep}
                className="w-full py-4 font-bold uppercase tracking-widest text-sm bg-foreground text-background hover:bg-foreground/90 transition-all flex items-center justify-center gap-2"
              >
                Continue
              </button>
              <button onClick={nextStep} className="text-xs text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest py-2">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col h-full p-6">
            <Clock className="w-8 h-8 text-primary-strong mb-6" />
            <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight">{t('meal_timing_q')}</h1>
            <p className="text-sm text-muted-foreground mb-8">開啟後，FACTA 會根據早中晚餐時段，微調該時段的建議。例如：晚上減少高咖啡因推薦。</p>

            <div className="flex flex-col gap-4 mb-auto">
              <button 
                onClick={() => handleComplete(true)}
                className="w-full p-6 border border-primary bg-primary text-primary-foreground font-bold text-lg transition-all hover:bg-primary/90 text-left flex items-center justify-between"
              >
                <span>是，依餐次建議</span>
                <CheckCircle2 className="w-6 h-6" />
              </button>

              <button 
                onClick={() => handleComplete(false)}
                className="w-full p-6 border border-border bg-card text-foreground font-bold text-lg transition-all hover:bg-muted text-left"
              >
                暫時不要
              </button>
            </div>

          </div>
        )}

      </main>
    </div>
  );
}
