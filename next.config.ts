import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  // The restricted database login verifies Supabase's certificate from this file (sslrootcert=/var/task/certs/...).
  // Netlify ships it through netlify.toml included_files; this ships it on Vercel and any other Node host.
  outputFileTracingIncludes: { "/**": ["./certs/supabase-root-ca.crt"] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
      ]
    }, {
      // The engine files (worker, DuckDB-Wasm) are same-origin only, as netlify.toml sets for Netlify.
      source: "/spike/:path*",
      headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }]
    }];
  }
};

export default nextConfig;
