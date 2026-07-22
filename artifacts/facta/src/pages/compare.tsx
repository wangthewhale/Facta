import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Bookmark, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Layout } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetProduct, useGetProductEvaluation } from '@workspace/api-client-react';
import { getSessionId } from '@/lib/session';
import {
  getSavedProducts,
  SavedProduct,
  subscribeToSavedProducts,
  toggleSavedProduct,
} from '@/lib/saved-products';

function scopeLabel(scope: string | null | undefined): string {
  if (scope === 'complete') return '完整評分';
  if (scope === 'nutrition_only') return '營養初評';
  if (scope === 'ingredients_only') return '成分初評';
  if (scope === 'water') return '飲用水分析';
  return '資料不足';
}

function CompareProduct({ saved }: { saved: SavedProduct }) {
  const sessionId = getSessionId();
  const productQuery = useGetProduct(saved.id, { query: { staleTime: 10 * 60 * 1000 } as any });
  const evaluationQuery = useGetProductEvaluation(saved.id, { session_id: sessionId }, {
    query: { staleTime: 10 * 60 * 1000 } as any,
  });

  if (productQuery.isLoading || evaluationQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const product = productQuery.data;
  const evaluation = evaluationQuery.data;
  if (!product || !evaluation) return null;

  const name = product.nameZh || product.name;
  const hasNumericScore = evaluation.analysisScope !== 'insufficient' && evaluation.analysisScope !== 'water';
  const findings = (evaluation.topReasons || []).filter(reason => reason.impact !== 'neutral').slice(0, 3);

  return (
    <article className="bg-card border-2 border-border p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 bg-muted shrink-0 flex items-center justify-center p-1">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={name} className="w-full h-full object-contain mix-blend-multiply" />
          ) : <Bookmark className="w-5 h-5 text-muted-foreground/40" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground">{product.brandName || '品牌待確認'}</p>
          <h2 className="font-black text-sm leading-snug mt-1">{name}</h2>
        </div>
        <div className="text-right shrink-0">
          <p className="text-4xl font-black font-mono leading-none">
            {evaluation.analysisScope === 'water' ? '水' : hasNumericScore ? evaluation.overallScore : '—'}
          </p>
          <p className="text-[9px] font-bold text-muted-foreground mt-1">{scopeLabel(evaluation.analysisScope)}</p>
        </div>
      </div>

      <p className="text-xs font-bold leading-relaxed border-l-4 border-primary pl-3">
        {evaluation.verdictZh || evaluation.verdict}
      </p>

      {findings.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {findings.map((reason, index) => (
            <li key={index} className="text-xs leading-relaxed">
              <span className="font-black mr-1">{reason.impact === 'negative' ? '注意' : '優點'}：</span>
              {reason.labelZh || reason.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">目前沒有足夠的同基準證據可列出比較重點。</p>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2 mt-auto">
        <Link href={`/report/${product.id}`} className="py-3 px-4 bg-foreground text-background text-xs font-black text-center">
          看完整報告
        </Link>
        <button
          type="button"
          aria-label={`移除 ${name}`}
          onClick={() => toggleSavedProduct({
            id: saved.id,
            name: saved.name,
            brandName: saved.brandName,
            imageUrl: saved.imageUrl,
            overallScore: saved.overallScore,
            scoreGrade: saved.scoreGrade,
            analysisScope: saved.analysisScope,
          })}
          className="px-4 border border-border text-muted-foreground hover:text-destructive hover:border-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
}

export default function Compare() {
  const [savedProducts, setSavedProducts] = useState<SavedProduct[]>(() => getSavedProducts());

  useEffect(() => subscribeToSavedProducts(setSavedProducts), []);

  const uniqueProducts = useMemo(
    () => savedProducts.filter((product, index, items) => items.findIndex(item => item.id === product.id) === index),
    [savedProducts],
  );

  return (
    <Layout>
      <div className="flex flex-col min-h-full pb-8">
        <header className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <p className="text-[10px] font-black tracking-widest text-primary-strong">購物前再對一次</p>
          <h1 className="text-2xl font-black mt-1">收藏比較</h1>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            把想買的幾款放在一起看；分數只適合比較同類食品，跨類別不要硬排高低。
          </p>
        </header>

        <div className="p-4 flex flex-col gap-4">
          <div className="p-4 bg-primary/10 border border-primary flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-primary-strong shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black">先比證據完整度，再比分數</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                「營養初評」不能當成完整安全結論；有過敏或特殊疾病時，仍以實體包裝與專業醫療意見為準。
              </p>
            </div>
          </div>

          {uniqueProducts.length > 0 ? (
            <>
              <p className="text-xs font-bold text-muted-foreground">已收藏 {uniqueProducts.length} 款（此裝置）</p>
              {uniqueProducts.map(product => <CompareProduct key={product.id} saved={product} />)}
              <Link href="/search" className="py-4 border-2 border-foreground text-center text-sm font-black flex items-center justify-center gap-2">
                再找一款比較 <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : (
            <div className="p-8 bg-card border border-dashed border-border text-center flex flex-col items-center gap-4">
              <Search className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="font-black">還沒有收藏商品</p>
                <p className="text-xs text-muted-foreground mt-1">打開商品報告，按「收藏」就會出現在這裡。</p>
              </div>
              <Link href="/search" className="px-6 py-3 bg-primary text-black text-xs font-black">找商品</Link>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            目前收藏只保存在這台裝置；跨裝置同步需等帳號登入完成後啟用。
          </p>
        </div>
      </div>
    </Layout>
  );
}
