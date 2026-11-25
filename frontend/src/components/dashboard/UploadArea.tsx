"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError, uploadReceipt } from "@/lib/api";
import { formatFileSize } from "@/lib/format";
import type { ReceiptRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/pdf",
]);
const ACCEPTED_EXT = [".jpg", ".jpeg", ".png", ".pdf"];
const MAX_MB = 10;

function isSupportedFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  const hasValidExt = ACCEPTED_EXT.some((ext) => lower.endsWith(ext));
  const hasValidMime = !file.type || ACCEPTED_MIME.has(file.type.toLowerCase());
  return hasValidExt && hasValidMime;
}

export function UploadArea({
  onUploaded,
}: {
  onUploaded: (receipt: ReceiptRecord) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uploading = progress !== null;

  useEffect(() => {
    if (!uploading || progress === null || progress < 70 || progress >= 94) return;
    const timer = setInterval(() => {
      setProgress((prev) => (prev !== null && prev < 94 ? prev + 3 : prev));
    }, 350);
    return () => clearInterval(timer);
  }, [uploading, progress]);

  const select = (selected?: File) => {
    if (!selected) return;
    setErrorMessage(null);
    if (!isSupportedFile(selected)) {
      const msg = "Please upload a JPG, JPEG, PNG, or PDF file.";
      setErrorMessage(msg);
      toast.error("Unsupported file", { description: msg });
      return;
    }
    if (selected.size === 0) {
      const msg = "The selected file is empty.";
      setErrorMessage(msg);
      toast.error("Empty file", { description: msg });
      return;
    }
    if (selected.size > MAX_MB * 1024 * 1024) {
      const msg = `Max size is ${MAX_MB} MB.`;
      setErrorMessage(msg);
      toast.error("File too large", { description: msg });
      return;
    }
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setErrorMessage(null);
    setProgress(5);
    try {
      const receipt = await uploadReceipt(file, (pct) => setProgress(Math.max(10, pct)));
      setProgress(100);
      onUploaded(receipt);
      if (receipt.status === "Needs Review") {
        toast.warning("Receipt saved — review needed", {
          description: `${receipt.filename} extracted with uncertain or missing fields.`,
        });
      } else {
        toast.success("Receipt processed", {
          description: `${receipt.filename} was extracted and saved.`,
        });
      }
      setFile(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Unexpected error while extracting receipt.";
      setErrorMessage(msg);
      toast.error("Extraction failed", { description: msg });
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-semibold">Upload receipt</h2>
      <p className="text-sm text-muted-foreground">
        Local OCR extracts merchant, date, line items, and totals automatically.
      </p>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) select(e.dataTransfer.files[0]);
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        className={cn(
          "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors",
          dragging
            ? "border-primary bg-accent"
            : "border-border hover:border-primary/50 hover:bg-muted/50",
          uploading && "pointer-events-none opacity-75",
        )}
      >
        <UploadCloud className="h-10 w-10 text-primary" />
        <p className="mt-3 text-sm font-medium">
          Drag & drop or <span className="text-primary">browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          JPG, JPEG, PNG or PDF up to {MAX_MB} MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            select(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {file && (
        <div className="mt-4 rounded-xl border border-border p-3">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
                {uploading && progress !== null
                  ? progress < 70
                    ? ` · Uploading ${Math.round(progress)}%`
                    : " · Running OCR & parsing..."
                  : ""}
              </p>
            </div>
            {!uploading && (
              <button
                type="button"
                aria-label="Remove file"
                onClick={() => {
                  setFile(null);
                  setErrorMessage(null);
                }}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {uploading && <Progress value={progress ?? 0} className="mt-3 h-1.5" />}
          <Button className="mt-3 w-full" disabled={uploading} onClick={handleUpload}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Extracting…
              </>
            ) : (
              "Upload & extract"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
