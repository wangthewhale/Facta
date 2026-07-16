import React from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { ShieldCheck, Scale, Database, AlertCircle } from 'lucide-react';

export default function Methodology() {
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="flex flex-col min-h-full bg-background text-foreground pb-20">
        
        {/* Header */}
        <div className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <h1 className="text-2xl font-bold">Methodology</h1>
          <p className="text-sm text-muted-foreground mt-1 tracking-wide">
            How FACTA evaluates products.
          </p>
        </div>

        <div className="flex flex-col">
          
          {/* Independence */}
          <div className="p-8 border-b border-border bg-primary/5 flex flex-col gap-4">
            <ShieldCheck className="w-8 h-8 text-primary" />
            <h2 className="text-xl font-bold uppercase tracking-widest">{t('trust_statement')}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              FACTA operates independently. We do not accept payment from food brands to improve scores, alter rankings, or remove negative evidence. Our revenue model does not rely on brand partnerships.
            </p>
          </div>

          {/* Scoring System */}
          <div className="p-8 border-b border-border flex flex-col gap-4">
            <Scale className="w-8 h-8 text-foreground" />
            <h2 className="text-xl font-bold uppercase tracking-widest">Scoring System</h2>
            <p className="text-sm leading-relaxed mb-2">
              The FACTA Score (0-100) is calculated using a proprietary rule engine that analyzes nutritional density against additive risk. 
            </p>
            <ul className="text-sm space-y-3 font-mono bg-card p-4 border border-border">
              <li className="flex items-center justify-between">
                <span className="text-primary font-bold">80-100</span>
                <span>Excellent</span>
              </li>
              <li className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-primary opacity-80 font-bold">60-79</span>
                <span>Good</span>
              </li>
              <li className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-[#F2B84B] font-bold">40-59</span>
                <span>Consider</span>
              </li>
              <li className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-destructive font-bold">0-39</span>
                <span>Poor</span>
              </li>
            </ul>
          </div>

          {/* AI vs Rule Engine */}
          <div className="p-8 border-b border-border flex flex-col gap-4">
            <Database className="w-8 h-8 text-foreground" />
            <h2 className="text-xl font-bold uppercase tracking-widest">AI & Data Pipeline</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We use Large Language Models (LLMs) strictly for data extraction (OCR) and semantic normalization (e.g., standardizing "High Fructose Corn Syrup" and "HFCS" into a single entity). 
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong>Crucially:</strong> AI does not calculate the score. All scoring is performed by a deterministic rule engine to ensure 100% reproducibility and transparency.
            </p>
          </div>

          {/* Evidence Tiers */}
          <div className="p-8 border-b border-border flex flex-col gap-4">
            <AlertCircle className="w-8 h-8 text-foreground" />
            <h2 className="text-xl font-bold uppercase tracking-widest">Evidence Tiers</h2>
            <p className="text-sm leading-relaxed">
              Every penalty or additive flag is backed by evidence from authoritative bodies (e.g., WHO, EFSA, FDA, TFDA). Evidence is tiered by confidence level, ensuring penalties are proportional to the scientific consensus.
            </p>
          </div>

          {/* Disclaimer */}
          <div className="p-8 bg-foreground text-background flex flex-col gap-4 mt-8">
            <h2 className="text-sm font-bold uppercase tracking-widest">Medical Disclaimer</h2>
            <p className="text-xs leading-relaxed opacity-80">
              FACTA is an informational tool, not a medical device. Product formulations change without notice. Always read the physical label before consuming, especially if you have severe allergies. We do not provide dietary or medical advice.
            </p>
          </div>

        </div>
      </div>
    </Layout>
  );
}