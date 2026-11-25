import type {
  ReceiptListResponse,
  ReceiptRecord,
  ReceiptUpdatePayload,
} from "./types";

export const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) return data.detail[0].msg;
    if (typeof data?.message === "string") return data.message;
  } catch {
    // Fall back to status text when response body is not JSON.
  }
  return response.statusText || `Request failed (${response.status})`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the backend server at ${API_BASE_URL}. Make sure FastAPI is running.`,
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function checkHealth(): Promise<{ status: string }> {
  return requestJson<{ status: string }>("/health");
}

export async function fetchReceipts(): Promise<ReceiptRecord[]> {
  const data = await requestJson<ReceiptListResponse | ReceiptRecord[]>("/receipts");
  if (Array.isArray(data)) {
    return data;
  }
  return Array.isArray(data.receipts) ? data.receipts : [];
}

export async function fetchReceiptById(id: number): Promise<ReceiptRecord> {
  return requestJson<ReceiptRecord>(`/receipts/${id}`);
}

export async function updateReceipt(
  id: number,
  payload: ReceiptUpdatePayload,
): Promise<ReceiptRecord> {
  return requestJson<ReceiptRecord>(`/receipts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteReceipt(id: number): Promise<void> {
  await requestJson<void>(`/receipts/${id}`, {
    method: "DELETE",
  });
}

export function uploadReceipt(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ReceiptRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // Reserve 70%-100% for server-side OCR & extraction.
        const uploadPct = Math.round((event.loaded / event.total) * 70);
        onProgress(Math.min(70, uploadPct));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        try {
          resolve(JSON.parse(xhr.responseText) as ReceiptRecord);
        } catch {
          reject(new ApiError("Received invalid JSON from server.", xhr.status));
        }
        return;
      }

      let message = `Upload failed (${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (typeof parsed?.detail === "string") message = parsed.detail;
      } catch {
        // Ignore non-JSON error bodies.
      }
      reject(new ApiError(message, xhr.status));
    };

    xhr.onerror = () => {
      reject(
        new ApiError(
          `Network error while uploading to ${API_BASE_URL}. Ensure the FastAPI backend is running.`,
          0,
        ),
      );
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
