# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This is a static, build-step-free HTML/CSS/JS site (Tailwind via CDN, no bundler, no package manifest). There is a fake backend (`assets/mock-backend.js`) backed by `localStorage` — no real server, no real payment, SMS, or telephony integration anywhere yet. Treat anything persisted here as per-browser demo data, not real state.

## What this project is

"Thay Lời Muốn Nói" is a two-sided Vietnamese marketplace: a buyer pays a freelancer to place a phone call on the buyer's behalf, delivering a spoken message (confession, apology, congratulations, etc.) to a third party ("callee") who is not a user of the platform. Freelancers list their phone number and a voice demo; pricing is driven by word count, call duration, speaking speed, requested emotion, the freelancer's carrier per-minute rate, and desired call time.

[DECISIONS.md](DECISIONS.md) is the living spec/decision log, written in Vietnamese, kept so work can resume from a different machine with full context. It distinguishes decisions already locked in from points still open — **read it before making any product/business-logic change**, especially §5 (escrow/evidence state machine) and §8 (open items), since several things in the fake backend are explicitly-flagged placeholders (commission %, confirm timeout hours, admin passcode) rather than real decisions.

## Pages

- `index.html` — Noel-themed marketing landing page. Has its own illustrative price calculator (separate JS, not wired to real orders) — don't conflate it with the real pricing logic in `assets/mock-backend.js`.
- `dat-don.html` — buyer flow: browse freelancers, write a script, pay from wallet (escrow), confirm/dispute/rate after the call.
- `freelancer.html` — freelancer flow: self-rated profile, handle assigned orders, request withdrawals.
- `admin.html` — CSKH/admin: script moderation, dispute resolution, withdrawal approval, callee reports. Gated by a hardcoded passcode (`assets/mock-backend.js`, `ADMIN_PASSCODE`) — demo only.
- `report.html` — public, no-login form for a callee (the person who received a call) to report it.

## Working in this repo

- `assets/mock-backend.js` is the single source of truth for business logic and the order state machine (`TLMN.Order.*`). Every `TLMN.*` function is written to be swapped for a real `fetch()` call later without changing its name or signature — keep that contract when editing it. It has a manual self-check, `TLMN._selfTest()`, callable from the browser console (not run automatically — it writes demo data into the live `localStorage` DB).
- Edit [DECISIONS.md](DECISIONS.md) directly for any product/spec change; keep it in Vietnamese and follow its existing conventions: numbered `##` sections, bold for locked-in terms, `[CHƯA CHỐT]` inline markers for things explicitly not yet decided, and the `- [ ]` checklist in §8 for open items.
- The document's value is in separating settled decisions from open ones — when resolving something, fold it into the relevant numbered section (and cite the reasoning, as the existing entries do) rather than just deleting the open item.
- No build step: edit HTML/CSS/JS files directly and open them in a browser (or a simple static server) to see changes; there is nothing to `npm install` or compile.
