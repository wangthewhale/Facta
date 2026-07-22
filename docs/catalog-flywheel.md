# FACTA 商品資料飛輪與行動建議

更新：2026-07-22

## 這一版已落地的能力

- 報告第一屏直接顯示單一行動：`可以買／可以喝`、`少吃`、`換一款`、`先補資料`。
- 正向的「可以買」門檻高於分數門檻：必須同時具備完整營養與成分證據、高信心，且沒有紅燈證據。
- 已確認的負面證據即使只有營養資料，也可先給 `少吃` 或 `換一款`；缺資料永遠不能轉成正向推薦。
- 條碼未命中 FACTA 驗證商品時，會先查本地候選資料，再以 Open Food Facts API v3 做限時的公開資料識別。找到名稱也只會帶入補拍流程，不會自動建立已評分商品。
- 外部條碼命中會以 best-effort 方式寫入 staging，形成下一輪驗證與補資料候選；不會覆寫人工驗證資料。
- TFDA 食品追溯追蹤資料集已有可重跑、可雜湊稽核、預設 dry-run 的批次匯入器。
- 商品名稱搜尋會先做「產品意圖」展開；例如搜尋「水」時，優先找飲用水、礦泉水、純水與離子水，排除水晶餃、水蜜桃等字面誤中。
- 本地資料不足時，`/search/discover` 會自動查 12 個台灣現售電商並只保留可信直接商品頁；已知搜尋結果頁會被拒絕，電商資料只作商品身分與購買線索，不作健康評分。相同查詢會合併並快取 6 小時，每個來源 IP 每 10 分鐘上限 24 次，避免 launch 流量放大 AI 成本。
- Open Food Facts 台灣商品已有可分頁、限速、可續跑、預設 dry-run 的 staging 匯入器；每筆先驗 GTIN、營養範圍與熱量／巨量營養素一致性。
- AI 工作佇列以實際掃描次數、使用者補件、證據完整度與可用標示圖片排序；只排 staging，不會自動升級成已驗證商品。

## 目前誠實基線（2026-07-22）

正式站公開統計為 canonical 商品 10 筆，其中已驗證 6 筆；TFDA staging 候選 52,009 筆。兩個數字不能相加後宣稱為「已驗證資料庫」。新首頁透過 `/dashboard/stats` 分開顯示可搜尋紀錄、部分證據候選與完整核對商品。

## 2026-07-22 TFDA dry run

來源：食品追溯追蹤系統消費者查詢資料集（InfoId 188）。

| 指標 | 筆數 |
| --- | ---: |
| 來源紀錄 | 52,009 |
| 唯一來源代碼 | 52,009 |
| FACTA canonical identity 候選 | 43,178 |
| 只有目錄身分 | 40,854 |
| 營養資料達初評門檻 | 9,083 |
| 只有機器可讀成分 | 139 |
| 成分＋營養皆有、可進核對 | 1,933 |
| 合計可做營養初評 | 11,016 |
| 有圖片 | 20,660 |
| AI 標示擷取候選 | 11,582 |
| 未經 FACTA 驗證即可顯示「可以買」 | 0 |

注意：產品追溯系統串接碼不是零售 GTIN／條碼。TFDA 也明確表示商品介紹與檢驗報告由負責廠商自主提供，不保證正確性；因此這 52,009 筆能讓搜尋一上線就有規模，但不能宣稱等同 52,009 筆已驗證條碼商品。

## 資料品質閘門

| 層級 | 可搜尋 | 可識別條碼 | 可顯示分數 | 可下負向行動 | 可顯示「可以買」 |
| --- | --- | --- | --- | --- | --- |
| `catalog_only` | 是 | 有 GTIN 才可 | 否 | 否 | 否 |
| `nutrition_ready` | 是 | 有 GTIN 才可 | 營養初評 | 有明確紅燈時可 | 否 |
| `ingredients_ready` | 是 | 有 GTIN 才可 | 成分初評 | 有明確避用成分時可 | 否 |
| `review_ready` | 是 | 有 GTIN 才可 | 仍待 FACTA 核對 | 可 | 否 |
| canonical `verified` | 是 | 是 | 是 | 是 | 僅限完整、高信心、無紅燈 |

AI 可以擷取圖片、正規化品牌與欄位、找重複候選，但輸出一律進 `extracted_pending_review`；不能直接覆寫 verified facts，也不能自行把商品升級成「可以買」。最終行動由版本化的 deterministic ruleset 決定。

## 每日自動匯入

1. 下載官方 archive，記錄來源 URL、授權、時間與 SHA-256。
2. 先做 dry-run；若總筆數比前次下降超過 20%、來源代碼重複或商品名稱缺漏，停止寫入並告警。
3. 只 upsert 到 `catalog_import_candidates` staging。
4. 有標示圖片但缺機器可讀欄位者，排入 AI 擷取候選。
5. 品牌提供的 GTIN、實體包裝照片、可信資料源或人工核對通過後，才 promotion 到 canonical products。
6. promotion 後重算 FACTA 評分與行動；所有規則、來源與日期可追溯。

### Open Food Facts 台灣 GTIN 管線

```bash
# 預設只抓 1 頁、只產生稽核摘要，不寫資料庫
pnpm --filter @workspace/scripts catalog:off-taiwan

# 大批量先分段 dry-run；遇中斷可用 --start-page 續跑
pnpm --filter @workspace/scripts exec tsx ./src/open-food-facts-import.ts \
  --dry-run --country=Taiwan --start-page=1 --max-pages=10 --page-size=1000

# 僅在 staging migration 已完成且取得正式操作確認後執行
pnpm --filter @workspace/scripts exec tsx ./src/open-food-facts-import.ts \
  --write-staging --country=Taiwan --start-page=1 --max-pages=10 --page-size=1000
```

Open Food Facts 暫時不可用時，匯入工作會在三次重試後失敗且不寫入半套 canonical 商品；前台仍可使用 TFDA、通路型錄、使用者補拍與限時即時電商搜尋。

2026-07-22 已以 5 筆小批量完成 live dry-run：來源回報台灣共 2,971 筆；5 筆中 3 筆通過 GTIN／名稱／營養品質閘門、2 筆因缺商品名稱被拒絕，寫入 staging 與正向推薦皆為 0。正式匯入仍須先逐頁 dry-run 對帳。

### 需求導向的 AI 補資料佇列

```bash
# 先看下一批最值得處理的 100 款
pnpm --filter @workspace/scripts catalog:prioritize

# 取得正式操作確認後，只把有圖且缺欄位的 staging 候選排入 AI 擷取
pnpm --filter @workspace/scripts catalog:prioritize:write-queue
```

## 要達到「95% 掃得到」還缺什麼

52,009 筆 TFDA 資料不能直接證明 95% 條碼辨識率，因為它沒有零售 GTIN。要達標需同時建三條管線：

- Open Food Facts：用於即時 miss fallback 與可下載的 bulk 資料；須遵守 ODbL、圖片授權、API rate limit、User-Agent 與 attribution。
- GS1／品牌 feed：用於 GTIN 與品牌身分的權威核對；公開查詢額度不足以支撐大量產品，需洽 GS1 Taiwan 或品牌端批次資料合作。
- 使用者補標示：掃到公開身分但證據不足時，一張拍下成分＋營養；確認後回饋同條碼，形成網路效應。

正式對外宣稱前，固定以至少 1,000 個台灣真實商品條碼做分層測試：

- `辨識率 = 5 秒內回傳已驗證商品或可核對公開身分的有效條碼數 / 可正常掃描的有效條碼數`
- `行動完成率 = 10 秒內顯示買／少吃／換一款／先補資料的有效條碼數 / 可正常掃描的有效條碼數`
- 另列 `完整行動率`，不能把「先補資料」算成完整健康結論。

## 上線操作與回復

上線順序：先執行 staging migration，再跑 TFDA dry-run 對帳，接著寫入 staging，最後才發布應用程式。整批匯入不修改 canonical products。

可立即回復的開關：

- `FACTA_EXTERNAL_CATALOG_LOOKUP_ENABLED=false`：停用外部即時條碼查詢。
- `FACTA_STAGE_EXTERNAL_CATALOG_ENABLED=false`：保留公開資料識別，但停止把結果寫入 staging。
- `FACTA_LIVE_CATALOG_SEARCH_ENABLED=false`：立即停用搜尋頁的 AI 現售電商補查，保留既有資料庫搜尋。

資料庫回復：先停排程與 staging 寫入，匯出 `catalog_import_runs`／`catalog_import_candidates` 稽核資料，再依 migration 尾端指令刪除兩張 staging table。canonical products、已驗證標示與既有評分不受影響。
