# FACTA 商品覆蓋與科學證據管線（2026-07-23）

## 決策摘要

FACTA 不能用「資料總筆數」代表條碼覆蓋。正式站目前有 53,324 筆可搜尋紀錄，但來源候選 52,011 筆中，只有 2 個不同條碼候選。這次改造的目標是同時提升：

1. `exact barcode identity coverage`：條碼能否對到唯一商品身分。
2. `label evidence coverage`：是否有成分與可比較的營養標示。
3. `safe abstention rate`：來源衝突或資料不足時，是否停止猜測並要求補拍。
4. `scientific integrity coverage`：研究是否有來源、授權、研究設計與撤稿狀態。

絕對的「任何商品都辨識成功」無法由公開資料保證；可保證的工程行為是「不把不確定的候選冒充成正確商品」。

## 商品資料品質現況

### 正式站基準（發布前）

| 指標 | 分子 / 分母 | 結果 | 解讀 |
| --- | ---: | ---: | --- |
| 不同條碼候選覆蓋 | 2 / 52,011 | 0.0038% | 既有 52K 主要不是可掃條碼資料 |
| 已驗證商品 | 6 / 12 | 50% | 可展示完整已驗證報告的商品仍少 |
| 通路型錄 | 1,307 | — | 可用於名稱搜尋，不能假設都有 GTIN |

### 7-ELEVEN 官方鮮食目錄抽取（本次 live dry-run）

來源：`https://www.7-11.com.tw/freshfoods/Read_Food_xml_hot.aspx?={category}`

| 指標 | 分子 / 分母 | 結果 |
| --- | ---: | ---: |
| 接受的官方列 | 706 | — |
| 不重複商品名稱 | 690 / 706 | 97.7% |
| 圖片 | 706 / 706 | 100% |
| 熱量宣稱 | 478 / 706 | 67.7% |
| 價格 | 695 / 706 | 98.4% |
| GTIN | 0 / 706 | 0% |

官方目錄能在補拍商品正面後核對品名、圖片、通路與熱量宣稱，但不能單獨解決條碼。熱量欄沒有完整份量基準，因此一律不得直接進入營養評分。

### Open Food Facts 台灣資料抽樣（第 1 頁 live dry-run）

來源回報台灣共 2,972 筆。抽樣 99 筆：

| 指標 | 分子 / 分母 | 結果 |
| --- | ---: | ---: |
| 通過基本身分門檻 | 84 / 99 | 84.8% |
| 具可解析營養資料 | 72 / 84 | 85.7% |
| 成分與營養皆具備 | 50 / 84 | 59.5% |
| 具圖片 | 24 / 84 | 28.6% |
| 自動獲得「可以買」資格 | 0 / 84 | 0% |

完整匯入需要依 API rate limit 分頁執行；2,972 是來源總量，不是預先承諾的最終接受筆數。

## 條碼決策流程

1. 驗證 GTIN check digit；鏡頭誤讀不進資料查詢。
2. 將同商品的 UPC-E、UPC-A、EAN-13、前導零 GTIN-14 展開成數學等價查詢鍵。
3. 先查 FACTA 已驗證商品，再查 staging 精確 GTIN，再查 Open Food Facts 精確 GTIN，最後查可直接驗證完整條碼的公開頁。
4. 來源頁必須實際包含完整條碼；相似品名、相同品牌或 GS1 前綴都不能當作商品證明。
5. 同一條碼若對到不同完整品名、口味或規格，回傳 `identityStatus=conflict`，不自動選一筆。
6. 使用者選擇「我在 7-ELEVEN」只記錄購買情境，不拿來猜商品。
7. 商品身分找到但標示不足時，拍「成分＋營養」；身分也不明時，拍「正面＋背面」。

這套流程降低 false positive；unknown / conflict 會增加，但不會被包裝成成功辨識。

## 科學證據庫

### 收錄範圍

- 預設日期：執行日往前 15 年。
- 預設主庫：題目直接相關的人體研究、systematic review、meta-analysis、guideline。
- 可另跑 `--include-preclinical`，但所有該批資料預設 `reference_only`。
- 來源：Europe PMC / PubMed 索引；撤稿狀態每日與 Crossref Retraction Watch 對帳。
- 全文：只儲存 Europe PMC 中具明確 `CC0`、`CC BY` 或 `CC BY-SA` 的 OA 全文。其他資料只存 metadata／內部摘要索引，不複製受限制全文。

### 品質與使用規則

- `study_design_rank` 只是檢索排序，不是 GRADE certainty。
- GRADE 的 high / moderate / low / very low 是「一整體證據」的審查結果，不由單篇研究或 AI 自動產生。
- 新匯入研究一律 `pending_review`；自動成為消費者結論的筆數固定為 0。
- retracted 與 expression of concern 立即 `excluded`，既有 claims 轉為 `rejected`。
- AI 可以抽取 PICO、效果方向與限制，但必須停在 `ai_extracted_pending_review`。

### Live dry-run 品質抽樣

12 個核心主題在 2011-07-23 至 2026-07-23 的高精度人體／證據綜整查詢，共回報 1,022 筆 topic hits；同一研究可能同時命中多個主題，因此這不是去重後的論文總數。12/12 主題都有候選，且所有新資料的 `consumerEligibleWithoutReview` 都是 0。

`sodium` 的精準題名／摘要查詢，在 2011-07-23 至 2026-07-23 找到 176 筆候選。前 25 筆抽樣：摘要 25/25、DOI 25/25、OA 11/25；沒有任何一筆自動取得消費者可用資格。

Crossref Retraction Watch live sync：65,886 筆具可處理紀錄，5,189 筆因缺原始論文 DOI/PMID 等識別資訊被隔離，可比對識別碼率 92.70%；合併後 62,983 個不同原始作品，其中 60,499 個 retracted、1,680 個 expression of concern、660 個 correction。

商品報告會把使用者確認的成分與營養數值對到 evidence topics，顯示有效研究關聯、已審查可用數與撤稿隔離數。只命中研究主題不會改變「買／少吃／換一款」；必須先完成 body-of-evidence review。

## 上線品質門檻

- GTIN check digit invalid rate：必須 0% 進入查詢／寫入。
- 等價條碼映射到多個 canonical product：必須 0 筆自動解析；有衝突只能補拍或人工審查。
- Open Food Facts / web / 官方目錄候選：自動「可以買」率必須 0%。
- 無份量基準的熱量宣稱：營養評分資格必須 0%。
- retracted / expression of concern：消費者證據資格必須 0%。
- 新研究未人工 review：消費者 claims 自動核准必須 0%。

## 正式操作與回滾

1. 備份 `catalog_import_*`、`scientific_evidence_*` 與目前 deployment version。
2. staging 執行 `20260723_scientific_evidence_library.sql`。
3. staging 匯入 7-ELEVEN 706 列與 Open Food Facts 台灣完整分頁；輸出接受率、GTIN 數、圖片率、營養率、衝突率。
4. staging 先匯入 15 年 preclinical/reference-only 索引，再以 DB 中所有 active topics 跑人體／證據綜整主庫，最後同步 Retraction Watch；人體主庫會把相同來源提升回 `pending_review`，不會自動變成消費者結論。
5. 抽測至少 20 個 7-ELEVEN 實體商品：已知 GTIN、未知 GTIN、UPC 前導零、店內碼、衝突碼各需涵蓋。
6. 通過後發布應用；production 重跑 idempotent migration 與 import。
7. 回滾應用時切回前一 deployment；資料表屬 staging/index，不影響 canonical score。單次科學同步可依 `sync_run_id` 移除該次 topic links；共用、去重後的 source rows 保留為不可見索引，若必須還原內容則使用 migration 前資料庫快照。

## 官方技術依據

- Open Food Facts API 與授權：<https://openfoodfacts.github.io/openfoodfacts-server/api/>
- Open Food Facts 條碼正規化：<https://openfoodfacts.github.io/openfoodfacts-server/api/ref-barcode-normalization/>
- Europe PMC REST API：<https://europepmc.org/RestfulWebService>
- PMC Open Access Subset：<https://pmc.ncbi.nlm.nih.gov/tools/openftlist/>
- NCBI E-utilities 使用與速率：<https://www.ncbi.nlm.nih.gov/sites/books/NBK25497/>
- Crossref Retraction Watch：<https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/>
- GRADE Book：<https://book.gradepro.org/about>
