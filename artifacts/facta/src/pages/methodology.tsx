import React from 'react';
import { Layout } from '@/components/layout';
import { ShieldCheck, Scale, Database, AlertCircle, Newspaper, CheckCircle2, Droplets } from 'lucide-react';

const TFDA_SOURCE = 'https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=31511';
const WHO_FAT_SOURCE = 'https://www.who.int/publications/i/item/9789240073630';
const TFDA_WATER_EXEMPTION_SOURCE = 'https://www.fda.gov.tw/TC/siteContent.aspx?sid=12343';
const WHO_WATER_PH_SOURCE = 'https://www.who.int/publications/m/item/chemical-fact-sheets--ph';

export default function Methodology() {
  return (
    <Layout>
      <div className="flex flex-col min-h-full bg-background text-foreground pb-20">
        <header className="p-6 bg-card border-b border-border sticky top-0 z-10">
          <p className="text-[10px] font-black tracking-widest text-primary-strong">RULESET 2.2.0</p>
          <h1 className="text-2xl font-black mt-1">FACTA 如何判定好壞</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">同一份標示、同一版本規則，會得到同一結果。資料不足時不硬給完整分數。</p>
        </header>

        <section className="p-6 border-b border-border bg-primary/5 flex flex-col gap-3">
          <ShieldCheck className="w-7 h-7 text-primary-strong" />
          <h2 className="text-lg font-black">先確認能不能公平比較</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            包裝通常標示「每一份」，但不同商品份量不一。FACTA 必須先取得每份量與 g／ml 單位，才能換算成每 100g（固體）或每 100ml（液體）。糖、鈉、飽和脂肪至少要有兩項，否則顯示「資料不足」。
          </p>
        </section>

        <section className="p-6 border-b border-border bg-sky-50 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Droplets className="w-6 h-6 text-sky-700" />
            <h2 className="text-lg font-black">飲用水不硬套一般食品規則</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            未作營養宣稱的飲用水與礦泉水，依食藥署規定可免營養標示。當商品名稱與使用者確認的成分都符合單純飲用水時，FACTA 會改看是否含糖、甜味劑或香料、鈉與礦物質是否有標示、pH 宣稱代表什麼，以及官方抽驗與近期消息，不會要求使用者填寫包裝上不存在的數字。
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            pH 是酸鹼值資訊。WHO 未為飲用水 pH 訂定健康基準值，因此 FACTA 不會把「pH 9」直接當成額外保健功效或水質安全證明。
          </p>
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            <a href={TFDA_WATER_EXEMPTION_SOURCE} target="_blank" rel="noopener noreferrer" className="underline">食藥署免營養標示規定 →</a>
            <a href={WHO_WATER_PH_SOURCE} target="_blank" rel="noopener noreferrer" className="underline">WHO 飲用水 pH 資料 →</a>
          </div>
        </section>

        <section className="p-6 border-b border-border flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6" />
            <h2 className="text-lg font-black">營養初評門檻</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            目前採用食藥署 2026 年「包裝正面營養資訊（紅綠燈）」草案門檻。這是預告中的自願性指引，不是把草案誤稱為強制法規。
          </p>
          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full text-xs min-w-[340px]">
              <thead className="bg-muted text-left">
                <tr><th className="p-3">每 100g／ml</th><th className="p-3">綠燈上限</th><th className="p-3">紅燈門檻</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr><td className="p-3 font-bold">固體糖</td><td className="p-3">5g</td><td className="p-3">15g</td></tr>
                <tr><td className="p-3 font-bold">固體鈉</td><td className="p-3">120mg</td><td className="p-3">500mg</td></tr>
                <tr><td className="p-3 font-bold">固體飽和脂肪</td><td className="p-3">1.5g</td><td className="p-3">4.5g</td></tr>
                <tr><td className="p-3 font-bold">液體糖</td><td className="p-3">2.5g</td><td className="p-3">7.5g</td></tr>
                <tr><td className="p-3 font-bold">液體鈉</td><td className="p-3">120mg</td><td className="p-3">250mg</td></tr>
                <tr><td className="p-3 font-bold">液體飽和脂肪</td><td className="p-3">0.75g</td><td className="p-3">2.25g</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">綠燈加分、黃燈小幅扣分、紅燈明顯扣分；反式脂肪另依 WHO 證據加重扣分。</p>
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            <a href={TFDA_SOURCE} target="_blank" rel="noopener noreferrer" className="underline">食藥署原始指引 →</a>
            <a href={WHO_FAT_SOURCE} target="_blank" rel="noopener noreferrer" className="underline">WHO 脂肪指引 →</a>
          </div>
        </section>

        <section className="p-6 border-b border-border flex flex-col gap-4">
          <div className="flex items-center gap-3"><Database className="w-6 h-6" /><h2 className="text-lg font-black">成分與添加物怎麼算</h2></div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            成分文字會與 FACTA 的證據資料庫及食藥署正面表列資訊對照。只有至少 80% 列出成分完成對照，才產生成分初評；未對照成分不會被當成「安全」。合法功能性添加物不會只因名稱多就被判有毒；添加糖、油脂抹醬、鹽與通稱香料則會在缺少數量時標成「影響日常頻率、但不能判定超標」。
          </p>
          <div className="bg-[#F2B84B]/10 border border-[#D9A21B] p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#9A6700] shrink-0" />
            <p className="text-xs leading-relaxed">過敏原沒有被標記，不代表不存在。配方會變更，有嚴重過敏者必須以手上的實體包裝為準。</p>
          </div>
        </section>

        <section className="p-6 border-b border-border flex flex-col gap-4">
          <h2 className="text-lg font-black">你看到的是哪一種結論</h2>
          <div className="flex flex-col gap-3">
            {[
              ['完整評分', '營養與成分證據皆達到計分門檻；營養占 60%、添加物占 40%。'],
              ['飲用水分析', '成分符合單純飲用水；不因營養標示豁免判成資料不足，也不把 pH 宣稱當成療效。'],
              ['營養初評', '只有營養資料足夠；可以比較營養表現，但不能當成完整安全結論。'],
              ['成分初評', '只有成分證據足夠；可先建議日常食用頻率，但缺少糖、鈉與飽和脂肪數值，不能當成完整營養比較。'],
              ['資料不足', '缺少公平比較所需資料，不顯示好壞判定。'],
            ].map(([title, description]) => (
              <div key={title} className="border border-border bg-card p-4 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-primary-strong shrink-0 mt-0.5" />
                <div><p className="text-sm font-black">{title}</p><p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 border-b border-border flex flex-col gap-3">
          <Database className="w-6 h-6" />
          <h2 className="text-lg font-black">AI 做什麼、不做什麼</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">AI 協助辨識包裝文字，也查找商品、品牌與官方食安消息；使用者仍須確認 OCR 結果。營養與成分分數由固定規則計算，不讓生成式 AI 猜分數。</p>
        </section>

        <section className="p-6 border-b border-border flex flex-col gap-3">
          <Newspaper className="w-6 h-6" />
          <h2 className="text-lg font-black">最新新聞與分數分開</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">每份報告分別查詢商品、品牌與公司近 365 天消息，顯示來源、日期與影響範圍，並區分官方紀錄、獨立報導、新聞稿與廣編。新聞不改寫營養分數；只有官方紀錄或獨立報導明確指向本商品時，才會把首要行動改成「先別吃」。品牌事件未指向本商品時，只顯示背景，不誤套結論。</p>
        </section>

        <section className="m-6 p-6 bg-foreground text-background flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest">使用限制</h2>
          <p className="text-xs leading-relaxed text-background/75">FACTA 是食品資訊整理與比較工具，不是醫療器材，也不提供診斷或治療建議。商品配方可能隨時變更；實際食用前請重新閱讀手上的包裝標示。</p>
        </section>
      </div>
    </Layout>
  );
}
