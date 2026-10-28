"use client";
import { useEffect, useState } from "react";

type Product = { id: string; sku: string; name: string; list_price: number; uom: string | null; uom_options?: string[] };
type Customer = { id: string; account_no: string; name: string; tier: string | null };

export function QuoteForm({ currency }: { currency: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [uom, setUom] = useState("");
  const [qty, setQty] = useState(1);
  const [discountPct, setDiscountPct] = useState(0);
  const [rebatePct, setRebatePct] = useState(0);
  const [accessory, setAccessory] = useState(0);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([fetch("/api/products").then(response => response.json()), fetch("/api/customers").then(response => response.json())])
      .then(([productResult, customerResult]) => {
        const nextProducts = productResult.data || [];
        setProducts(nextProducts);
        setCustomers(customerResult.data || []);
        if (nextProducts[0]) {
          setProductId(nextProducts[0].id);
          setUom(nextProducts[0].uom || nextProducts[0].uom_options?.[0] || "");
        }
        if (customerResult.data?.[0]) setCustomerId(customerResult.data[0].id);
      })
      .catch(() => setError("Products or customers could not be loaded. Refresh the page to try again."));
  }, []);

  const selectedProduct = products.find(product => product.id === productId);
  const uomOptions = selectedProduct?.uom_options?.length ? selectedProduct.uom_options : selectedProduct?.uom ? [selectedProduct.uom] : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResult("");
    setBusy(true);
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, lines: [{ productId, qty, uom: uom || undefined, discountPct, rebatePct, accessory }] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Quote could not be created.");
      setResult(data.data.zone === "red"
        ? "This quote is below the walk-away limit and was blocked."
        : `Quote ${data.data.id} created · ${data.data.zone} guardrail${data.data.headroom !== undefined ? ` · ${data.data.headroom.toFixed(1)} points above walk-away` : ""}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Quote could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="app-form" style={{ maxWidth: "none" }} onSubmit={submit}>
    <div className="quote-input-grid">
      <div className="field"><label htmlFor="quote-customer">Customer</label><select className="input" id="quote-customer" required value={customerId} onChange={event => setCustomerId(event.target.value)}>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.account_no}</option>)}</select></div>
      <div className="field"><label htmlFor="quote-product">Product</label><select className="input" id="quote-product" required value={productId} onChange={event => { const next = products.find(product => product.id === event.target.value); setProductId(event.target.value); setUom(next?.uom || next?.uom_options?.[0] || ""); }}>{products.map(product => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></div>
      <div className="field"><label htmlFor="quote-uom">Unit</label><select className="input" id="quote-uom" required value={uom} onChange={event => setUom(event.target.value)}>{uomOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></div>
      <div className="field"><label htmlFor="quote-qty">Qty ({uom || "unit"})</label><input className="input" id="quote-qty" min="0.0001" step="0.0001" type="number" value={qty} onChange={event => setQty(Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="quote-discount">Discount %</label><input className="input" id="quote-discount" min="0" max="100" step="0.1" type="number" value={discountPct} onChange={event => setDiscountPct(Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="quote-rebate">Rebate %</label><input className="input" id="quote-rebate" min="0" max="100" step="0.1" type="number" value={rebatePct} onChange={event => setRebatePct(Number(event.target.value))} /></div>
      <div className="field"><label htmlFor="quote-accessory">Accessory ({currency})</label><input className="input" id="quote-accessory" min="0" step="0.01" type="number" value={accessory} onChange={event => setAccessory(Number(event.target.value))} /></div>
    </div>
    <button className="primary" disabled={busy || !products.length || !customers.length}>{busy ? "Checking margin…" : "Check and create quote"}</button>
    {error && <p role="alert" className="form-message error">{error}</p>}{result && <p role="status" className="form-message success">{result}</p>}
    <p className="small muted">The server converts the selected unit and recalculates costs effective on today’s date. It selects the approved price and ignores client-sent prices, margins, and zones.</p>
  </form>;
}
