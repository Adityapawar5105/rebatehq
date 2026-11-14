# Supabase database trust anchor

Public certificate, not a credential. Downloaded on 14 November 2026 over HTTPS from Supabase's distribution bucket:

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

SHA-256 of the PEM file: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

Subject: `C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA`.

The Netlify function bundle includes this file. Configure the dedicated application connection with `sslmode=verify-full&sslrootcert=/var/task/certs/supabase-root-ca.crt`; this scopes the additional trust to Postgres, preserving certificate-chain and hostname verification. Test the packaged path on the hosted function before marking database access verified. Never disable verification to work around a certificate error. Fetch and review a replacement from the provider when it rotates its CA.

See [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement) and NETLIFY_DEPLOYMENT.md.
