# Parking lot

- CI warns Node.js 20 is deprecated for actions/checkout@v4, actions/setup-node@v4 and pnpm/action-setup@v4; bump them in a separate small chunk.
- **Credits on item-list cost files (6A follow-up, QuickBooks):** returns loaded later from Fix Later keep an unknown cost, even when the sales file takes its cost from the item list, so their pocket stays out of margin. Costing credits from the item list at that step would close it.
- **Freight on orders whose lines all failed (6A follow-up):** the batch report warns and the freight is not loaded. Reloading the fixed lines from Fix Later does not bring the header's freight back; re-import the lines with the header file instead.
- **2M leak finder is slower (6A 8 GB rerun):** about 11.5 s at 2M lines, against 8.3 s in 4D. The pre-6A build is the same, so the slowdown came between 4D and 5B. No target applies; profile it before Scale grows past 1M.
- **Reads during warm-up can wait (6A 8 GB rerun):** a query issued while the background warm-up runs waits for the current warm-up statement, from 16 ms to about 4 s at 1M lines (9 s at 2M). The UI says browsing works meanwhile; splitting the warm-up into shorter statements would shorten the wait.

Done on 5 Nov 2026 (blueprint section 22, item 17): header/line joins, item-list cost as a cost source, streaming reads of XLSX/XLSM sheets over 300,000 rows, and German/French/Spanish/Dutch header names. See [PILOT_FILES.md](./PILOT_FILES.md).
