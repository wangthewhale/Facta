import React from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { Link } from 'wouter';
import { ScanLine, Camera, ArrowRight, ShieldCheck, Database, Search } from 'lucide-react';
import { useGetDashboardStats, useGetScanHistory } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Skeleton } from '@/components/ui/skeleton';

export default function Home() {
  const { t, lang, setLang } = useTranslation();
  const sessionId = getSessionId();

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: history, isLoading: historyLoading } = useGetScanHistory({ user_session: sessionId, limit: 3 });

  return (
    <Layout>
      <div className="px-6 pt-12 pb-6 flex flex-col gap-10">
        
        {/* Header / Brand */}
        <header className="flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <h1 className="text-5xl font-bold tracking-tighter text-foreground">FACTA</h1>
            <button 
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              className="text-xs font-medium px-2 py-1 border border-border hover:bg-muted transition-colors uppercase tracking-widest"
            >
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
          </div>
          <div className="flex flex-col gap-1 mt-2 border-l-2 border-primary pl-4 py-1">
            <p className="text-sm font-semibold text-foreground tracking-wide">{t('tagline_zh')}</p>
            <p className="text-xs text-muted-foreground font-mono">{t('tagline_en')}</p>
          </div>
        </header>

        {/* Primary Actions */}
        <div className="flex flex-col gap-3">
          <Link href="/scan" className="group relative flex items-center justify-between p-6 bg-foreground text-background hover:bg-foreground/90 transition-colors">
            <div className="flex items-center gap-4">
              <div className="bg-background text-foreground p-3 rounded-none">
                <ScanLine className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg tracking-wide">{t('scan_product')}</span>
                <span className="text-xs text-background/70 font-mono opacity-80">BARCODE LOOKUP</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
          </Link>

          <Link href="/submit" className="group relative flex items-center justify-between p-6 border border-border bg-card hover:bg-accent transition-colors">
            <div className="flex items-center gap-4">
              <div className="bg-muted text-foreground p-3 rounded-none">
                <Camera className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-lg tracking-wide">{t('photo_ingredients')}</span>
                <span className="text-xs text-muted-foreground font-mono opacity-80">AI OCR ANALYSIS</span>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
          </Link>
        </div>

        {/* Trust Statement */}
        <div className="bg-primary/10 border border-primary p-5 flex flex-col gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <div>
            <p className="font-bold text-sm text-foreground">{t('trust_statement')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('campaign')}</p>
          </div>
        </div>

        {/* Dashboard Stats */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">{t('dashboard_stats')}</h2>
          </div>
          
          <div className="grid grid-cols-2 gap-px bg-border">
            <div className="bg-background p-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{t('products_verified')}</span>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <span className="text-2xl font-bold font-mono">{stats?.verifiedProducts || 0}</span>}
            </div>
            <div className="bg-background p-4 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{t('total_scans')}</span>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <span className="text-2xl font-bold font-mono">{stats?.totalScans || 0}</span>}
            </div>
          </div>
        </div>

        {/* Recent Scans */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">{t('recent_scans')}</h2>
            <Link href="/history" className="text-[10px] uppercase tracking-widest font-semibold hover:underline">View All</Link>
          </div>
          
          <div className="flex flex-col gap-px bg-border">
            {historyLoading ? (
              Array(2).fill(0).map((_, i) => (
                <div key={i} className="bg-background p-4 flex gap-4">
                  <Skeleton className="w-12 h-12" />
                  <div className="flex-1 flex flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : history && history.length > 0 ? (
              history.map((scan) => (
                <Link key={scan.id} href={`/report/${scan.productId}`} className="bg-background p-4 flex items-center gap-4 hover:bg-accent transition-colors">
                  {scan.imageUrl ? (
                    <img src={scan.imageUrl} alt="" className="w-12 h-12 object-cover bg-muted" />
                  ) : (
                    <div className="w-12 h-12 bg-muted flex items-center justify-center">
                      <Search className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 flex flex-col">
                    <span className="font-semibold text-sm line-clamp-1">{scan.productName || scan.barcode}</span>
                    <div className="flex items-center gap-2 mt-1">
                      {scan.productScore !== undefined && scan.productScore !== null && (
                        <span className="text-xs font-mono font-bold">{scan.productScore} / 100</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{new Date(scan.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="bg-background p-8 text-center text-sm text-muted-foreground">
                {t('no_history')}
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  );
}