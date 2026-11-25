"use client";

import { AlertTriangle, CheckCircle2, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ReceiptRecord } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function ExtractionResultCard({
  receipt,
  onReviewEdit,
}: {
  receipt: ReceiptRecord;
  onReviewEdit: (receipt: ReceiptRecord) => void;
}) {
  const ext = receipt.extracted_json || {
    merchant_name: null,
    date: null,
    line_items: [],
    subtotal: null,
    tax: null,
    tip: null,
    total_amount: null,
  };
  const items = ext.line_items ?? [];
  const warnings = ext.warnings ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            {receipt.status === "Processed" ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
            <h3 className="font-semibold">Latest Extraction Result</h3>
            <StatusBadge status={receipt.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{receipt.filename}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onReviewEdit(receipt)}>
          <Edit3 className="h-3.5 w-3.5" />
          Review &amp; Edit
        </Button>
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          {warnings[0]}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Merchant</p>
          <p className="font-medium">{receipt.merchant_name || "Not detected"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p className="font-medium">{formatDate(receipt.date)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Grand Total</p>
          <p className="text-lg font-bold tabular-nums">
            {formatCurrency(receipt.total_amount)}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          Line Items ({items.length})
        </p>
        {items.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No line items detected. Click Review &amp; Edit to add items manually.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {items.slice(0, 6).map((item, idx) => (
              <li key={idx} className="flex items-center justify-between gap-2">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatCurrency(item.price)}
                </span>
              </li>
            ))}
            {items.length > 6 && (
              <li className="text-xs text-muted-foreground">
                +{items.length - 6} more items (open Review &amp; Edit to view all)
              </li>
            )}
          </ul>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-xs">
          <div>
            <span className="text-muted-foreground">Subtotal: </span>
            <span className="font-medium tabular-nums">{formatCurrency(ext.subtotal)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Tax: </span>
            <span className="font-medium tabular-nums">{formatCurrency(ext.tax)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Tip: </span>
            <span className="font-medium tabular-nums">{formatCurrency(ext.tip)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
