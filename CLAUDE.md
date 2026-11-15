# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository currently contains a single document, [DECISIONS.md](DECISIONS.md) — there is no source code, package manifest, build system, or test suite yet, and this directory is not a git repository. Treat this as a pre-implementation spec/decision-log repo, not a codebase.

Do not assume any language, framework, or tooling. If asked to start building the actual application, ask which stack to use before scaffolding anything — there's nothing in the repo to infer it from.

## What this project is

"Thay Lời Muốn Nói" is a planned two-sided Vietnamese marketplace: a buyer pays a freelancer to place a phone call on the buyer's behalf, delivering a spoken message (confession, apology, congratulations, etc.) to a third party ("callee") who is not a user of the platform. Freelancers list their phone number and a voice demo; pricing is driven by word count, call duration, speaking speed, requested emotion, the freelancer's carrier per-minute rate, and desired call time.

[DECISIONS.md](DECISIONS.md) is the living spec/decision log, written in Vietnamese, kept so work can resume from a different machine with full context. It distinguishes decisions already locked in from points still open. Current state, by section:

- **§1-2 Model & pricing** — the three roles (freelancer/buyer/callee) and the pricing formula (floor rate 1.000đ per 20 characters, plus variable fees for duration/speed/emotion/carrier rate/timing). Freelancers absorb their own call cost.
- **§3-4 Financial architecture (locked in)** — buyer top-ups go through payOS (VietQR) automatically; orders escrow funds on creation; freelancer **withdrawals are manual**: freelancer submits bank account + account-holder name, admin reviews and transfers by hand (payOS's disbursement API isn't confirmed to support paying out to many recipients). No document-based KYC — phone+OTP at signup plus the bank account at withdrawal time serve as the real-identity anchor; account suspension is the top-level penalty.
- **§5 Evidence & order closing** — call recording is the default evidence; closing requires explicit buyer confirmation; recordings are deleted as soon as an order closes. **Open gap, flagged but not resolved**: no auto-confirm timeout exists yet for a buyer who never responds (proposed 48h, not finalized) — without it, escrowed funds can get stuck forever.
- **§6 Legal position** — project owner's stated position on call-recording legality and the no-ID-KYC approach, plus known-but-unsolved risks: no report/block channel for callees, no concrete banned-content list for script moderation.
- **§7 Market research** — no direct competitor found combining voice + "lucky number" + per-character/emotion pricing for personal/emotional use cases.
- **§8 Open items** — running checklist of unresolved decisions (auto-confirm timeout value, payOS disbursement capability, banned-content list, callee report/block design).

## Working in this repo

- Edit [DECISIONS.md](DECISIONS.md) directly for any product/spec change; keep it in Vietnamese and follow its existing conventions: numbered `##` sections, bold for locked-in terms, `[CHƯA CHỐT]` inline markers for things explicitly not yet decided, and the `- [ ]` checklist in §8 for open items.
- The document's value is in separating settled decisions from open ones — when resolving something, fold it into the relevant numbered section (and cite the reasoning, as the existing entries do) rather than just deleting the open item.
