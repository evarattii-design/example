"use client";

import { LayoutDashboard, Receipt, Sparkles, Upload, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Section = "overview" | "receipts" | "upload";

const items: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "receipts", label: "All Receipts", icon: Receipt },
  { id: "upload", label: "Upload Receipt", icon: Upload },
];

export function Sidebar({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <aside className="border-b border-border bg-card md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2.5 px-5 py-4 md:py-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <span className="text-lg font-bold tracking-tight">ReceiptAI</span>
          <p className="text-[11px] text-muted-foreground">Local OCR Extractor</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active === id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
