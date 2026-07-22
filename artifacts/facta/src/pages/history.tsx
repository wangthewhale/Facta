import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '@/components/layout';
import { useGetScanHistory } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import { Link } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Bookmark, ChevronRight, GitCompareArrows, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  getSavedProducts,
  SavedProduct,
  subscribeToSavedProducts,
  toggleSavedProduct,
} from '@/lib/saved-products';

type HistoryTab = 'recent' | 'saved';

export default function History() {
  const sessionId = getSessionId();
  const [activeTab, setActiveTab] = useState<HistoryTab>('recent');
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>(() => getSavedProducts());
  const { data: history, isLoading } = useGetScanHistory({ user_session: sessionId, limit: 50 });

  useEffect(() => subscribeToSavedProducts(setSavedProducts), []);

  const recentProducts = useMemo(() => {
    const seen = new Set<number>();
    return (history || []).filter(scan => {
      if (!scan.productId || seen.has(scan.productId)) return false;
      seen.add(scan.productId);
      return true;
    });
  }, [history]);

  const removeSaved = (product: SavedProduct) => {
    toggleSavedProduct({
      id: product.id,
      name: product.name,
      brandName: product.brandName,
      imageUrl: product.imageUrl,
      overallScore: product.overallScore,
      scoreGrade: product.scoreGrade,
      analysisScope: product.analysisScope,
    });
  };

  return (
    <Layout>
      <div className="flex flex-col min-h-full">
        <div className="p-6 pb-0 bg-card border-b border-border sticky top-0 z-10">
          <h1 className="text-2xl font-black">你的食品紀錄</h1>
          <p className="text-xs text-muted-foreground mt-1">回頭看掃過的商品，或把準備買的先收藏比較。</p>
          <div className="grid grid-cols-2 mt-5" role="tablist" aria-label="食品紀錄分類">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'recent'}
              onClick={() => setActiveTab('recent')}
              className={`py-3 text-xs font-black border-b-4 ${activeTab === 'recent' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}
            >
              最近看過 {recentProducts.length > 0 ? `(${recentProducts.length})` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'saved'}
              onClick={() => setActiveTab('saved')}
              className={`py-3 text-xs font-black border-b-4 ${activeTab === 'saved' ? 'border-primary-strong text-primary-strong' : 'border-transparent text-muted-foreground'}`}
            >
              已收藏 {savedProducts.length > 0 ? `(${savedProducts.length})` : ''}
            </button>
          </div>
        </div>

        <div className="flex-1 bg-background">
          {activeTab === 'recent' && (
            isLoading ? (
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
            ) : recentProducts.length > 0 ? (
              <div className="flex flex-col divide-y divide-border">
                {recentProducts.map(scan => (
                  <Link key={scan.id} href={`/report/${scan.productId}`} className="p-4 flex items-center gap-4 hover:bg-accent transition-colors group">
                    {scan.imageUrl ? (
                      <img src={scan.imageUrl} alt={scan.productName || '商品'} className="w-12 h-12 object-contain bg-muted mix-blend-multiply" />
                    ) : (
                      <div className="w-12 h-12 bg-muted flex items-center justify-center text-muted-foreground">
                        <Search className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 flex flex-col justify-center min-w-0">
                      <h2 className="font-bold text-sm line-clamp-1">{scan.productName || scan.barcode || '商品名稱待確認'}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        {scan.productScore !== undefined && scan.productScore !== null && (
                          <span className="px-1.5 py-0.5 bg-foreground text-background text-[10px] font-mono font-bold">
                            {scan.productScore}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground tracking-wider font-mono">
                          {format(new Date(scan.createdAt), 'MM/dd HH:mm')}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-72 gap-4 text-center px-8">
                <Search className="w-10 h-10 text-muted-foreground opacity-50" />
                <div>
                  <p className="font-black">還沒有看過任何商品</p>
                  <p className="text-xs text-muted-foreground mt-1">先拿一款常買的食品，掃完就會留在這裡。</p>
                </div>
                <Link href="/scan" className="mt-2 px-6 py-3 bg-foreground text-background font-black text-xs">開始掃描</Link>
              </div>
            )
          )}

          {activeTab === 'saved' && (
            savedProducts.length > 0 ? (
              <div className="flex flex-col">
                <div className="p-4 bg-primary/10 border-b border-primary flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black">收藏只保存在這台裝置</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">跨裝置同步會在帳號登入完成後開放。</p>
                  </div>
                  <Link href="/compare" className="px-3 py-2 bg-foreground text-background text-xs font-black flex items-center gap-1.5 shrink-0">
                    <GitCompareArrows className="w-3.5 h-3.5" /> 比較
                  </Link>
                </div>
                <div className="flex flex-col divide-y divide-border">
                  {savedProducts.map(product => (
                    <div key={product.id} className="p-4 flex items-center gap-4 bg-card">
                      <Link href={`/report/${product.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} className="w-12 h-12 object-contain bg-muted mix-blend-multiply" />
                        ) : (
                          <div className="w-12 h-12 bg-muted flex items-center justify-center text-muted-foreground">
                            <Bookmark className="w-5 h-5" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm line-clamp-2">{product.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{product.brandName || '品牌待確認'}</p>
                        </div>
                        {product.overallScore != null && (
                          <span className="w-9 h-9 bg-primary/10 text-primary-strong font-mono font-black text-sm flex items-center justify-center shrink-0">
                            {product.overallScore}
                          </span>
                        )}
                      </Link>
                      <button
                        type="button"
                        aria-label={`移除 ${product.name}`}
                        onClick={() => removeSaved(product)}
                        className="p-3 text-muted-foreground hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-72 gap-4 text-center px-8">
                <Bookmark className="w-10 h-10 text-muted-foreground opacity-50" />
                <div>
                  <p className="font-black">還沒有收藏商品</p>
                  <p className="text-xs text-muted-foreground mt-1">看到準備買或常吃的商品，先收藏，下次不用重新找。</p>
                </div>
                <Link href="/search" className="mt-2 px-6 py-3 bg-primary text-black font-black text-xs">找商品</Link>
              </div>
            )
          )}
        </div>
      </div>
    </Layout>
  );
}
