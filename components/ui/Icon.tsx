// In-house icon set (chunk 7V): 24x24 stroke icons drawn for RebateHQ, no icon font or CDN.
// Icons are decorative (aria-hidden) unless a label is passed; the visible text next to them names the action.
import type { SVGProps } from "react";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  chart: "M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3m4 3V6",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01",
  quote: "M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v5h5M8.5 13h7M8.5 17h5",
  report: "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 13v-3m4 3V9m4 7v-5",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.3-4.3",
  lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm2 0V7a4 4 0 1 1 8 0v4",
  shield: "M12 3 4 6v6c0 4.6 3.4 8.2 8 9 4.6-.8 8-4.4 8-9V6zm-3 9 2 2 4-4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 2.8 2.8L16 9.5",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  alert: "M12 3 2 20h20zm0 6v5m0 3h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9h.01",
  close: "M6 6l12 12M18 6 6 18",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-1a6 6 0 0 1 12 0v1m2-10a3 3 0 1 0 0-6m4 16v-1a5 5 0 0 0-3-4.6",
  key: "M15 9a6 6 0 1 0-6 6c.8 0 1.6-.2 2.3-.5L13 16h2v2h2v2h4v-3.5l-6.5-6.5c.3-.7.5-1.5.5-2.3ZM8 10h.01",
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  download: "M12 4v12m0 0-5-5m5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  trend: "M3 17 9 11l4 4 8-8m0 0h-6m6 0v6",
  coins: "M9 10c3.9 0 7-1.3 7-3s-3.1-3-7-3-7 1.3-7 3 3.1 3 7 3Zm-7-3v5c0 1.7 3.1 3 7 3m-7-3v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-1m-2-5c3.3.2 6 1.4 6 3s-3.1 3-7 3",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z",
  sparkle: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5m-5 5h12",
  palette: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3.5 3H16a2 2 0 0 0-1.4 3.4A1.6 1.6 0 0 1 12 21ZM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01",
  sidebar: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm5 0v16",
  flask: "M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7.5 15h9",
} as const;
export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 18, label, ...rest }: { name: IconName; size?: number; label?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} focusable="false" {...rest}><path d={PATHS[name]}/></svg>;
}
