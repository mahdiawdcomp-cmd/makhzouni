import { useEffect } from "react"

type Pagination = { pageIndex: number; pageSize: number }

/**
 * Keeps a table's page index inside the current row count.
 *
 * Our tables deliberately set `autoResetPageIndex: false` — that is load-bearing
 * and fixed a navigation-freeze bug, so it must stay. The cost is that nothing
 * moves the page index when the row set SHRINKS: sit on page 12, type a search
 * or apply a filter that leaves 8 rows, and the table renders zero rows. It
 * reads exactly like "the products disappeared", and on ProductsPage the page
 * index is persisted in sessionStorage, so it survives navigation and the list
 * stays blank until the user notices the pager.
 *
 * Clamping is the narrow fix: it never fights the user's paging, it only pulls
 * them back to the last page that actually has rows.
 */
export function useClampedPageIndex(
  rowCount: number,
  pagination: Pagination,
  setPagination: (updater: (previous: Pagination) => Pagination) => void,
) {
  const { pageIndex, pageSize } = pagination

  useEffect(() => {
    if (pageSize <= 0) return
    const lastPage = Math.max(0, Math.ceil(rowCount / pageSize) - 1)
    if (pageIndex > lastPage) {
      setPagination((previous) => ({ ...previous, pageIndex: lastPage }))
    }
    // setPagination is a stable state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount, pageIndex, pageSize])
}

/**
 * Same guard for tables whose pagination state lives INSIDE react-table
 * (uncontrolled) rather than in a useState pair.
 */
export function useClampedTablePageIndex(table: {
  getState: () => { pagination: { pageIndex: number } }
  getPageCount: () => number
  setPageIndex: (index: number) => void
}) {
  const pageIndex = table.getState().pagination.pageIndex
  const pageCount = table.getPageCount()

  useEffect(() => {
    const lastPage = Math.max(0, pageCount - 1)
    if (pageIndex > lastPage) table.setPageIndex(lastPage)
    // table is a stable instance for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, pageCount])
}
