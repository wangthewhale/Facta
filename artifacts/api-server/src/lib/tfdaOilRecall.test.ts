import { describe, expect, it } from "vitest";
import { parseTfdaOilRecallHtml } from "./tfdaOilRecall.js";

describe("TFDA official oil recall parser", () => {
  it("extracts business, product, batch, expiry, note and update time", () => {
    const result = parseTfdaOilRecallHtml(`
      <span>最後更新：2026/07/22 13:34</span>
      <table><tbody id="rows"><tr>
        <td>1</td><td class="company">桂冠實業股份有限公司</td>
        <td><span class="tag">新北市</span></td><td>桂冠沙拉</td>
        <td class="batch">-</td><td>產品效期最晚到2026.7.15</td>
        <td>預防性下架產品</td>
      </tr></tbody></table>
    `);
    expect(result.lastUpdated).toBe("2026-07-22T13:34:00+08:00");
    expect(result.rows).toEqual([{
      businessName: "桂冠實業股份有限公司",
      city: "新北市",
      productName: "桂冠沙拉",
      batch: null,
      expiry: "產品效期最晚到2026.7.15",
      note: "預防性下架產品",
    }]);
  });

  it("returns an empty evidence set for a no-result page", () => {
    expect(parseTfdaOilRecallHtml('<tbody id="rows"></tbody>').rows).toEqual([]);
  });
});
