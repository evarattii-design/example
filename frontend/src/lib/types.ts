export type ReceiptStatus = "Processed" | "Needs Review" | "Processing" | "Failed";

export interface LineItem {
  name: string;
  price: number | null;
  quantity?: number | null;
}

export interface ExtractedReceiptData {
  merchant_name: string | null;
  date: string | null;
  line_items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total_amount: number | null;
  currency?: string | null;
  extraction_method?: string | null;
  ocr_confidence?: number | null;
  uncertain_fields?: string[];
  warnings?: string[];
  raw_text?: string | null;
}

export interface ReceiptRecord {
  id: number;
  filename: string;
  merchant_name: string | null;
  date: string | null;
  total_amount: number | null;
  status: ReceiptStatus;
  error_message: string | null;
  extracted_json: ExtractedReceiptData;
  created_at: string;
}

export interface ReceiptListResponse {
  total: number;
  receipts: ReceiptRecord[];
}

export interface ReceiptUpdatePayload {
  filename?: string;
  merchant_name?: string | null;
  date?: string | null;
  total_amount?: number | null;
  status?: ReceiptStatus;
  extracted_json?: ExtractedReceiptData;
}
