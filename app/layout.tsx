import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./theme.css";
import "./globals.css";
import { serverT } from "@/lib/i18n/server";
import { THEME_COOKIE, isTheme } from "@/lib/ui/theme";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("app.name"), description: t("app.description") };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = await serverT(), theme = (await cookies()).get(THEME_COOKIE)?.value;
  // "system" (no attribute) follows the operating system's light or dark setting.
  return <html lang={t.lang} data-theme={isTheme(theme) && theme !== "system" ? theme : undefined}><body>{children}</body></html>;
}
