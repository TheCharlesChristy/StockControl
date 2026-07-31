/**
 * CSV export for the report screens. Generated in the browser from the rows
 * already on screen, so there is no export endpoint to keep in step with the
 * filters — what you exported is what you were looking at.
 */

/** Anything containing a delimiter, a quote or a newline has to be quoted. */
function escapeCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** The server caps a page at 200 rows, so an export of more than that pages. */
const PAGE_SIZE = 200;
/** A guard against paging for ever if a total ever disagreed with the rows. */
const MAX_PAGES = 100;

interface Page<Row> {
  readonly rows: readonly Row[];
  readonly total: number;
}

/**
 * Collects every row matching a filter, not merely the first page. An export
 * that silently stopped at 200 rows would be worse than no export at all: it
 * looks complete and is not.
 */
export async function fetchAllRows<Row>(
  fetchPage: (limit: number, offset: number) => Promise<Page<Row>>,
): Promise<readonly Row[]> {
  const collected: Row[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(PAGE_SIZE, page * PAGE_SIZE);

    collected.push(...result.rows);

    if (collected.length >= result.total || result.rows.length === 0) {
      break;
    }
  }

  return collected;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, contents: string): void {
  /* The BOM is what makes Excel open a UTF-8 CSV without mangling accents. */
  const blob = new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
