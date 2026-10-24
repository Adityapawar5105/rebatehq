import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarginDesk",
  description: "Secure pricing, quote guardrails, and rebate review for distributors."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
