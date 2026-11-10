// Chunk 8C-2: the installable desktop app. Install metadata only; the colours here are the browser's title bar and
// splash, outside the product's themed CSS. start_url is the signed-in app; offline it opens from the service worker's
// stored shell (public/sw.js), and the vault on this device.
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RebateHQ", short_name: "RebateHQ", description: "Local-first pricing, quoting and rebate control for distributors.",
    id: "/home", start_url: "/home", scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "#075e6d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
