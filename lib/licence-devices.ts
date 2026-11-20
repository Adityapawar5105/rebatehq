// Control-plane metadata only (audit B-5, 20 Nov 2026): how many devices wait for the workspace Owner's approval.
// It reads the licence device list, never business data; the vault screens call this instead of fetching themselves.
export async function waitingDevices(): Promise<number> {
  const response = await fetch("/api/licence/devices", { cache: "no-store" });
  if (!response.ok) return 0;
  const body = await response.json() as { data?: { status: string }[]; canApprove?: boolean };
  return body.canApprove ? (body.data ?? []).filter(d => d.status === "pending").length : 0;
}
