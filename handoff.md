# Session Handoff — Institutional Certification & Credential System

## Context

Implementing a comprehensive institutional certification and professional credential management system for Cofoundr Academy at `/root/academy-vesk`, integrating Certificate of Completion (CoC), CPSP, CACV, and CPR into the existing portal.

**Three credential systems:**
- CoC — permanent, never expires
- CPSP — 24-month validity
- CACV — 12-month validity
- Cofoundr Professional Record (CPR) connecting all learner activities

## Background Work (Completed Before This Session)

- Database models extended: `CertificationModel` + 9 new columns; 3 new tables (`credential_config`, `credential_share_links`, `credential_share_access`); schema regenerated
- Backend services: `src/_lib/server/credentials.ts` (issue/renew/suspend/revoke/find/list), `src/_lib/server/cpr.ts` (CPR aggregation), `src/_lib/server/credential-lifecycle.ts` (automated expiration/notification engine 90/60/30/7/0 days)
- API routes: learner credentials, CPR, renew, share links, extended verification, admin credentials config/renewals/suspend-revoke
- Frontend: Credential Centre page (`/portal/credentials`), CPR page (`/portal/cpr`)
- Capabilities and route access rules updated; NavIcon and Sidebar updated
- Certificate data layer updated with category-specific title, validity text, colors; PDF generator updated with category-specific designs (CoC/CPSP/CACV)
- Typecheck passes; Vesk build passes (before this session's edits broke cpr/page.vsk)
- Database tables and columns verified in dev SQLite DB

## What's Done (This Session)

1. **Certificate preview in credentials page** (`app/portal/credentials/page.vsk`):
   - Added preview state (`previewOpen`, `previewCredential`, `previewData`, `previewLoading`, `qrSvg`)
   - `openPreview()` fetches student record from `/api/student` and builds real `CertificateData`
   - `buildPreviewData()` fallback with placeholder data per category
   - `CertificatePreview` modal renders when `previewOpen && previewData`
   - "View Certificate" button wired in each credential card
   - `CertificatePreview` and `buildCertificateData`/`buildQrSvg`/`certificateFilename` imported

2. **Certificate data layer** (`src/_lib/certificate.ts`):
   - Added `CertificateCategory` type (`coc` | `cpsp` | `cacv` | `academy`)
   - Added `category`, `validityText`, `certificateTitle` to `CertificateData`
   - `buildCertificateData()` accepts `category` option and generates category-specific title/validity/expiry
   - `buildQrSvg()` now uses `vesk-qr` (`CofoundrMatrix.generate`) instead of `qrcode-generator`
   - Removed old `loadQr`/`qrModule` dynamic import

3. **PDF generator** (`src/_lib/server/pdf.ts`):
   - Replaced `qrcode-generator` import with `vesk-qr`
   - `drawQr()` uses `CofoundrMatrix.generate()` + `qr.getMatrix()`
   - `buildCertificatePdf()` uses category-specific accent colors (CoC=gold, CPSP=blue, CACV=orange)
   - Footer validity label uses `data.validityText` instead of hardcoded "VALID · EXPIRES"

4. **PDF route** (`app/api/certifications/[credentialId]/pdf/route.ts`):
   - Passes `category` via options to `buildCertificateData`

5. **Package install**: `vesk-qr` installed from `/root/vesk-libs/vesk-qr/vesk-qr-0.1.0.tgz` into `/root/academy-vesk/node_modules`

## What's Broken / Remaining

**Build is failing** on `app/portal/cpr/page.vsk`. Issues to fix:

- Line numbers have shifted due to edits. The compiler rejects statement-mode control flow (`for`/`if`) wrapped in `{}` inside JSX children, and inline `{if (cond) <jsx/>}` ternary-style expressions.
- Vesk statement mode rule: bare `for (...)` and `if (...)` without `{}` wrapping when they appear as JSX children/statements.
- Inline `{if (...)}` blocks inside JSX need to be bare statement-mode `if` blocks.
- Inline ternaries like `{cond ? <jsx/> : null}` inside JSX need to be bare `if` blocks.

**Next steps to fix build:**
1. Run `timeout 300 npm run build` from `/root/academy-vesk` to see the current error line
2. Fix any remaining `{for (` / `{if (` / `{if (...)}` / `}}` statement closings in both `app/portal/cpr/page.vsk` and `app/portal/credentials/page.vsk`
3. Re-run build until clean

**After build passes:**
- Rebuild packages: `cd /root/vesk && npx tsx packages/cli/src/build-packages.ts`
- Run typecheck: `cd /root/academy-vesk && npm run typecheck`
- Dev server: `cd /root/academy-vesk && npm run dev` (port may need `-p 3000`)
- E2E tests: `npm test` or `node tests/hydration-test.mjs`

**Key files currently modified:**
- `app/portal/credentials/page.vsk` — preview UI (partially done)
- `app/portal/cpr/page.vsk` — build broken (in progress of fixing)
- `src/_lib/certificate.ts` — category support + vesk-qr QR
- `src/_lib/server/pdf.ts` — category colors + vesk-qr QR
- `app/api/certifications/[credentialId]/pdf/route.ts` — category pass-through
- `package.json` / `package-lock.json` — added vesk-qr dependency

**Important:** All changes are uncommitted in `/root/academy-vesk`. Node v26.8.2 — no extensionless ESM imports.