"use client";
export default function DashboardError({reset}:{reset:()=>void}){return <section className="app-card readiness"><h2>Dashboard unavailable</h2><p role="alert" className="import-issue">⚠ We could not load this workspace's dashboard. Retry, or ask the operator to check its database setup.</p><button type="button" className="primary" onClick={reset}>Retry dashboard</button></section>;}
