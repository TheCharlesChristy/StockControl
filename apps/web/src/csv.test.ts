import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, toCsv } from "./csv";

describe("CSV rendering", () => {
  it("renders a header and its rows", () => {
    expect(toCsv(["Item", "Quantity"], [["ITM-0001", "40"]])).toBe("Item,Quantity\r\nITM-0001,40");
  });

  /* A stray comma in an item name must not shift every later column along. */
  it("quotes a value containing a delimiter, a quote or a newline", () => {
    expect(toCsv(["Name"], [["Bolt, M6"], ['He said "no"'], ["Line one\nline two"]])).toBe(
      'Name\r\n"Bolt, M6"\r\n"He said ""no"""\r\n"Line one\nline two"',
    );
  });

  it("leaves an ordinary value alone", () => {
    expect(toCsv(["Name"], [["Bolt M6"]])).toBe("Name\r\nBolt M6");
  });
});

describe("collecting every row for an export", () => {
  /*
   * The server caps a page at 200 rows. An export that stopped there would look
   * complete and be wrong, which is the failure this guards against.
   */
  it("keeps paging until it has the whole result", async () => {
    const total = 450;
    const fetchPage = vi.fn((limit: number, offset: number) =>
      Promise.resolve({
        total,
        rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({
          id: offset + index,
        })),
      }),
    );

    const rows = await fetchAllRows(fetchPage);

    expect(rows).toHaveLength(total);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(rows.at(-1)).toEqual({ id: 449 });
  });

  it("asks once when everything fits on one page", async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ total: 2, rows: [{ id: 1 }, { id: 2 }] }));

    expect(await fetchAllRows(fetchPage)).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  /* A total that disagrees with the rows must not spin for ever. */
  it("stops when a page comes back empty", async () => {
    const fetchPage = vi.fn(() => Promise.resolve({ total: 9999, rows: [] }));

    expect(await fetchAllRows(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
