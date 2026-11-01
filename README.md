# Heavy Soul

Storefront (static) + Cloudflare Worker API.

    public/    site files served to visitors (html, js/, css/, assets/)
    src/       Worker (index.js, lib/*)  - never public
    docs/      setup notes - never public
    _review/   old unused scripts, check and delete
    wrangler.jsonc

Deploy: `npx wrangler deploy` (or push to GitHub, Cloudflare builds it).
Secrets: `npx wrangler secret put NAME`. Never put key values in this repo.
