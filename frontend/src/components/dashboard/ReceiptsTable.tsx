"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  Inbox,
  Search,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ReceiptRecord, ReceiptStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

const filters: ("All" | ReceiptStatus)[] = [
  "All",
  "Processed",
  "Needs Review",
  "Failed",
];

type SortField = "date" | "amount";
type SortDir = "asc" | "desc";

function SortIcon({
  field,
  activeField,
  direction,
}: {
  field: SortField;
  activeField: SortField;
  direction: SortDir;
}) {
  if (activeField !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />;
  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );
}

export function ReceiptsTable({
  receipts,
  loading,
  title,
  limit,
  onSelect,
  onDelete,
  deletingId,
}: {
  receipts: ReceiptRecord[];
  loading: boolean;
  title: string;
  limit?: number;
  onSelect: (receipt: ReceiptRecord) => void;
  onDelete?: (receipt: ReceiptRecord) => void;
  deletingId?: number | null;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof filters)[number]>("All");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = receipts.filter((item) => {
      const matchesStatus = status === "All" || item.status === status;
      const merchant = (item.merchant_name || "").toLowerCase();
      const filename = item.filename.toLowerCase();
      const matchesQuery = !q || merchant.includes(q) || filename.includes(q);
      return matchesStatus && matchesQuery;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortField === "amount") {
        const av = a.total_amount ?? -Infinity;
        const bv = b.total_amount ?? -Infinity;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const ad = a.date || a.created_at || "";
      const bd = b.date || b.created_at || "";
      const cmp = ad.localeCompare(bd);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return limit ? sorted.slice(0, limit) : sorted;
  }, [receipts, query, status, sortField, sortDir, limit]);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search merchant or file"
              className="pl-9 sm:w-56"
            />
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatus(f)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  status === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Merchant</th>
              <th className="px-5 py-3 font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("date")}
                  className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
                >
                  Date
                  <SortIcon field="date" activeField={sortField} direction={sortDir} />
                </button>
              </th>
              <th className="px-5 py-3 text-right font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("amount")}
                  className="inline-flex cursor-pointer items-center justify-end gap-1 hover:text-foreground"
                >
                  Total Amount
                  <SortIcon field="amount" activeField={sortField} direction={sortDir} />
                </button>
              </th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-t border-border">
                  {[0, 1, 2, 3, 4].map((c) => (
                    <td key={c} className="px-5 py-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">
                  <Inbox className="mx-auto mb-2 h-8 w-8" />
                  {receipts.length === 0
                    ? "No receipts uploaded yet. Upload your first receipt to get started."
                    : "No receipts match your search or filter."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted/40"
                >
                  <td className="px-5 py-3.5">
                    <p className="font-medium">
                      {r.merchant_name || (
                        <span className="italic text-muted-foreground">Unknown merchant</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.filename}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-muted-foreground">
                    {formatDate(r.date)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums">
                    {formatCurrency(r.total_amount)}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div
                      className="inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label={`View ${r.filename}`}
                        onClick={() => onSelect(r)}
                        className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {onDelete && (
                        <button
                          type="button"
                          aria-label={`Delete ${r.filename}`}
                          disabled={deletingId === r.id}
                          onClick={() => onDelete(r)}
                          className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
