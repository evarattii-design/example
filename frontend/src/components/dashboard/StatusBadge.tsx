import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { ReceiptStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const styles: Record<ReceiptStatus, { cls: string; Icon: typeof CheckCircle2 }> = {
  Processed: { cls: "bg-success-soft text-success", Icon: CheckCircle2 },
  "Needs Review": { cls: "bg-warning-soft text-warning", Icon: AlertTriangle },
  Processing: { cls: "bg-warning-soft text-warning", Icon: Loader2 },
  Failed: { cls: "bg-destructive-soft text-destructive", Icon: XCircle },
};

export function StatusBadge({ status }: { status: ReceiptStatus }) {
  const { cls, Icon } = styles[status] ?? styles["Needs Review"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        cls,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "Processing" && "animate-spin")} />
      {status}
    </span>
  );
}
