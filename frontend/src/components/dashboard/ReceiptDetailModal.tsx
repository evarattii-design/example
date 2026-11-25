"use client";

import { useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, updateReceipt } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { ExtractedReceiptData, LineItem, ReceiptRecord } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

function toNumericOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function toInputString(val: number | null | undefined): string {
  return val !== null && val !== undefined ? String(val) : "";
}

function ReceiptDetailForm({
  receipt,
  onOpenChange,
  onSaved,
  onDelete,
  deleting,
}: {
  receipt: ReceiptRecord;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: ReceiptRecord) => void;
  onDelete: (receipt: ReceiptRecord) => void;
  deleting?: boolean;
}) {
  const ext: ExtractedReceiptData = receipt.extracted_json || {
    merchant_name: null,
    date: null,
    line_items: [],
    subtotal: null,
    tax: null,
    tip: null,
    total_amount: null,
  };

  const [merchantName, setMerchantName] = useState(
    receipt.merchant_name ?? ext.merchant_name ?? "",
  );
  const [receiptDate, setReceiptDate] = useState(receipt.date ?? ext.date ?? "");
  const [subtotal, setSubtotal] = useState(toInputString(ext.subtotal));
  const [tax, setTax] = useState(toInputString(ext.tax));
  const [tip, setTip] = useState(toInputString(ext.tip));
  const [totalAmount, setTotalAmount] = useState(
    toInputString(receipt.total_amount ?? ext.total_amount),
  );
  const [lineItems, setLineItems] = useState<LineItem[]>(
    Array.isArray(ext.line_items) ? ext.line_items : [],
  );
  const [saving, setSaving] = useState(false);

  const warnings = ext.warnings ?? [];
  const uncertainFields = ext.uncertain_fields ?? [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanedItems = lineItems
        .map((item) => ({
          name: item.name.trim(),
          price:
            item.price !== null && item.price !== undefined && !Number.isNaN(item.price)
              ? Math.round(Number(item.price) * 100) / 100
              : null,
        }))
        .filter((item) => item.name.length > 0 || item.price !== null);

      const nextMerchant = merchantName.trim() || null;
      const nextDate = receiptDate.trim() || null;
      const nextSubtotal = toNumericOrNull(subtotal);
      const nextTax = toNumericOrNull(tax);
      const nextTip = toNumericOrNull(tip);
      const nextTotal = toNumericOrNull(totalAmount);

      const nextStatus =
        nextMerchant && nextDate && nextTotal !== null ? "Processed" : receipt.status;

      const updated = await updateReceipt(receipt.id, {
        merchant_name: nextMerchant,
        date: nextDate,
        total_amount: nextTotal,
        status: nextStatus,
        extracted_json: {
          ...ext,
          merchant_name: nextMerchant,
          date: nextDate,
          subtotal: nextSubtotal,
          tax: nextTax,
          tip: nextTip,
          total_amount: nextTotal,
          line_items: cleanedItems,
          uncertain_fields: nextStatus === "Processed" ? [] : uncertainFields,
          warnings: nextStatus === "Processed" ? [] : warnings,
        },
      });
      toast.success("Receipt updated", {
        description: "Your corrections were saved to SQLite.",
      });
      onSaved(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to save changes.";
      toast.error("Save failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2 pr-6">
          <DialogTitle>{receipt.filename}</DialogTitle>
          <StatusBadge status={receipt.status} />
          {ext.extraction_method && (
            <Badge variant="secondary" className="text-[11px] font-normal">
              {ext.extraction_method}
            </Badge>
          )}
          {ext.ocr_confidence !== null && ext.ocr_confidence !== undefined && (
            <Badge variant="outline" className="text-[11px] font-normal">
              OCR {(ext.ocr_confidence * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
        <DialogDescription>
          Review the extracted receipt fields below and save any manual corrections.
        </DialogDescription>
      </DialogHeader>

      {(warnings.length > 0 || uncertainFields.length > 0) && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-3 text-xs text-warning">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Extraction notices</span>
          </div>
          {uncertainFields.length > 0 && (
            <p className="mt-1">
              Uncertain or missing fields:{" "}
              <span className="font-medium">{uncertainFields.join(", ")}</span>
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="merchant-name">Merchant / Store Name</Label>
          <Input
            id="merchant-name"
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
            placeholder="e.g. Trader Joe's"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-date">Receipt Date</Label>
          <Input
            id="receipt-date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            placeholder="YYYY-MM-DD"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Line Items ({lineItems.length})</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLineItems((items) => [...items, { name: "", price: null }])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </Button>
        </div>
        {lineItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No line items were detected automatically. Click &ldquo;Add item&rdquo; to enter them manually.
          </p>
        ) : (
          <div className="space-y-2">
            {lineItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={item.name}
                  placeholder="Item name"
                  onChange={(e) => {
                    const val = e.target.value;
                    setLineItems((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, name: val } : row)),
                    );
                  }}
                />
                <Input
                  type="number"
                  step="0.01"
                  className="w-28 text-right tabular-nums"
                  placeholder="0.00"
                  value={item.price ?? ""}
                  onChange={(e) => {
                    const val = toNumericOrNull(e.target.value);
                    setLineItems((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, price: val } : row)),
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line item"
                  onClick={() =>
                    setLineItems((prev) => prev.filter((_, i) => i !== idx))
                  }
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="subtotal">Subtotal</Label>
          <Input
            id="subtotal"
            type="number"
            step="0.01"
            value={subtotal}
            onChange={(e) => setSubtotal(e.target.value)}
            placeholder="—"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tax">Tax</Label>
          <Input
            id="tax"
            type="number"
            step="0.01"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            placeholder="—"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tip">Tip</Label>
          <Input
            id="tip"
            type="number"
            step="0.01"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            placeholder="—"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="total-amount">Grand Total</Label>
          <Input
            id="total-amount"
            type="number"
            step="0.01"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            placeholder={formatCurrency(receipt.total_amount)}
            className="font-semibold tabular-nums"
          />
        </div>
      </div>

      {ext.raw_text && (
        <details className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            View raw OCR / extracted text
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
            {ext.raw_text}
          </pre>
        </details>
      )}

      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="destructive"
          disabled={deleting || saving}
          onClick={() => onDelete(receipt)}
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete receipt"}
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="button" disabled={saving || deleting} onClick={handleSave}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save corrections"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

export function ReceiptDetailModal({
  receipt,
  open,
  onOpenChange,
  onSaved,
  onDelete,
  deleting,
}: {
  receipt: ReceiptRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: ReceiptRecord) => void;
  onDelete: (receipt: ReceiptRecord) => void;
  deleting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {receipt && (
          <ReceiptDetailForm
            key={`${receipt.id}-${receipt.created_at}-${receipt.total_amount ?? ""}-${receipt.merchant_name ?? ""}-${receipt.date ?? ""}`}
            receipt={receipt}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            onDelete={onDelete}
            deleting={deleting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
