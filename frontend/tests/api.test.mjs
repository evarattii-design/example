import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

const SAMPLE_RECEIPT = {
  id: 1,
  filename: "coffee.png",
  merchant_name: "Blue Bottle",
  date: "2026-11-24",
  total_amount: 14.75,
  status: "Processed",
  error_message: null,
  extracted_json: {
    merchant_name: "Blue Bottle",
    date: "2026-11-24",
    line_items: [{ name: "Latte", price: 6.5 }],
    subtotal: 11.75,
    tax: 1.0,
    tip: 2.0,
    total_amount: 14.75,
    uncertain_fields: [],
    warnings: [],
  },
  created_at: "2026-11-25T12:00:00Z",
};

test("frontend API client integrates with FastAPI endpoints and handles errors", async () => {
  let deleted = false;
  let stored = { ...SAMPLE_RECEIPT };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.url === "/receipts" && req.method === "GET") {
      const list = deleted ? [] : [stored];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ total: list.length, receipts: list }));
      return;
    }

    if (req.url === "/receipts/1" && req.method === "GET") {
      if (deleted) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Receipt 1 not found." }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stored));
      return;
    }

    if (req.url === "/receipts/1" && req.method === "PUT") {
      const patch = JSON.parse(bodyText);
      stored = { ...stored, ...patch };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stored));
      return;
    }

    if (req.url === "/receipts/1" && req.method === "DELETE") {
      deleted = true;
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_API_URL = baseUrl;

  try {
    const api = await import(`../src/lib/api.ts?test=${Date.now()}`);

    const health = await api.checkHealth();
    assert.deepEqual(health, { status: "ok" });

    const list = await api.fetchReceipts();
    assert.equal(list.length, 1);
    assert.equal(list[0].merchant_name, "Blue Bottle");

    const one = await api.fetchReceiptById(1);
    assert.equal(one.total_amount, 14.75);

    const updated = await api.updateReceipt(1, { total_amount: 15.25 });
    assert.equal(updated.total_amount, 15.25);

    await api.deleteReceipt(1);
    await assert.rejects(
      () => api.fetchReceiptById(1),
      (err) => err instanceof api.ApiError && err.status === 404,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
