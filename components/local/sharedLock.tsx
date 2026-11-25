"use client";
// Team sharing S3c: on a receiving seat, the buttons that would write data the publisher shares are disabled before they
// are pressed, with the reason as their tooltip. The same rule (lib/sharing/governed.ts lockedPacks) makes the worker
// refuse the command, so a stale screen can never get round it.
import { createContext, useContext, type ReactNode } from "react";
import { lockedPacks, type SharedLock } from "@/lib/sharing/governed";
import { t } from "@/lib/i18n";
import type { Action } from "@/lib/vault/protocol";

const Ctx = createContext<SharedLock>(null);
export function SharedLockProvider({ value, children }: { value: SharedLock | undefined; children: ReactNode }) { return <Ctx.Provider value={value ?? null}>{children}</Ctx.Provider>; }

/** Returns why a command is read-only on this seat (for `title`), or null when it is allowed. */
export function useSharedLock() {
  const held = useContext(Ctx);
  return (action: Action, fileRoles: readonly (string | null | undefined)[] = []): string | null => {
    const hit = lockedPacks(action, held, fileRoles)[0];
    return hit && held ? t("share.readOnlyHint", { name: held.packs[hit] }) : null;
  };
}
