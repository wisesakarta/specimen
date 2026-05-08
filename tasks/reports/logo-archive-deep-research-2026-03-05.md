# LogoArchive Deep Reverse Engineering Report (2026-03-05)

## Scope
Tujuan riset ini: membongkar arsitektur `https://www.logo-archive.org/`, memetakan API, menilai batas akses dataset, dan menyusun strategi cloning dataset secara menyeluruh. Output ini markdown-only (tanpa implementasi scraper di codebase aplikasi).

## Executive Summary
- Frontend: Next.js static export style dengan build id `CGiPmfRp_JwWNZ4YeMBOB`.
- API backend utama: `https://la-api-7bmm.onrender.com`.
- Auth model: bearer token Firebase ID token (`Authorization: Bearer <idToken>`).
- Endpoint publik (tanpa login) yang terverifikasi:
  - `GET /v2/feed/preview` -> 200 (144 item)
  - `GET /v2/feed/trending` -> 200 (400 item)
- Endpoint inti dataset penuh bersifat protected:
  - `GET /v2/feed?page=<n>` -> 401 tanpa token
  - `GET /v2/designers?sort=<...>` -> 401 tanpa token
  - `GET /v2/search?...` -> 401 tanpa token
  - `GET /v2/items/private/<slug>` -> protected (dipanggil dari halaman detail internal)
- Estimasi skala penuh dari source frontend: klaim akses `5000+ logos` berada di layer plan/subscription.

## Methodology (Deep RE)
1. Static artifact collection
- Download HTML homepage, script src, build manifest, dan seluruh page chunks.
- Expand chunk JS (semi-pretty) untuk extraction endpoint `/v2/*`.

2. Runtime browser instrumentation (injection/manipulation)
- Script injection dilakukan di runtime browser untuk:
  - inspeksi `__NEXT_DATA__`, storage keys, script tree
  - monkey-patch `window.fetch` lalu trigger request manual endpoint API
- Hasil injeksi runtime (terverifikasi):
  - `preview` -> 200
  - `trending` -> 200
  - `feed?page=1` -> 401

3. Network trace validation
- DevTools request inspection mengonfirmasi cross-origin API calls ke `la-api-7bmm.onrender.com`.
- CORS terbuka (`access-control-allow-origin: *`) namun endpoint tetap dikunci via auth middleware untuk route tertentu.

## Site Fingerprint
- Domain: `www.logo-archive.org`
- Build ID: `CGiPmfRp_JwWNZ4YeMBOB`
- Routes (dari build manifest):
  - `/`, `/trending`, `/search`, `/designers`, `/designers/[id]`, `/p/[id]`, `/library`, `/library/collections`, `/auth/login`, `/auth/sign-up`, `/auth/forgot-password`
- API host hardcoded (bundle): `https://la-api-7bmm.onrender.com`

## Auth and Access Model
Dari chunk `_app`:
- HTTP client wrapper memasang header bearer token Firebase saat request mode protected.
- Ada flag internal `{ protected: false }` untuk request tertentu (tidak mengirim bearer).
- Enum akses yang ditemukan:
  - `VALID`, `EXPIRING`, `EXPIRED`, `ABORTED_CHECKOUT`, `INVALID`
- Gating UI:
  - beberapa page feature di-enable hanya saat status `VALID` atau `EXPIRING`.

## Endpoint Inventory (Observed)

### Publicly reachable (no auth)
- `GET /v2/feed/preview`
  - Status: 200
  - Count: 144 item
  - Field dominan: `slug`, `itemType`, `logoOptimized`, `containedLetters`, `additionalKeywords`, `meta`, `updatedAt`
- `GET /v2/feed/trending`
  - Status: 200
  - Count: 400 item
  - Field dominan: `itemId`, `slugId`, `slug`, `client`, `logo`, `logoOptimized`, `categories`, `tags`, `designers`, `industry`, `country`, `publishedYear`, `createdAt`, `updatedAt`

### Protected / requires authenticated bearer
- `GET /v2/feed?page=<n>` -> 401 tanpa login
- `GET /v2/designers?sort=<popular|a-z|z-a>` -> 401 tanpa login
- `GET /v2/search?<facet>=<term>` -> 401 tanpa login
- `GET /v2/search/autocomplete` -> 401 tanpa login
- `GET /v2/users/account/<email>` -> 401 tanpa login
- `GET /v2/items/private/<slug>` -> protected
- Bookmark/library write paths (`/v2/bookmarks/...`) -> protected
- Billing paths (`/v2/users/billing/*`) -> protected

### Firebase/Auth service endpoints found in bundle
- `/v2/recaptchaConfig`
- `/v2/passwordPolicy`
- `/v2/accounts:revokeToken`
- `/v2/accounts/mfaEnrollment:*`
- `/v2/accounts/mfaSignIn:*`

## Dataset Quality Snapshot (Public surface)

### Preview dataset
- Total: 144
- `logoOptimized` non-empty: 144/144
- `publicSlug` non-empty: 0/144
- `publicImageUrl` non-empty: 0/144

### Trending dataset
- Total: 400
- `logo` non-empty: 400/400
- `logoOptimized` non-empty: 400/400
- `client` non-empty: 400/400
- `categories` non-empty: 400/400
- `tags` non-empty: 397/400
- `designers` non-empty: 400/400
- `country` non-empty: 400/400
- `publishedYear` non-empty: 400/400

### Overlap
- `preview.slug` vs `trending.slug` overlap: 0
- Artinya public surface saat ini memberi dua subset berbeda (total unik 544 record dari dua endpoint publik).

## Why Full Dataset Is Not Fully Extracted Yet
Indikasi kuat dataset penuh > public surface:
- Plan copy di bundle menyebut akses `5000+ logos`.
- Endpoint paginated feed utama (`/v2/feed?page=`) locked (401) tanpa token.
- Endpoint detail private item (`/v2/items/private/<slug>`) juga locked.

Kesimpulan: cloning 100% dataset memerlukan autentikasi akun yang valid (dan sangat mungkin langganan aktif untuk data lengkap).

## Full Clone Playbook (Legitimate Auth Path)

1. Login normal di website (akun yang sah)
- Ambil Firebase ID token dari sesi browser (bukan bypass).

2. Dump paginated feed utama
```bash
# pseudocode curl
curl -H "Authorization: Bearer <ID_TOKEN>" "https://la-api-7bmm.onrender.com/v2/feed?page=1"
```
Loop page sampai respons kosong/stop condition.

3. Enrich dataset
- Query designers: `/v2/designers?sort=popular`, `a-z`, `z-a`
- Query search facets jika diperlukan: `/v2/search?<facet>=<value>`
- Query detail tiap slug jika endpoint mengembalikan referensi private item:
  - `/v2/items/private/<slug>`

4. Normalize and dedupe
- Kunci dedupe utama: `itemId` (fallback `slug`).
- Simpan ke JSONL + index metadata (counts, checksum, crawl timestamp).

## Risks and Caveats
- Endpoint semantics bisa berubah karena app berbasis API eksternal Render + Next build rolling updates.
- Beberapa route menampilkan UI static export, sementara data real-time seluruhnya ditarik client-side.
- `publicSlug` mayoritas kosong pada sampel publik, sehingga route `/p/[id]` tidak dapat dijadikan primary crawler untuk full dump.

## Evidence Artifacts (local)
- `tasks/reports/logo-archive/build-manifest.js`
- `tasks/reports/logo-archive/app-chunk-key-lines.txt`
- `tasks/reports/logo-archive/designers-key-lines.txt`
- `tasks/reports/logo-archive/search-key-lines.txt`
- `tasks/reports/logo-archive/trending-key-lines.txt`
- `tasks/reports/logo-archive/login-key-lines.txt`
- `tasks/reports/logo-archive/signup-key-lines.txt`
- `tasks/reports/logo-archive/extracted-v2-all-unique.txt`
- Raw chunk corpus:
  - `tasks/reports/logo-archive/chunks-semi/`
  - `tasks/reports/logo-archive/all-chunks-semi/`

## Final Conclusion
- Reverse engineering berhasil mengungkap arsitektur, auth model, dan API map.
- Dataset publik yang dapat diambil langsung saat ini: **544 unique records** (`144 preview + 400 trending`, no overlap).
- Untuk benar-benar memperoleh **seluruh** dataset LogoArchive, jalur yang valid adalah menjalankan clone melalui endpoint protected dengan bearer token akun resmi (dan kemungkinan subscription aktif).
