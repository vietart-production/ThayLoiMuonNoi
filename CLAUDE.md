# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Split deployment, two different origins:

- **Frontend** — `index.html`, `dat-don.html`, `freelancer.html`, `admin.html`, `report.html`, `assets/` — deployed to **Firebase Hosting** (`firebase deploy --only hosting`) at https://thayloimuonnoi-8d725.web.app. `firebase.json`'s `ignore` list keeps backend files (`server.js`, `src/**`, `package*.json`, docs) out of that deploy — the repo root doubles as both the hosting public dir and the backend's working dir, so don't assume everything at root is frontend-servable.
- **Backend** — `server.js`/`src/`, Node/Express + Firestore (`firebase-admin`) + payOS (`@payos/node`), deployed to **Render** (API-only, no static serving) at https://thayloimuonnoi.onrender.com, auto-deploys on push to `main`. CORS is locked to the Firebase Hosting origins (`server.js`) — a frontend change that needs a new origin (custom domain, etc.) means updating that list too.

`assets/api-client.js` calls the Render API by **absolute URL** (`API_BASE_URL` constant) since the two are cross-origin now — don't revert that to a relative `/api/...` path. payOS's `returnUrl`/`cancelUrl` (`src/payos.js`) come from `PUBLIC_BASE_URL`, which must point at the Firebase Hosting URL, not Render.

`assets/mock-backend.js` (localStorage-only fake backend) is no longer wired into any page — it's dead code kept around for reference, not a fallback. Don't resurrect it; if something needs fixing, fix the real path (`src/db.js` server-side, or the page's own `<script type="module">` client-side).

`assets/firebase-config.js` holds the public Firebase web config (safe to commit, unlike the server-side service account) — fill in real values there, not inline in pages.

## What this project is

"Thay Lời Muốn Nói" is a two-sided Vietnamese marketplace: a buyer pays a freelancer to place a phone call on the buyer's behalf, delivering a spoken message (confession, apology, congratulations, etc.) to a third party ("callee") who is not a user of the platform. Freelancers list their phone number and a voice demo; pricing is driven by word count, call duration, speaking speed, requested emotion, the freelancer's carrier per-minute rate, and desired call time.

[DECISIONS.md](DECISIONS.md) is the living spec/decision log, written in Vietnamese, kept so work can resume from a different machine with full context. It distinguishes decisions already locked in from points still open — **read it before making any product/business-logic change**, especially §5 (escrow/evidence state machine) and §8 (open items), since several things in the fake backend are explicitly-flagged placeholders (commission %, confirm timeout hours, admin passcode) rather than real decisions.

## Pages

- `index.html` — Noel-themed marketing landing page. Has its own illustrative price calculator (separate inline JS, not wired to real orders) — don't conflate it with the real pricing logic in `src/db.js` (`calcPrice`).
- `dat-don.html` — buyer flow: browse freelancers, write a script, pay from wallet (escrow via payOS), confirm/dispute/rate after the call.
- `freelancer.html` — freelancer flow: self-rated profile, handle assigned orders, request withdrawals.
- `admin.html` — CSKH/admin: script moderation, dispute resolution, withdrawal approval, callee reports. Access is gated server-side by `ADMIN_PHONE_NUMBERS` (an env var on Render, checked in `src/authMiddleware.js`'s `requireAdmin`) — there's no separate admin login UI, just the same Firebase phone sign-in as everyone else.
- `report.html` — public, no-login form for a callee (the person who received a call) to report it.

## Working in this repo

- `src/db.js` is the single source of truth for business logic and the order state machine — it's a direct Firestore port of what used to be `assets/mock-backend.js`'s `TLMN.Order.*`, using `db.runTransaction` for anything that checks a balance before moving money (order creation, withdrawals). `src/routes.js` exposes it over HTTP and is also where request authorization lives (`assertOrderParty` checks the caller actually owns the order before letting them act on it) — don't move that check client-side.
- `assets/api-client.js` (frontend) mirrors `src/routes.js`'s endpoints 1:1 — add a method there when you add a route, matching names.
- `assets/firebase-client.js` currently uses a **temporary simulated OTP** (hands the code back instead of texting it, then mints a Firebase custom token — see DECISIONS.md §12) because real Phone Auth needs the Blaze plan. It still exposes the same `mountAuthWidget(el, onLogin)` that all four callers use — the three logged-in pages mount it in place of their content, and `index.html` mounts it inside a header dialog. That widget also owns the `#userBox` header slot: it fills it with the phone number and a sign-out button when signed in, and with a "Đăng nhập" button when not, but only on pages whose `#userBox` carries `data-login="<dialog id>"` (just `index.html` — the app pages have nowhere to send anyone, their whole body is the login form). There is deliberately no `login.html`, and `getIdToken()` still returns a real Firebase ID token either way — `api-client.js` and `authMiddleware.js` don't know or care which path produced it. `/api/wallet/topup-link` similarly auto-credits instead of waiting for payOS's webhook (DECISIONS.md §13). Both are called out loudly in code comments — don't mistake either for the real thing, and don't build more features on top of the assumption that money or identity here is real yet.
- Edit [DECISIONS.md](DECISIONS.md) directly for any product/spec change; keep it in Vietnamese and follow its existing conventions: numbered `##` sections, bold for locked-in terms, `[CHƯA CHỐT]` inline markers for things explicitly not yet decided, and the `- [ ]` checklist in §8 for open items.
- The document's value is in separating settled decisions from open ones — when resolving something, fold it into the relevant numbered section (and cite the reasoning, as the existing entries do) rather than just deleting the open item.
- `npm run selftest` runs [snow.selftest.js](snow.selftest.js), which extracts the snow block from `index.html` and asserts the flakes actually fall. That effect broke three times without the source ever looking wrong, so run it after touching the canvas code — and note `firebase.json` has to keep ignoring `*.selftest.js`, since `public: "."` would otherwise publish test files to the live site.
- No frontend build step: edit HTML/CSS/JS directly. The backend only needs `npm install`; `npm start` runs it locally (needs a real or fake Firebase credential per `.env.example`, same as Render).
