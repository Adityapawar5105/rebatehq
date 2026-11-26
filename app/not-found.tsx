import Link from "next/link";
import { serverT } from "@/lib/i18n/server";
export default async function NotFound(){const t=await serverT();return <main className="app-content"><section className="app-card"><h1>{t("page.notFound.pageNotFound")}</h1><p className="muted">{t("page.notFound.thisPageMayHave")}</p><Link href="/">{t("page.notFound.returnToDashboard")}</Link></section></main>}
