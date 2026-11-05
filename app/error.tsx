"use client";
import { t, useLocale } from "@/lib/i18n";
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){useLocale();return <main className="app-content"><section className="app-card"><h1>{t("page.error.weCouldnTLoad")}</h1><p className="muted">{t("page.error.yourDataWasNot")}</p><button className="primary" onClick={reset}>{t("page.error.tryAgain")}</button></section></main>}
