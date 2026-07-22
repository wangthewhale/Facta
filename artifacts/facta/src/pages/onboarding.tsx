import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from '@/lib/i18n';
import { useListGoals, useSetUserGoals, useSavePreferences, useSaveUserProfile } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { ArrowLeft, Target, CheckCircle2, Store, Clock, ArrowRight, UserRound } from 'lucide-react';
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
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [personalizationConsent, setPersonalizationConsent] = useState(false);

  // Mutations
  const setGoalsMut = useSetUserGoals();
  const saveProfileMut = useSaveUserProfile();
  const savePreferencesMut = useSavePreferences();

  const RETAILERS = ['7-ELEVEN', '全家', '全聯', '家樂福', 'Costco'];
  const ALLERGENS = [
    { id: 'milk', label: '乳' }, { id: 'egg', label: '蛋' }, { id: 'peanut', label: '花生' },
    { id: 'treenut', label: '堅果' }, { id: 'sesame', label: '芝麻' }, { id: 'soy', label: '大豆' },
    { id: 'wheat', label: '小麥／麩質' }, { id: 'fish', label: '魚' }, { id: 'shellfish', label: '甲殼類' },
  ];
  const DIETS = [
    { id: 'vegan', label: '純素' }, { id: 'vegetarian', label: '蛋奶素' },
    { id: 'halal', label: '清真' }, { id: 'kosher', label: '猶太潔食' },
  ];

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

    const hasFoodProfile = Boolean(displayName.trim() || email.trim() || selectedAllergens.length || selectedDiet);
    if (hasFoodProfile && personalizationConsent) {
      await savePreferencesMut.mutateAsync({
        sessionId,
        data: {
          displayName: displayName.trim() || null,
          email: email.trim().toLowerCase() || null,
          allergens: selectedAllergens,
          dietaryPreferences: selectedDiet ? [selectedDiet] : [],
          avoidIngredients: [],
          habits: [],
          notes: null,
          householdMembers: [],
          personalizationEnabled: true,
          locale: lang,
        },
      });
    }

    // Save profile / preferences
    await saveProfileMut.mutateAsync({
      sessionId,
      data: {
        onboardingCompletedAt: new Date().toISOString(),
        preferredRetailers: selectedRetailers,
        wantsMealTiming: timingChoice,
      }
    });

    setLocation('/');
  };

  const nextStep = () => setStep(s => Math.min(4, s + 1));
  const prevStep = () => setStep(s => Math.max(1, s - 1));
  const validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const hasFoodProfile = Boolean(displayName.trim() || email.trim() || selectedAllergens.length || selectedDiet);
  const canContinueProfile = validEmail && (!hasFoodProfile || personalizationConsent);

  const skipFoodProfile = () => {
    setDisplayName('');
    setEmail('');
    setSelectedAllergens([]);
    setSelectedDiet('');
    setPersonalizationConsent(false);
    nextStep();
  };

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
                繼續 <ArrowRight className="w-4 h-4" />
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
                繼續
              </button>
              <button onClick={nextStep} className="text-xs text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest py-2">
                先略過
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col h-full p-6">
            <UserRound className="w-8 h-8 text-primary-strong mb-6" />
            <h1 className="text-3xl font-bold leading-tight mb-2 tracking-tight">這份提醒先替誰看？</h1>
            <p className="text-sm text-muted-foreground mb-6">填完後，FACTA 會把最新限制帶進每份報告。之後可在「設定」新增家人。</p>

            <div className="flex flex-col gap-6 mb-auto overflow-y-auto">
              <div className="grid grid-cols-1 gap-4">
                <label>
                  <span className="text-xs font-bold">姓名或稱呼（選填）</span>
                  <input
                    value={displayName}
                    onChange={event => setDisplayName(event.target.value.slice(0, 80))}
                    placeholder="例如：小安"
                    autoComplete="name"
                    className="mt-2 w-full h-12 px-4 border border-border bg-card focus:border-foreground outline-none text-sm"
                  />
                </label>
                <label>
                  <span className="text-xs font-bold">Email（選填）</span>
                  <input
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value.slice(0, 254))}
                    placeholder="name@example.com"
                    autoComplete="email"
                    aria-invalid={!validEmail}
                    className={cn('mt-2 w-full h-12 px-4 border bg-card outline-none text-sm', validEmail ? 'border-border focus:border-foreground' : 'border-destructive')}
                  />
                  {!validEmail && <span className="block text-xs text-destructive mt-1">請輸入有效的 Email</span>}
                </label>
              </div>

              <div>
                <p className="text-xs font-bold tracking-widest text-muted-foreground mb-3">過敏原</p>
                <div className="flex flex-wrap gap-2">
                  {ALLERGENS.map(a => (
                    <button
                      key={a.id}
                      onClick={() => toggleAllergen(a.id)}
                      className={cn(
                        "px-4 py-2 border text-sm font-medium transition-all",
                        selectedAllergens.includes(a.id) ? "border-destructive bg-destructive/10 text-destructive font-bold" : "border-border bg-card hover:bg-muted"
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold tracking-widest text-muted-foreground mb-3">飲食方式</p>
                <div className="grid grid-cols-2 gap-2">
                  {DIETS.map(d => (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDiet(d.id === selectedDiet ? '' : d.id)}
                      className={cn(
                        "px-4 py-3 border text-sm font-medium transition-all text-center",
                        selectedDiet === d.id ? "border-primary bg-primary text-primary-foreground font-bold" : "border-border bg-card hover:bg-muted"
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className={cn('border p-4 flex items-start gap-3', hasFoodProfile && !personalizationConsent ? 'border-destructive bg-destructive/5' : 'border-border bg-muted/40')}>
                <input
                  type="checkbox"
                  checked={personalizationConsent}
                  onChange={event => setPersonalizationConsent(event.target.checked)}
                  className="mt-0.5 w-5 h-5 accent-black shrink-0"
                />
                <span>
                  <span className="block text-sm font-bold">同意儲存並套用以上資料</span>
                  <span className="block text-[10px] text-muted-foreground mt-1 leading-relaxed">可隨時在設定修改或刪除；不改變商品客觀分數。</span>
                </span>
              </label>
            </div>

            <div className="mt-8 flex flex-col gap-4 shrink-0">
              <button 
                onClick={nextStep}
                disabled={!canContinueProfile}
                className="w-full py-4 font-bold uppercase tracking-widest text-sm bg-foreground text-background hover:bg-foreground/90 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
              >
                繼續
              </button>
              <button onClick={skipFoodProfile} className="text-xs text-muted-foreground hover:text-foreground font-bold uppercase tracking-widest py-2">
                先略過
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
