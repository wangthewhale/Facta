import React from 'react';
import { Layout } from '@/components/layout';
import { useTranslation } from '@/lib/i18n';
import { useGetScanHistory } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Link } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function History() {
  const { t, lang } = useTranslation();
  const sessionId = getSessionId();

  const { data: history, isLoading } = useGetScanHistory({ user_session: sessionId, limit: 50 });

  return (
    <Layout>
      <div className="flex flex-col min-h-full">
        <div className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <h1 className="text-2xl font-bold">{t('history')}</h1>
        </div>

        <div className="flex-1 bg-background">
          {isLoading ? (
            <div className="flex flex-col divide-y divide-border">
              {Array(5).fill(0).map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-4">
                  <Skeleton className="w-12 h-12" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : history && history.length > 0 ? (
            <div className="flex flex-col divide-y divide-border">
              {history.map((scan) => (
                <Link key={scan.id} href={scan.productId ? `/report/${scan.productId}` : '#'} className="p-4 flex items-center gap-4 hover:bg-accent transition-colors group">
                  {scan.imageUrl ? (
                    <img src={scan.imageUrl} alt="" className="w-12 h-12 object-cover bg-muted mix-blend-multiply" />
                  ) : (
                    <div className="w-12 h-12 bg-muted flex items-center justify-center text-muted-foreground">
                      <Search className="w-5 h-5" />
                    </div>
                  )}
                  
                  <div className="flex-1 flex flex-col justify-center">
                    <h3 className="font-bold text-sm line-clamp-1">{scan.productName || scan.barcode || 'Unknown Product'}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {scan.productScore !== undefined && scan.productScore !== null && (
                        <span className="px-1.5 py-0.5 bg-foreground text-background text-[10px] font-mono font-bold">
                          {scan.productScore}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground tracking-wider font-mono">
                        {format(new Date(scan.createdAt), 'MMM dd, HH:mm')}
                      </span>
                    </div>
                  </div>

                  {scan.productId && (
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <Search className="w-10 h-10 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground text-sm font-medium">{t('no_history')}</p>
              <Link href="/scan" className="mt-2 px-6 py-2 border-2 border-foreground font-bold text-xs uppercase tracking-widest">
                {t('scan_now')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}