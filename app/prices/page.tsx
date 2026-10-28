import { databaseContext } from "@/lib/context";
import { AppFrame } from "@/components/AppFrame";
import { requireAppPageContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
export const dynamic = "force-dynamic";
const money = (value: unknown, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
export default async function PricesPage() {
  const context = await requireAppPageContext();
  const data = await withDatabase(databaseContext(context), async db => {
    const products = (await db.query(`SELECT id,sku,name,category,supplier,uom,list_price,tier_prices${can(context.role,"costs.read")?",unit_cost,freight_cost,payment_terms_cost":""} FROM product WHERE tenant_id=$1 AND active=true ORDER BY sku LIMIT 1000`, [context.tenantId])).rows;
    const versions = (await db.query("SELECT id,version_no,status,source_name,created_at FROM price_list_version WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30", [context.tenantId])).rows;
    return { products, versions };
  });
  return <AppFrame context={context}><div className="page-head"><div><h1>Price lists</h1><p>Catalog and approved price history for this workspace.</p></div><span className="status-chip">{data.products.length} active products</span></div>
    <section className="app-card"><h2>Product pricing</h2><p className="small muted">Role-based visibility. Quote prices are recalculated on the server when a quote is created.</p>{data.products.length ? <div className="data-table"><table><thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Supplier</th><th>List price</th>{can(context.role,"costs.read")&&<><th>Unit cost</th><th>Freight</th><th>Terms cost</th></>}</tr></thead><tbody>{data.products.map((p:any)=><tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.category}</td><td>{p.supplier||"—"}</td><td>{money(p.list_price,context.currency)}</td>{can(context.role,"costs.read")&&<><td>{money(p.unit_cost,context.currency)}</td><td>{money(p.freight_cost,context.currency)}</td><td>{money(p.payment_terms_cost,context.currency)}</td></>}</tr>)}</tbody></table></div> : <p className="muted">No products yet. Load demo data or import your prototype export from Data migration & export.</p>}</section>
    <section className="app-card"><h2>Published price history</h2>{data.versions.length ? <div className="data-table"><table><thead><tr><th>Version</th><th>Status</th><th>Source</th><th>Created</th></tr></thead><tbody>{data.versions.map((v:any)=><tr key={v.id}><td>v{v.version_no}</td><td>{v.status}</td><td>{v.source_name||"Manual update"}</td><td>{new Date(v.created_at).toLocaleDateString("en-US")}</td></tr>)}</tbody></table></div> : <p className="muted">No price-list versions have been imported.</p>}</section>
  </AppFrame>;
}
