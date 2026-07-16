import React, { useEffect, useState } from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { useGetPreferences, useSavePreferences } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const ALLERGEN_OPTIONS = [
  { id: 'milk', label: 'Milk', labelZh: '乳' },
  { id: 'egg', label: 'Egg', labelZh: '蛋' },
  { id: 'peanut', label: 'Peanut', labelZh: '花生' },
  { id: 'treenut', label: 'Tree Nuts', labelZh: '堅果' },
  { id: 'sesame', label: 'Sesame', labelZh: '芝麻' },
  { id: 'soy', label: 'Soy', labelZh: '大豆' },
  { id: 'wheat', label: 'Wheat', labelZh: '小麥' },
  { id: 'fish', label: 'Fish', labelZh: '魚' },
  { id: 'shellfish', label: 'Shellfish', labelZh: '甲殼類' },
];

const DIETARY_OPTIONS = [
  { id: 'vegan', label: 'Vegan', labelZh: '純素' },
  { id: 'vegetarian', label: 'Ovo-Lacto Veg', labelZh: '蛋奶素' },
  { id: 'halal', label: 'Halal', labelZh: '清真' },
  { id: 'kosher', label: 'Kosher', labelZh: '猶太潔食' },
];

export default function Preferences() {
  const { t, lang, setLang } = useTranslation();
  const sessionId = getSessionId();
  const { toast } = useToast();

  const { data: prefData, isLoading } = useGetPreferences(sessionId, {
    query: { enabled: !!sessionId } as any
  });

  const savePrefMut = useSavePreferences();

  const [allergens, setAllergens] = useState<string[]>([]);
  const [dietary, setDietary] = useState<string[]>([]);
  const [localLang, setLocalLang] = useState(lang);

  useEffect(() => {
    if (prefData) {
      setAllergens(prefData.allergens || []);
      setDietary(prefData.dietaryPreferences || []);
      if (prefData.locale) {
        setLocalLang(prefData.locale as 'zh' | 'en');
        setLang(prefData.locale as 'zh' | 'en');
      }
    }
  }, [prefData, setLang]);

  const toggleAllergen = (id: string) => {
    setAllergens(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleDietary = (id: string) => {
    setDietary(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    try {
      await savePrefMut.mutateAsync({
        sessionId,
        data: {
          allergens,
          dietaryPreferences: dietary,
          locale: localLang
        }
      });
      setLang(localLang);
      toast({
        title: 'Preferences saved',
        description: 'Your personal alerts will be updated.',
      });
    } catch (e) {
      toast({
        title: 'Error saving',
        variant: 'destructive'
      });
    }
  };

  const OptionBtn = ({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) => (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-3 border-2 flex items-center justify-between text-sm font-bold transition-all",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:border-muted-foreground"
      )}
    >
      {label}
      {active && <Check className="w-4 h-4" />}
    </button>
  );

  return (
    <Layout>
      <div className="flex flex-col min-h-full pb-20 bg-card">
        <div className="p-6 pb-4 bg-background border-b border-border sticky top-0 z-10">
          <h1 className="text-2xl font-bold">{t('preferences')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            We use these to generate personal alerts on reports. This does not change the core FACTA Score.
          </p>
        </div>

        <div className="p-6 flex flex-col gap-8 flex-1">
          {/* Language */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono tracking-widest uppercase text-muted-foreground">Language</h3>
            <div className="grid grid-cols-2 gap-2">
              <OptionBtn 
                active={localLang === 'zh'} 
                onClick={() => setLocalLang('zh')} 
                label="中文 (繁體)" 
              />
              <OptionBtn 
                active={localLang === 'en'} 
                onClick={() => setLocalLang('en')} 
                label="English" 
              />
            </div>
          </div>

          {/* Allergens */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono tracking-widest uppercase text-muted-foreground">{t('allergens')}</h3>
            <div className="grid grid-cols-2 gap-2">
              {ALLERGEN_OPTIONS.map(opt => (
                <OptionBtn 
                  key={opt.id}
                  active={allergens.includes(opt.id)}
                  onClick={() => toggleAllergen(opt.id)}
                  label={localLang === 'zh' ? opt.labelZh : opt.label}
                />
              ))}
            </div>
          </div>

          {/* Dietary */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono tracking-widest uppercase text-muted-foreground">{t('dietary')}</h3>
            <div className="grid grid-cols-2 gap-2">
              {DIETARY_OPTIONS.map(opt => (
                <OptionBtn 
                  key={opt.id}
                  active={dietary.includes(opt.id)}
                  onClick={() => toggleDietary(opt.id)}
                  label={localLang === 'zh' ? opt.labelZh : opt.label}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 pt-0 mt-auto">
          <button 
            onClick={handleSave}
            disabled={savePrefMut.isPending}
            className="w-full py-4 bg-primary text-primary-foreground font-bold uppercase tracking-widest disabled:opacity-50"
          >
            {savePrefMut.isPending ? '...' : t('save_preferences')}
          </button>
        </div>

      </div>
    </Layout>
  );
}