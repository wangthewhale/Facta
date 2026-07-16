import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Layout } from '@/components/layout';
import { ArrowLeft, CheckCircle2, ShieldCheck, Clock } from 'lucide-react';
import { track } from '@/lib/analytics';

const CHECKOUT_URL = (import.meta.env.VITE_FACTA_CHECKOUT_URL as string | undefined) || '';

export function startFamilyCheckCheckout(source: string) {
  track('family_check_checkout_clicked', { source });
  if (CHECKOUT_URL) {
    window.open(CHECKOUT_URL, '_blank', 'noopener');
    return true;
  }
  return false;
}

export const checkoutConfigured = !!CHECKOUT_URL;

const includes = [
  '10 項商品完整分析',
  '依過敏原、飲食偏好與健康目標個人化',
  '找出需要優先注意的商品',
  '提供 3–5 個同通路替代品',
  '每項判斷附證據來源',
  '24 小時內完成報告',
];

export default function FamilyCheck() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    track('family_check_offer_viewed', { source: 'family_check_page' });
  }, []);

  const handleCheckout = () => {
    const ok = startFamilyCheckCheckout('family_check_page');
    if (!ok) {
      alert('付款連結尚未設定。請先設定 VITE_FACTA_CHECKOUT_URL 環境變數。');
    }
  };

  return (
    <Layout>
      <div className="px-6 pt-10 pb-10 flex flex-col gap-8">
        <button onClick={() => window.history.back()} aria-label="返回上一頁"
          className="self-start p-2 -ml-2 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ArrowLeft className="w-5 h-5" />
        </button>

        <header className="flex flex-col gap-3">
          <span className="self-start bg-primary text-black px-2 py-1 text-[10px] font-black tracking-widest">一次性服務・非訂閱</span>
          <h1 className="text-3xl font-black tracking-tight leading-tight">FACTA 家庭食品健檢</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            一次檢查家裡最常吃的 10 項食品，找出需要注意的成分、行銷話術與更適合的替代品。
          </p>
        </header>

        <div className="bg-card border border-border p-5 flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">服務內容</h2>
          <ul className="flex flex-col gap-2.5">
            {includes.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-primary-strong shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-foreground text-background p-6 flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black">NT$299</span>
            <span className="text-sm text-background/60 line-through mb-1.5">正式價 NT$499</span>
          </div>
          <p className="text-xs text-background/70">首發價，限量開放。</p>
          <button
            onClick={handleCheckout}
            className="w-full py-4 bg-primary text-black font-black tracking-widest text-sm hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-background"
          >
            開始檢查家裡的食品
          </button>
          {!checkoutConfigured && import.meta.env.DEV && (
            <p className="text-[11px] text-amber-300 leading-relaxed">
              開發提示：尚未設定付款連結（VITE_FACTA_CHECKOUT_URL），按鈕目前不會進入付款流程。
            </p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-background/70">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            若 24 小時內未完成報告，可申請退款。
          </div>
        </div>

        <div className="flex flex-col gap-2 text-[11px] text-muted-foreground leading-relaxed">
          <div className="flex items-center gap-2 text-foreground font-bold text-xs">
            <ShieldCheck className="w-4 h-4 text-primary-strong" /> FACTA 的承諾
          </div>
          <p>每項結論附資料來源。不接受品牌付費改分。不出售你的健康與掃描資料。</p>
          <p>FACTA 提供的是食品資訊整理與比較，不是醫療診斷或治療建議。若有特殊健康狀況，請諮詢醫師或營養師。</p>
        </div>
      </div>
    </Layout>
  );
}
