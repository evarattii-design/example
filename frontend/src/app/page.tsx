"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  DollarSign,
  Receipt as ReceiptIcon,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { ExtractionResultCard } from "@/components/dashboard/ExtractionResultCard";
import { ReceiptDetailModal } from "@/components/dashboard/ReceiptDetailModal";
import { ReceiptsTable } from "@/components/dashboard/ReceiptsTable";
import { Sidebar, type Section } from "@/components/dashboard/Sidebar";
import { StatCard } from "@/components/dashboard/StatCard";
import { UploadArea } from "@/components/dashboard/UploadArea";
import { Button } from "@/components/ui/button";
import { ApiError, deleteReceipt, fetchReceipts } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { ReceiptRecord } from "@/lib/types";

const titles: Record<Section, string> = {
  overview: "Overview",
  receipts: "All Receipts",
  upload: "Upload Receipt",
};

export default function HomePage() {
  const [section, setSection] = useState<Section>("overview");
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptRecord | null>(null);
  const [latestUploaded, setLatestUploaded] = useState<ReceiptRecord | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadReceipts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchReceipts();
      setReceipts(data);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Unable to load receipts from the backend.";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchReceipts()
      .then((data) => {
        if (!active) return;
        setReceipts(data);
        setLoadError(null);
      })
      .catch((err) => {
        if (!active) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : "Unable to load receipts from the backend.";
        setLoadError(msg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleUploaded = (created: ReceiptRecord) => {
    setLatestUploaded(created);
    setReceipts((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
  };

  const handleSaved = (updated: ReceiptRecord) => {
    setReceipts((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedReceipt(updated);
    if (latestUploaded?.id === updated.id) {
      setLatestUploaded(updated);
    }
  };

  const handleDelete = async (receipt: ReceiptRecord) => {
    setDeletingId(receipt.id);
    try {
      await deleteReceipt(receipt.id);
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      if (selectedReceipt?.id === receipt.id) {
        setSelectedReceipt(null);
      }
      if (latestUploaded?.id === receipt.id) {
        setLatestUploaded(null);
      }
      toast.success("Receipt deleted", {
        description: `${receipt.filename} was removed.`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete receipt.";
      toast.error("Delete failed", { description: msg });
    } finally {
      setDeletingId(null);
    }
  };

  const activeReceipts = receipts.filter((r) => r.status !== "Failed");
  const withTotals = activeReceipts.filter(
    (r) => typeof r.total_amount === "number" && !Number.isNaN(r.total_amount),
  );
  const totalExpenses = withTotals.reduce((sum, r) => sum + (r.total_amount ?? 0), 0);
  const processedCount = receipts.filter((r) => r.status === "Processed").length;
  const averageExpense = withTotals.length ? totalExpenses / withTotals.length : 0;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar active={section} onSelect={setSection} />
      <main className="space-y-6 p-5 md:ml-60 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{titles[section]}</h1>
            <p className="text-sm text-muted-foreground">
              Track, extract, and verify your expenses with local OCR.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadReceipts()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        {loadError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadReceipts()}>
              Retry
            </Button>
          </div>
        )}

        {section === "overview" && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Total Expenses"
                value={loading ? "—" : formatCurrency(totalExpenses)}
                hint={`Across ${withTotals.length} receipts with totals`}
                icon={DollarSign}
              />
              <StatCard
                label="Receipts Processed"
                value={loading ? "—" : String(processedCount)}
                hint={`${receipts.length} uploaded in total`}
                icon={ReceiptIcon}
              />
              <StatCard
                label="Average Expense"
                value={loading ? "—" : formatCurrency(averageExpense)}
                hint="Per receipt with total"
                icon={TrendingUp}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <div className="space-y-6">
                <UploadArea onUploaded={handleUploaded} />
                {latestUploaded && (
                  <ExtractionResultCard
                    receipt={latestUploaded}
                    onReviewEdit={setSelectedReceipt}
                  />
                )}
              </div>
              <ReceiptsTable
                title="Recent Receipts"
                receipts={receipts}
                loading={loading}
                limit={6}
                onSelect={setSelectedReceipt}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            </div>
          </>
        )}

        {section === "receipts" && (
          <ReceiptsTable
            title="All Receipts"
            receipts={receipts}
            loading={loading}
            onSelect={setSelectedReceipt}
            onDelete={handleDelete}
            deletingId={deletingId}
          />
        )}

        {section === "upload" && (
          <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
            <UploadArea onUploaded={handleUploaded} />
            {latestUploaded && (
              <ExtractionResultCard
                receipt={latestUploaded}
                onReviewEdit={setSelectedReceipt}
              />
            )}
          </div>
        )}
      </main>

      <ReceiptDetailModal
        receipt={selectedReceipt}
        open={selectedReceipt !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedReceipt(null);
        }}
        onSaved={handleSaved}
        onDelete={handleDelete}
        deleting={selectedReceipt ? deletingId === selectedReceipt.id : false}
      />
    </div>
  );
}
