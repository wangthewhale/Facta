import React from 'react';
import { useLocation, useParams } from 'wouter';
import { Layout } from '@/components/layout';
import { useDiscoverAlternatives, useGetProduct } from '@workspace/api-client-react';
import { useTranslation } from '@/lib/i18n';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Database,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  TrendingDown,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { track } from '@/lib/analytics';

const evidenceLabels: Record<string, string> = {
  review_ready: '營養＋成分資料待核對',
  nutrition_ready: '有營養資料・標示待核對',
  ingredients_ready: '有成分資料・營養待補',
  catalog_only: '商品身分候選',
};

export default function Alternatives() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id || '0');
  const { lang } = useTranslation();
  const [, setLocation] = useLocation();

  const { data: originalProduct, isLoading: originalLoading } = useGetProduct(productId, {
    query: { enabled: !!productId } as any,
  });
  const discovery = useDiscoverAlternatives(productId, {
    query: { enabled: !!productId, staleTime: 5 * 60 * 1000, retry: 1 } as any,
  });

  const verified = discovery.data?.verifiedAlternatives ?? [];
  const catalogCandidates = discovery.data?.catalogCandidates ?? [];
  const commerceCandidates = discovery.data?.commerceCandidates ?? [];
  const totalCandidates = catalogCandidates.length + commerceCandidates.length;

  return (
    <Layout>
      <div className="flex flex-col min-h-full bg-background">
        <div className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <button
            onClick={() => window.history.back()}
            aria-label="返回上一頁"
            className="mb-4 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black tracking-[0.2em] uppercase text-primary-strong">FACTA AI 自動搜尋</p>
              <h1 className="text-2xl font-black mt-1">更好的選擇</h1>
              {originalLoading ? (
                <Skeleton className="h-4 w-48 mt-2" />
              ) : originalProduct ? (
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  這款：<span className="font-semibold text-foreground">{lang === 'zh' && originalProduct.nameZh ? originalProduct.nameZh : originalProduct.name}</span>
                </p>
              ) : null}
            </div>
            <span className="w-10 h-10 bg-primary text-black flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </span>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-6">
          {discovery.isLoading && (
            <section className="bg-foreground text-background p-5 flex flex-col gap-5" aria-live="polite">
              <div className="flex items-center gap-3">
                <LoaderCircle className="w-6 h-6 text-primary animate-spin" />
                <div>
                  <p className="font-black text-lg">FACTA 正在替你找，不用自己查</p>
                  <p className="text-xs text-background/65 mt-1">同類、買得到、證據可比較，三關都過才會放前面。</p>
                </div>
              </div>
              <ol className="flex flex-col gap-3">
                {[
                  ['1', '比對 FACTA 已驗證商品'],
                  ['2', '搜尋 52,009 筆來源商品候選'],
                  ['3', '查目前台灣公開電商頁面'],
                ].map(([step, label]) => (
                  <li key={step} className="flex items-center gap-3 text-xs font-bold">
                    <span className="w-6 h-6 border border-background/35 flex items-center justify-center font-mono text-[10px]">{step}</span>
                    {label}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {discovery.isError && (
            <section className="border-2 border-destructive bg-card p-5 flex flex-col gap-4">
              <ShieldAlert className="w-6 h-6 text-destructive" />
              <div>
                <p className="font-black">這次搜尋沒有完成</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">原商品報告不受影響；重新整理只會再查公開資料，不會修改你的紀錄。</p>
              </div>
              <button
                onClick={() => { track('alternative_discovery_retried', { productId }); void discovery.refetch(); }}
                className="py-3 border-2 border-foreground font-black text-sm flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> 再查一次
              </button>
            </section>
          )}

          {discovery.data && (
            <>
              <section className="border-2 border-foreground bg-card overflow-hidden">
                <div className="p-5 flex items-start gap-4">
                  <span className="w-10 h-10 bg-primary text-black flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-black text-lg leading-snug">
                      {verified.length > 0
                        ? `找到 ${verified.length} 款已驗證、可以直接比較`
                        : totalCandidates > 0
                          ? `找到 ${totalCandidates} 款同類候選，先替你排好順序`
                          : '已查完目前可用來源，還沒有可靠候選'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                      搜尋關鍵：{discovery.data.query}。候選商品不會因為「有賣」就被說成比較健康。
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 border-t border-border">
                  <div className="p-3 border-r border-border">
                    <p className="text-lg font-black font-mono">{verified.length}</p>
                    <p className="text-[9px] font-bold text-muted-foreground mt-1">已驗證可比較</p>
                  </div>
                  <div className="p-3 border-r border-border">
                    <p className="text-lg font-black font-mono">{discovery.data.catalogCount.toLocaleString()}</p>
                    <p className="text-[9px] font-bold text-muted-foreground mt-1">來源候選已搜尋</p>
                  </div>
                  <div className="p-3">
                    <p className="text-lg font-black font-mono">{commerceCandidates.length}</p>
                    <p className="text-[9px] font-bold text-muted-foreground mt-1">電商上架頁找到</p>
                  </div>
                </div>
              </section>

              {verified.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div>
                    <p className="text-[10px] font-black tracking-[0.18em] uppercase text-primary-strong">第一順位</p>
                    <h2 className="font-black text-lg mt-1">已驗證，可以直接換</h2>
                  </div>
                  {verified.map((alt) => (
                    <button
                      key={alt.product.id}
                      type="button"
                      onClick={() => {
                        track('verified_alternative_opened', { productId, alternativeProductId: alt.product.id });
                        setLocation(`/report/${alt.product.id}`);
                      }}
                      className="w-full border-2 border-primary-strong bg-card text-left group hover:bg-primary/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
                    >
                      <div className="p-4 flex items-start gap-4">
                        <div className="w-16 h-16 bg-primary/15 text-primary-strong flex items-center justify-center text-xl font-mono font-black shrink-0">
                          {alt.product.overallScore ?? '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">{alt.product.brandName || '品牌待確認'}</p>
                              <h3 className="font-black text-base leading-snug mt-1">{lang === 'zh' && alt.product.nameZh ? alt.product.nameZh : alt.product.name}</h3>
                            </div>
                            <ArrowRight className="w-5 h-5 shrink-0 text-muted-foreground group-hover:text-primary-strong" />
                          </div>
                          <p className="text-xs font-bold leading-relaxed mt-3 border-l-4 border-primary pl-3">
                            {lang === 'zh' && alt.whyBetterZh ? alt.whyBetterZh : alt.whyBetter}
                          </p>
                        </div>
                      </div>
                      <div className="px-4 py-3 border-t border-border flex flex-wrap gap-2">
                        <span className="px-2 py-1 bg-primary text-black text-[10px] font-black tracking-wide flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> FACTA 已驗證
                        </span>
                        {alt.scoreImprovement != null && alt.scoreImprovement > 0 && (
                          <span className="px-2 py-1 border border-border text-[10px] font-black flex items-center gap-1">
                            <TrendingDown className="w-3 h-3 rotate-180" /> 高 {alt.scoreImprovement} 分
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </section>
              )}

              {catalogCandidates.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div>
                    <p className="text-[10px] font-black tracking-[0.18em] uppercase text-muted-foreground">AI 預篩</p>
                    <h2 className="font-black text-lg mt-1">同類候選，FACTA 正在核對標示</h2>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">公開資料有營養數值時，會先排出值得核對的商品；這仍不是最終「可以買」建議。</p>
                  </div>
                  {catalogCandidates.map((candidate) => (
                    <article key={candidate.candidateId} className="border border-border bg-card p-4 flex flex-col gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-14 h-14 bg-muted shrink-0 flex items-center justify-center p-1">
                          {candidate.imageUrl ? (
                            <img src={candidate.imageUrl} alt="" className="w-full h-full object-contain mix-blend-multiply" />
                          ) : <Database className="w-5 h-5 text-muted-foreground/35" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm leading-snug">{candidate.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                            {[candidate.brandName, candidate.retailerName, candidate.priceNtd != null ? `NT$${candidate.priceNtd.toLocaleString()}` : null, candidate.categoryName, candidate.packageSpec].filter(Boolean).join(' · ')}
                          </p>
                          <span className={`inline-flex mt-2 px-2 py-1 text-[10px] font-black tracking-wide ${candidate.preliminaryBetter ? 'bg-primary text-black' : 'bg-amber-100 text-amber-900 border border-amber-300'}`}>
                            {candidate.preliminaryBetter ? '營養數值預篩較佳' : evidenceLabels[candidate.evidenceTier] || '待核對'}
                          </span>
                        </div>
                      </div>

                      <ul className="flex flex-col gap-2">
                        {candidate.whyCandidateZh.map((reason, index) => (
                          <li key={index} className="text-xs font-bold leading-relaxed flex items-start gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-primary-strong shrink-0 mt-0.5" /> {reason}
                          </li>
                        ))}
                      </ul>

                      <div className="grid grid-cols-3 gap-2">
                        {candidate.shoppingLinks.map((link) => (
                          <a
                            key={link.retailerName}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => track('alternative_retailer_search_clicked', { productId, candidateId: candidate.candidateId, retailer: link.retailerName })}
                            className="min-h-10 border border-foreground text-[10px] font-black flex items-center justify-center gap-1 hover:bg-foreground hover:text-background transition-colors"
                          >
                            <Search className="w-3 h-3" /> {link.retailerName}
                          </a>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                        <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold underline text-muted-foreground flex items-center gap-1">
                          {candidate.sourceName} <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            track('alternative_candidate_verify_clicked', { productId, candidateId: candidate.candidateId });
                            setLocation(`/submit?name=${encodeURIComponent(candidate.name)}&brand=${encodeURIComponent(candidate.brandName ?? '')}`);
                          }}
                          className="text-[10px] font-black text-primary-strong flex items-center gap-1"
                        >
                          <Camera className="w-3.5 h-3.5" /> 核對這款包裝
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              )}

              {commerceCandidates.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div>
                    <p className="text-[10px] font-black tracking-[0.18em] uppercase text-muted-foreground">目前買得到</p>
                    <h2 className="font-black text-lg mt-1">AI 找到的公開電商頁面</h2>
                    <p className="text-xs text-muted-foreground mt-1">這一區只確認同類與上架頁，不拿價格或行銷文案當健康證據。</p>
                  </div>
                  {commerceCandidates.map((candidate, index) => (
                    <article key={`${candidate.productUrl}-${index}`} className="border border-border bg-card p-4 flex items-start gap-3">
                      <span className="w-10 h-10 bg-muted flex items-center justify-center shrink-0"><Store className="w-5 h-5 text-muted-foreground" /></span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground">{candidate.retailerName}{candidate.priceNtd != null ? ` · NT$${candidate.priceNtd.toLocaleString()}` : ''}</p>
                            <h3 className="font-black text-sm leading-snug mt-1">{candidate.name}</h3>
                          </div>
                          <ShoppingBag className="w-4 h-4 shrink-0 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mt-2">{candidate.whyMatchZh}</p>
                        <a
                          href={candidate.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => track('alternative_commerce_listing_clicked', { productId, retailer: candidate.retailerName })}
                          className="inline-flex items-center gap-1 mt-3 text-[11px] font-black underline"
                        >
                          打開商品頁確認價格與庫存 <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </article>
                  ))}
                </section>
              )}

              {verified.length === 0 && totalCandidates === 0 && (
                <section className="p-6 border border-dashed border-border flex flex-col gap-5">
                  <ShieldCheck className="w-6 h-6 text-primary-strong" />
                  <div>
                    <p className="font-black">AI 已經替你查完，目前仍沒有能負責任推薦的同類商品</p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-2">這代表目前找不到同類且證據足夠的候選，不是把搜尋工作丟回給你。FACTA 會保留嚴格門檻，不拿不同種類硬湊。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocation(`/search?q=${encodeURIComponent(discovery.data.query)}`)}
                    className="py-3 border-2 border-foreground font-black text-sm flex items-center justify-center gap-2"
                  >
                    <Search className="w-4 h-4" /> 查看這次搜尋範圍
                  </button>
                </section>
              )}

              <aside className="bg-muted p-4 flex items-start gap-3">
                <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">{discovery.data.caveatZh}</p>
              </aside>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
