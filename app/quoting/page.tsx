import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
export default function Page(){if (!legacyBusinessEnabled()) notFound();redirect("/legacy/quoting");}
