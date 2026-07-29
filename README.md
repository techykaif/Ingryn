
# INGRYN — Product Requirements Document

**Version:** 2.4
**Date:** July 2026
**Status:** Active Development
**Platform:** iOS + Android (React Native / Expo)
**Last Updated:** July 2026 — Documented two feature systems that shipped without a corresponding PRD update: the Real-Time Ingredient Detection System (RTIDS — live auto-scan with confidence overlay) and the device-tracking anti-abuse system; corrected two stale status rows (Google OAuth and OCR review-before-analysis were both already done, but still showed 🔲 Pending); corrected a false claim that `.env.example` had been added (it hasn't — verified absent from the live repo); logged this session's RTIDS refinement pass (torch/flash fix, preview-frame cache cleanup, adaptive frame rate, continuous confidence-based overlay colour, guide-box text confinement) as written but **not yet pushed**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals &amp; Success Metrics](#3-goals--success-metrics)
4. [User Personas](#4-user-personas)
5. [Competitive Landscape](#5-competitive-landscape)
6. [Product Scope](#6-product-scope)
7. [Feature Requirements](#7-feature-requirements)
8. [Screen Specifications](#8-screen-specifications)
9. [Technical Architecture](#9-technical-architecture)
10. [Data Models &amp; Database Schema](#10-data-models--database-schema)
11. [API Specifications](#11-api-specifications)
12. [Monetization Model](#12-monetization-model)
13. [Non-Functional Requirements](#13-non-functional-requirements)
14. [Release Phases](#14-release-phases)
15. [Open Questions &amp; Risks](#15-open-questions--risks)

---

## Changelog

| Version | Date      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | June 2026 | Initial PRD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.0     | June 2026 | Major update: Phase 1–3 complete, auth hardening, ingredient caching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.1     | June 2026 | UI overhaul complete: design system, Phosphor icons, Plus Jakarta Sans, light theme, dietary preferences fix, onboarding routing fix, signup bug fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2.2     | July 2026 | Data-integrity & hygiene pass: fixed`personal_flag` cross-user leakage (now computed client-side only, never persisted to shared cache), removed the 4 remaining `Alert.alert` calls (history delete, account delete + error, signup verification message) via a new `ConfirmDialog` component, confirmed Gemini calls fully migrated to a Supabase Edge Function (no client-side API key), confirmed legal pages (Privacy/Terms) are live rather than placeholders, removed unused `lucide-react-native`/`nativewind`/`tailwindcss` dependencies, added a migration to drop the now-unused `personal_flag` column, and corrected several places where this document had drifted from the live repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.3     | July 2026 | Production-readiness pass: removed the 4-slide onboarding flow entirely — welcome screen is now the only landing screen for every signed-out user, new or returning; fixed the native splash screen auto-hiding before fonts/session were ready (was causing a blank/spinner flash on launch); removed the unused`RECORD_AUDIO` Android permission (no microphone code exists anywhere in the app); added a max input-length check to the `analyze-ingredients` Edge Function to block abuse/cost overruns on that public endpoint; added `.env.example`; confirmed no hardcoded secrets, no tracked `.env` files, and `npm audit`'s 11 moderate findings are all in build-only tooling (`@expo/config-plugins`/`xcode`/`uuid`), not runtime code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.4     | July 2026 | Documentation catch-up pass across two commits that shipped without updating this PRD (`feat: Add device tracking and fix Google Auth bug`, `changes made by antigravity`): documented the new **Real-Time Ingredient Detection System** (§7.9, §8.6, §9.7) — live camera auto-scan with a red→yellow→green confidence overlay built on a custom `DetectionEngine`/`CameraStateMachine`/`FuzzyMatcher`, no Fuse.js or other new dependency added; documented the new **device-tracking anti-abuse system** (§7.10, §9.8, §10.7) — hashed device signature, `track-device` Edge Function, tracking-only with no enforcement yet; corrected AUTH-02 (Google OAuth) and SCAN-06 (OCR review before analysis) from 🔲 Pending to ✅ Done — both were already fully implemented, the doc just hadn't caught up; corrected a false claim in v2.3 that `.env.example` had been added — re-verified against a fresh clone, the file does not exist in the repo; logged this session's RTIDS refinement pass (torch/flash decoupling, preview-frame cache cleanup, adaptive frame rate, continuous confidence-based overlay colour, guide-box text confinement) as **written but not yet committed/pushed** — see §9.7.4 and the Phase 3.9 note in §14 |

---

## 1. Executive Summary

INGRYN is a mobile-first SaaS application that allows users to scan product ingredient labels using their phone camera and instantly receive AI-powered analysis. The app identifies each ingredient, provides clear definitions, flags potentially harmful substances, and highlights ingredients that are banned or restricted in specific countries.

INGRYN is targeted at health-conscious consumers, parents, people with dietary restrictions, travellers, and anyone who wants to understand what is actually inside the products they buy — without needing a chemistry degree.

**Current status:** Full UI overhaul complete. All screens rebuilt with premium light natural theme, Plus Jakarta Sans typography, Phosphor icons, and LinearGradient CTAs. Dietary preferences flagging fully wired and computed per-viewer client-side. Gemini analysis runs entirely server-side via a Supabase Edge Function. A data-integrity and hygiene pass (v2.2) closed out a cross-user data leakage bug and the last remaining `Alert.alert` usages. Google OAuth is live. The scanner now auto-detects an ingredient list in real time (RTIDS — §7.9) instead of requiring a manual button tap, with a first-party device-tracking layer (§7.10) quietly logging device/account patterns in the background for the anti-abuse work planned in Phase 4. Monetisation (Phase 4) is next.

---

## 2. Problem Statement

### The core problem

Modern consumer products contain dozens of synthetic compounds, preservatives, flavour enhancers, and chemical additives. The average person cannot interpret ingredient labels. Even informed consumers struggle to:

- Understand what individual chemical ingredients actually are
- Know which ingredients are considered harmful or controversial
- Know that an ingredient legal in their country may be banned elsewhere
- Keep up with evolving food safety research

### Why existing solutions fall short

- **Google search**: Requires searching each ingredient one by one
- **EWG / Think Dirty**: Limited product database, no camera OCR, no real-time AI analysis
- **Open Food Facts**: Crowdsourced, incomplete, no country-specific ban data
- **Yuka**: No depth of AI-powered per-ingredient explanations, no country ban tracking

### The INGRYN opportunity

A single camera scan → instant, structured, AI-powered breakdown of every ingredient in under 10 seconds. No manual input. No product database dependency. Works on any label.

---

## 3. Goals & Success Metrics

### Business Goals

| Goal             | Metric                        | Target (6 months post-launch) |
| ---------------- | ----------------------------- | ----------------------------- |
| User acquisition | Total installs                | 10,000                        |
| Activation       | Users who complete first scan | ≥ 60% of installs            |
| Retention        | DAU/MAU ratio                 | ≥ 25%                        |
| Monetisation     | Free-to-paid conversion       | ≥ 5%                         |
| Revenue          | Monthly Recurring Revenue     | $2,000 MRR                    |

### Product Goals

- Scan-to-results time under 10 seconds on a mid-range device
- OCR accuracy ≥ 90% on standard product labels
- AI analysis covers 100% of detected ingredients
- App Store rating ≥ 4.3 stars

---

## 4. User Personas

### Persona 1 — The Health-Conscious Parent

**Name:** Priya, 34 | **Location:** Mumbai
Wants to avoid artificial colours and preservatives in food for her kids.
**Key feature:** Safety flags + dietary preference alerts

### Persona 2 — The Traveller / Expat

**Name:** Marco, 28 | **Location:** EU ↔ US
Needs to know if ingredients legal in US are banned at home in Italy.
**Key feature:** Country-specific ban data per ingredient

### Persona 3 — The Fitness Enthusiast

**Name:** Aanya, 25 | **Location:** Delhi
Wants to understand every ingredient in her supplements and protein bars.
**Key feature:** Full AI descriptions + category tags

### Persona 4 — The Allergy Sufferer

**Name:** Rahul, 41 | **Location:** Bangalore
Has sulphite sensitivity and needs to detect hidden allergens by chemical name.
**Key feature:** Dietary preference flagging + aliases (E220 = Sulphur Dioxide)

---

## 5. Competitive Landscape

| App                | OCR Scan   | AI Analysis         | Country Bans   | Allergen Detection | Premium UI |
| ------------------ | ---------- | ------------------- | -------------- | ------------------ | ---------- |
| **INGRYN**   | ✅         | ✅ Gemini 2.5 Flash | ✅ 8 countries | ✅ Personalised    | ✅         |
| Yuka               | ✅         | ❌ Static DB        | ❌             | Partial            | ✅         |
| Think Dirty        | ❌ Manual  | ❌ Static DB        | ❌             | ❌                 | ❌         |
| Open Food Facts    | ❌ Barcode | ❌ Community        | ❌             | Partial            | ❌         |
| EWG Healthy Living | ❌ Barcode | ❌ Static DB        | ❌             | ✅                 | ❌         |

---

## 6. Product Scope

### Completed

- ✅ User authentication (email/password) with full error handling and rate limiting
- ✅ Forgot password flow (inline, no separate screen)
- ✅ Email validation with 300+ disposable domain blocklist
- ✅ Auth guard preventing unauthenticated access
- ✅ Camera-based ingredient scanning + gallery fallback
- ✅ OCR text extraction
- ✅ AI-powered ingredient analysis via Gemini 2.5 Flash
- ✅ Per-ingredient definitions, safety ratings, and category tags
- ✅ Country ban/restriction flags (US, EU, UK, India, Australia, Canada, Japan, China)
- ✅ Ingredient caching in Supabase
- ✅ Personal relevance flagging computed client-side, per-viewer, from the current user's own dietary preferences — never persisted to the shared ingredient cache (fixed a cross-user data leakage bug in v2.2; see §9.3)
- ✅ Dietary preferences (conditions, allergies, diet type) saved + flagging on results
- ✅ Scan history with delete + search
- ✅ Ingredient detail view
- ✅ Settings (edit name, change password, delete account, app version)
- ✅ Session persistence
- ✅ No onboarding flow — the welcome screen is the sole landing screen for every signed-out user (new or returning after logout); removed in v2.3 to reduce friction (see §9.5)
- ✅ Native splash screen stays visible through font loading + session check — no blank/spinner flash on launch (fixed in v2.3, see §9.3)
- ✅ Full UI overhaul — premium light natural theme across all screens
- ✅ Design system (`constants/theme.ts`) — Colors, Fonts, Spacing, Radius, Shadows
- ✅ Plus Jakarta Sans typography throughout
- ✅ Phosphor icons — `lucide-react-native` removed entirely (was unused dead weight since the migration)
- ✅ LinearGradient CTAs and safety cards
- ✅ Gemini API calls fully server-side via a Supabase Edge Function (`analyze-ingredients`) — no API key in the client bundle
- ✅ Legal pages — Privacy Policy and Terms of Service are live screens (`/legal/[type]`), linked from Settings
- ✅ No `Alert.alert` anywhere in the app — all confirmations use the `ConfirmDialog` component, all notices use inline banners (fixes silent failures on web)
- ✅ Seed dataset — 117 common ingredients pre-loaded in Supabase
- ✅ Google OAuth via native Google Sign-In → Supabase `signInWithIdToken` (this doc previously listed this as pending; it was already done — see §7.1, §9.1)
- ✅ OCR text review/edit before analysis — captured/picked photos run OCR, then land on the manual-entry screen with the recognized text pre-filled and editable before the user confirms analysis (this doc previously listed this as pending too — see §7.2)
- ✅ **Real-Time Ingredient Detection System (RTIDS)** — the scanner now auto-detects an ingredient list live, shows a red→yellow→green confidence overlay, and auto-captures once confidence holds steady, instead of requiring a manual button tap every time. Manual capture, gallery, and manual-text-entry all remain available. See §7.9, §8.6, §9.7.
- ✅ **Device-tracking anti-abuse system (tracking-only, no enforcement)** — every sign-in records a hashed device signature and links it to the signing-in account; devices linked to more than 3 accounts are automatically flagged. Nothing is blocked or gated on this yet — it's purely instrumentation ahead of Phase 4. See §7.10, §9.8, §10.7.

### In Progress / Next

- 🔲 RevenueCat subscription integration
- 🔲 Paywall screen + feature gating
- 🔲 Free tier scan limit enforcement (5 scans/month) — note: `increment_scan_count` RPC exists in the schema (§10.6) but is not yet called anywhere in client code, and `profiles.scan_count` is never updated; this needs wiring before PAY-01/SCAN-11 can work
- 🔲 Acting on device-abuse flags (currently tracking-only — see §7.10)
- 🔲 RTIDS refinement pass, written this session, **not yet committed/pushed**: flash no longer strobes during live scanning (now drives continuous torch instead of capture-flash), preview-frame cache leak fixed, adaptive frame rate (slows down while nothing's detected), overlay colour now interpolates continuously with confidence instead of jumping between 3 bands, OCR text confined to the on-screen guide box instead of reading the whole frame. See §9.7.4.

### Out of Scope — v1.0

- Barcode scanning
- Social/sharing features
- Web app
- Offline mode
- Multi-language label OCR
- Nutritional analysis
- PDF export

---

## 7. Feature Requirements

### 7.1 Authentication ✅ Completed

| ID      | Requirement                                                                                                | Priority | Status                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | Email + password sign up                                                                                   | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-02 | Google OAuth                                                                                               | P0       | ✅ Done — native Google Sign-In (`lib/auth.ts`) → Supabase `signInWithIdToken`; this doc previously showed this as pending, it just hadn't been updated (see §9.1) |
| AUTH-03 | Reset password via email                                                                                   | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-04 | Session persists across restarts                                                                           | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-05 | Sign out                                                                                                   | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-06 | Onboarding flow for new users                                                                              | P1       | ❌ Removed (v2.3) — replaced by welcome screen as the single landing screen for all signed-out users; see §9.5                                                          |
| AUTH-07 | Returning users (with a session) go directly to home; signed-out users (new or after logout) go to welcome | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-08 | Inline error messages and confirmations (no`Alert.alert` anywhere)                                       | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-09 | Rate limiting — 5 attempts → exponential backoff                                                         | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-10 | Disposable email blocking (300+ domains)                                                                   | P0       | ✅ Done                                                                                                                                                                   |
| AUTH-11 | Edit display name                                                                                          | P1       | ✅ Done                                                                                                                                                                   |
| AUTH-12 | Change password                                                                                            | P1       | ✅ Done                                                                                                                                                                   |
| AUTH-13 | Delete account (Supabase RPC)                                                                              | P1       | ✅ Done                                                                                                                                                                   |

### 7.2 Scanner ✅ Completed

| ID      | Requirement                                                                | Priority | Status                                                                                                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCAN-01 | Camera permission request                                                  | P0       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-02 | Live camera with crop guide                                                | P0       | ✅ Done — the guide box is drawn on screen; as of this session it also confines what OCR actually reads (§7.9, was previously decorative only)                                                                                                                        |
| SCAN-03 | Capture button                                                             | P0       | ✅ Done — manual capture remains available alongside RTIDS auto-capture                                                                                                                                                                                                |
| SCAN-04 | OCR text extraction                                                        | P0       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-05 | Ingredient list parsed from OCR                                            | P0       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-06 | Review/edit OCR text before analysis                                       | P1       | ✅ Done — this doc previously showed this as pending; it was already implemented as a shared step: any capture (manual or auto) runs OCR then lands on the manual-entry screen with the result pre-filled and editable, rather than a separate dedicated review screen |
| SCAN-07 | Gallery image picker fallback                                              | P1       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-08 | Manual text entry fallback                                                 | P1       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-09 | Processing state with tips                                                 | P0       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-10 | Scan-to-result under 10 seconds                                            | P0       | ✅ Done                                                                                                                                                                                                                                                                 |
| SCAN-11 | Free tier scan limit (5/month)                                             | P1       | 🔲 Pending (Phase 4)                                                                                                                                                                                                                                                    |
| SCAN-12 | Real-time live detection with confidence scoring — no manual tap required | P1       | ✅ Done — see §7.9                                                                                                                                                                                                                                                    |
| SCAN-13 | Visual confidence feedback while scanning (red→yellow→green)             | P1       | ✅ Done as of this session's refinement pass — was a 3-band jump tied to discrete states before, now interpolates continuously with the live confidence number (🔲 not yet pushed, see §9.7.4)                                                                        |
| SCAN-14 | OCR confined to the on-screen guide box (not the full frame)               | P2       | ✅ Done as of this session's refinement pass, 🔲 not yet pushed — see §9.7.4                                                                                                                                                                                          |

### 7.3 AI Analysis ✅ Completed

| ID    | Requirement                                                                                                      | Priority | Status                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI-01 | Gemini 2.5 Flash returns structured JSON                                                                         | P0       | ✅ Done                                                                                                                                                                                          |
| AI-02 | Name, aliases, category, description, safety level, country bans                                                 | P0       | ✅ Done                                                                                                                                                                                          |
| AI-03 | Country coverage: US, EU, UK, India, Australia, Canada, Japan, China                                             | P0       | ✅ Done                                                                                                                                                                                          |
| AI-04 | Unknown ingredients flagged as "unverified"                                                                      | P0       | ✅ Done                                                                                                                                                                                          |
| AI-05 | Ingredient caching in Supabase                                                                                   | P1       | ✅ Done                                                                                                                                                                                          |
| AI-06 | JSON-only response (no preamble)                                                                                 | P0       | ✅ Done                                                                                                                                                                                          |
| AI-07 | `personal_flag` returned per ingredient by Gemini, based on the requesting user's preferences at analysis time | P1       | ✅ Done                                                                                                                                                                                          |
| AI-08 | `personal_flag` never persisted to the shared `ingredients` cache                                            | P1       | ✅ Done (v2.2) — was previously persisted and leaked across users; now deliberately dropped before insert. Personal relevance is instead computed fresh, client-side, per viewer (§9.3, §9.6) |

### 7.4 Results Screen ✅ Completed

| ID     | Requirement                                                   | Priority | Status  |
| ------ | ------------------------------------------------------------- | -------- | ------- |
| RES-01 | Grouped by safety: Harmful → Caution → Safe                 | P0       | ✅ Done |
| RES-02 | Ingredient card: name, category, safety badge, 1-line summary | P0       | ✅ Done |
| RES-03 | Tap ingredient → detail screen                               | P0       | ✅ Done |
| RES-04 | Overall safety score ring                                     | P1       | ✅ Done |
| RES-05 | Country ban summary alert                                     | P1       | ✅ Done |
| RES-06 | Auto-saved to history                                         | P0       | ✅ Done |
| RES-07 | Scan naming/labelling                                         | P1       | ✅ Done |
| RES-08 | Personal dietary flag banners per ingredient                  | P1       | ✅ Done |
| RES-09 | Summary alert for total flagged ingredients                   | P1       | ✅ Done |

### 7.5 Ingredient Detail ✅ Completed

| ID     | Requirement                           | Priority | Status    |
| ------ | ------------------------------------- | -------- | --------- |
| DET-01 | Full name + aliases/E-numbers         | P0       | ✅ Done   |
| DET-02 | Category chip                         | P0       | ✅ Done   |
| DET-03 | Full AI description                   | P0       | ✅ Done   |
| DET-04 | Safety level with LinearGradient card | P0       | ✅ Done   |
| DET-05 | Country-by-country status table       | P0       | ✅ Done   |
| DET-06 | Health concerns list                  | P1       | ✅ Done   |
| DET-07 | Banned/restricted country count chips | P1       | ✅ Done   |
| DET-08 | Common products                       | P2       | 🔲 Future |

### 7.6 History ✅ Completed

| ID     | Requirement                                    | Priority | Status  |
| ------ | ---------------------------------------------- | -------- | ------- |
| HIS-01 | Chronological scan list                        | P0       | ✅ Done |
| HIS-02 | Scan card: name, date, score, ingredient count | P0       | ✅ Done |
| HIS-03 | Tap to reopen results                          | P0       | ✅ Done |
| HIS-04 | Delete scan (with confirmation)                | P1       | ✅ Done |
| HIS-05 | Synced to Supabase                             | P0       | ✅ Done |
| HIS-06 | Search/filter by product name                  | P1       | ✅ Done |

### 7.7 Settings ✅ Completed

| ID     | Requirement                       | Priority | Status                                                          |
| ------ | --------------------------------- | -------- | --------------------------------------------------------------- |
| SET-01 | View name and email               | P0       | ✅ Done                                                         |
| SET-02 | Edit display name (inline)        | P1       | ✅ Done                                                         |
| SET-03 | Change password (inline)          | P1       | ✅ Done                                                         |
| SET-04 | Delete account                    | P1       | ✅ Done                                                         |
| SET-05 | Dietary preferences modal         | P1       | ✅ Done                                                         |
| SET-06 | Subscription status + upgrade CTA | P0       | 🔲 Pending (Phase 4)                                            |
| SET-07 | Privacy policy / Terms links      | P1       | ✅ Done — live pages at`/legal/[type]`, linked from Settings |
| SET-08 | App version display               | P2       | ✅ Done (v1.0.0)                                                |
| SET-09 | Restore purchases                 | P0       | 🔲 Pending (Phase 4)                                            |

### 7.8 Subscription & Paywall 🔲 Next Phase

| ID     | Requirement                           | Priority | Status     |
| ------ | ------------------------------------- | -------- | ---------- |
| PAY-01 | Free tier: 5 scans/month              | P0       | 🔲 Pending |
| PAY-02 | Pro tier: unlimited scans + full data | P0       | 🔲 Pending |
| PAY-03 | Paywall on limit/locked feature       | P0       | 🔲 Pending |
| PAY-04 | RevenueCat (iOS + Android unified)    | P0       | 🔲 Pending |
| PAY-05 | Subscription state synced to Supabase | P1       | 🔲 Pending |
| PAY-06 | Restore purchases                     | P0       | 🔲 Pending |

### 7.9 Real-Time Ingredient Detection System (RTIDS) ✅ Base implementation complete

Live, on-device auto-scan: point the camera at a label and the app detects when it's actually looking at an ingredient list — as opposed to a nutrition table, a barcode, or nothing in particular — and auto-captures once confidence holds steady, instead of requiring a manual button tap. Shipped in the `changes made by antigravity` commit; this doc previously had no record of it at all.

| ID       | Requirement                                                                                     | Priority | Status                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RTIDS-01 | Classify live frames as INGREDIENTS / NUTRITION / BARCODE / UNKNOWN                             | P1       | ✅ Done —`detection/DetectionEngine.ts`                                                                                                                                                       |
| RTIDS-02 | Confidence score per frame, weighted across keyword density, structure, length, quality         | P1       | ✅ Done — 30/40/20/10 weighting                                                                                                                                                                 |
| RTIDS-03 | State machine: IDLE → SEARCHING → POSSIBLE_INGREDIENT → CONFIRMED → CAPTURING → PROCESSING | P1       | ✅ Done —`detection/CameraStateMachine.ts`                                                                                                                                                    |
| RTIDS-04 | Auto-capture once confidence holds ≥85% for 1000ms                                             | P1       | ✅ Done                                                                                                                                                                                          |
| RTIDS-05 | Red → yellow → green visual confidence overlay                                                | P1       | ✅ Done. Originally a 3-band jump tied to discrete state, not the live confidence number — smoothed to a continuous gradient in this session's refinement pass (🔲 not yet pushed, see §9.7.4) |
| RTIDS-06 | Fuzzy/OCR-error-tolerant ingredient-name matching (o↔0, l↔1, etc.)                            | P1       | ✅ Done —`detection/FuzzyMatcher.ts`, custom Levenshtein-based, no external dependency added                                                                                                  |
| RTIDS-07 | Manual capture, gallery picker, and manual text entry remain available as fallbacks             | P0       | ✅ Done — RTIDS augments the existing flow, doesn't replace it                                                                                                                                  |
| RTIDS-08 | OCR confined to the on-screen guide box rather than the entire camera frame                     | P2       | ✅ Done as of this session's refinement pass, 🔲 not yet pushed — see §9.7.4                                                                                                                   |
| RTIDS-09 | No flash strobing / no shutter-sound spam during live scanning                                  | P1       | ✅ Done as of this session's refinement pass, 🔲 not yet pushed — see §9.7.4                                                                                                                   |
| RTIDS-10 | Preview capture files don't accumulate on disk                                                  | P2       | ✅ Done as of this session's refinement pass, 🔲 not yet pushed — see §9.7.4                                                                                                                   |
| RTIDS-11 | Capture cadence backs off while nothing is detected, to save battery                            | P2       | ✅ Done as of this session's refinement pass, 🔲 not yet pushed — see §9.7.4                                                                                                                   |
| RTIDS-12 | True live frame-processor pipeline (vs. repeated still captures)                                | P3       | ❌ Not implemented — architectural tradeoff, see §9.7.3 and §15                                                                                                                               |

### 7.10 Anti-Abuse Device Tracking ✅ Tracking-only, no enforcement

Every sign-in records a hashed device fingerprint and links it to the account that just signed in, so that a device linked to an unusual number of distinct accounts can be flagged for review later. Nothing is blocked, rate-limited, or gated on this today — it's purely instrumentation, laying groundwork for Phase 4 anti-abuse enforcement (e.g. capping free-tier scans per *device* rather than just per account). Shipped in the `feat: Add device tracking and fix Google Auth bug` commit; this doc previously had no record of it.

| ID     | Requirement                                                      | Priority | Status                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-01 | Generate a stable, hashed per-device signature (SHA-256)         | P2       | ✅ Done —`lib/deviceSignature.ts`                                                                                                                                                  |
| DEV-02 | Record device ↔ account links server-side on every sign-in      | P2       | ✅ Done —`track-device` Edge Function, fired on Supabase's `SIGNED_IN` event in `app/_layout.tsx`                                                                              |
| DEV-03 | Flag devices linked to more than 3 distinct accounts             | P2       | ✅ Done — threshold check inside the Edge Function                                                                                                                                   |
| DEV-04 | Act on flags (block/limit/require verification)                  | P0       | 🔲 Pending (Phase 4) — see §14                                                                                                                                                      |
| DEV-05 | RLS lockdown on`devices` / `user_devices` / `device_flags` | P0       | 🔲 Not verifiable from this repo — needs confirming directly in Supabase; deliberately deferred, see §14                                                                            |
| DEV-06 | `user_devices.user_id` FK behaviour on account deletion        | P1       | ⚠️ Currently`ON DELETE CASCADE`, which would erase abuse evidence exactly when an abusive account deletes itself to evade detection — deliberately deferred to Phase 4, see §14 |

---

## 8. Screen Specifications

### 8.1 Onboarding ❌ Removed (v2.3)

Previously a 4-slide walkthrough at `/(auth)/onboarding` (Scan → Know → Global → Personal), gated behind an AsyncStorage completion flag. Removed to reduce friction between install and first scan — every signed-out user now lands directly on Welcome (§8.2), which already covers the same value props via its feature-card strip. The route, screen file, and its AsyncStorage helper (`constants/onboarding.ts`) have been deleted from the codebase.

---

### 8.2 Welcome ✅ Implemented — now the sole landing screen for signed-out users

**Route:** `/(auth)/welcome`

Premium light theme. INGRYN logo with green gradient + Leaf icon. Tagline, 3 feature cards (Scan/ShieldCheck/Globe Phosphor icons), stats strip (10s/117+/8), full-width LinearGradient CTA ("Get started — it's free"), "Already have an account? Sign in" link, legal text. Shown to every signed-out user — first-time installs and anyone who has just logged out alike — since there's no longer an onboarding step ahead of it.

---

### 8.3 Sign In ✅ Implemented

**Route:** `/(auth)/signin`

Light theme. Inputs with Phosphor icons (EnvelopeSimple, Lock, Eye/EyeSlash). Inline error banners with Warning icon. Rate limiting lockout shown in amber banner. Forgot password inline (same screen) with CheckCircle success state. LinearGradient sign in button with ArrowRight.

---

### 8.4 Sign Up ✅ Implemented

**Route:** `/(auth)/signup`

Light theme. Three inputs with icons (UserCircle, EnvelopeSimple, Lock). PasswordStrength bars (red/amber/green). Inline error banners. Email validation against disposable blocklist. LinearGradient CTA. Legal text at bottom.

---

### 8.5 Home ✅ Implemented

**Route:** `/(tabs)/home`

Greeting with first name + avatar. LinearGradient hero scan card. Three stat cards (Total/Harmful/Safe). Recent scans list with score rings. Empty state with Leaf icon and green gradient scan button. Pro tip card.

---

### 8.6 Scanner ✅ Implemented — now with real-time auto-detection (RTIDS)

**Route:** `/(tabs)/scanner`

Camera screen stays dark (correct for UX). Light theme for permission, processing, and manual entry screens. Processing screen has animated ring + tip dots. Permission screen has green gradient camera icon. Manual entry has clean TextInput with gradient analyse button.

Camera screen, updated behaviour: a centered guide box (86% width × 26% height of the frame) sits over the live preview, its border now driven by `CameraOverlay.tsx` instead of a static rectangle. As the camera is pointed at a label, the border eases continuously from red through yellow to green as live confidence climbs, with a confidence bar and short guidance text ("Point at ingredient list" → "Hold steady..." → "Got it!"). Once confidence holds ≥85% for a full second, the app auto-captures — no tap needed. The manual capture button, gallery picker, and manual-text-entry fallback all remain exactly as before for anyone who prefers them or whose label isn't cooperating with auto-detect. Flash toggle now drives a continuous torch rather than a capture-time flash (see §9.7.4), so it no longer strobes during live scanning.

---

### 8.7 Results ✅ Implemented

**Route:** `/results/[scanId]`

Light theme. Score card with large number + ring. Stats strip (Harmful/Caution/Safe/Banned). Purple personal flag alert banner. Red ban alert banner. Ingredient cards with safety badges, personal flag rows (purple), health concern rows (amber). Scan naming modal with LinearGradient button.

---

### 8.8 Ingredient Detail ✅ Implemented

**Route:** `/ingredient/[ingredientId]`

Light theme. Category chip header. LinearGradient safety card (green/amber/red/grey). Banned/restricted country count chips. About section, health concerns list, full country status table with flag emojis and coloured status chips. Alias grid as white cards.

---

### 8.9 History ✅ Implemented

**Route:** `/(tabs)/history`

Light theme. Search bar with X clear button. FlatList with score rings, safety badges, delete buttons (each routed through an inline `ConfirmDialog`, not `Alert.alert`). Empty state with ClockCounterClockwise icon. Search empty state with clear button.

---

### 8.10 Settings ✅ Implemented

**Route:** `/(tabs)/settings`

Light theme. Profile card with LinearGradient avatar, Free tier badge. Section headers. Inline name/password editing with save/cancel. Dietary preferences row → opens modal. Privacy Policy / Terms of Service open live legal pages. App version. Red sign out button. Subtle delete account link opens an inline `ConfirmDialog`; failures surface as an inline error banner (no `Alert.alert`).

---

### 8.11 Paywall 🔲 Pending

**Route:** `/paywall` (modal)
Phase 4 — RevenueCat integration.

---

## 9. Technical Architecture

### 9.1 Tech Stack

| Layer              | Technology                                                                                                                                                                                                                                                                                                                                                                  | Status                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Framework          | Expo SDK 56 (React Native)                                                                                                                                                                                                                                                                                                                                                  | ✅                               |
| Navigation         | Expo Router (file-based)                                                                                                                                                                                                                                                                                                                                                    | ✅                               |
| Auth               | Supabase Auth (email/password + Google)                                                                                                                                                                                                                                                                                                                                     | ✅                               |
| Google Sign-In     | `@react-native-google-signin/google-signin` — native module, `lib/auth.ts` → Supabase `signInWithIdToken`. **Requires `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` env vars — `lib/auth.ts` throws at import time on native if either is missing, and there's no `.env.example` in the repo to document them (see §15)** | ✅ implemented, ⚠️ config risk |
| Database           | Supabase (PostgreSQL)                                                                                                                                                                                                                                                                                                                                                       | ✅                               |
| Serverless         | Supabase Edge Functions (Deno) — hosts`analyze-ingredients` and `track-device`                                                                                                                                                                                                                                                                                         | ✅                               |
| Camera             | `expo-camera` (`CameraView`) — no frame-processor support, see §9.7.3 for why RTIDS works around this                                                                                                                                                                                                                                                                 | ✅                               |
| OCR                | `@react-native-ml-kit/text-recognition` (on-device ML Kit) — used for both the manual-capture pipeline and every RTIDS live frame                                                                                                                                                                                                                                        | ✅                               |
| File cleanup       | `expo-file-system/legacy` — used by RTIDS to delete throwaway preview-frame snapshots (see §9.7.4)                                                                                                                                                                                                                                                                      | ✅ written, 🔲 not yet pushed    |
| Device fingerprint | `expo-device`, `expo-application`, `expo-crypto` — compose and SHA-256 hash a device signature (`lib/deviceSignature.ts`)                                                                                                                                                                                                                                          | ✅                               |
| Secure storage     | `expo-secure-store`                                                                                                                                                                                                                                                                                                                                                       | ✅ installed                     |
| AI Analysis        | Google Gemini 2.5 Flash, called server-side only from the`analyze-ingredients` Edge Function (never from the client)                                                                                                                                                                                                                                                      | ✅                               |
| Ingredient Cache   | Supabase`ingredients` table                                                                                                                                                                                                                                                                                                                                               | ✅                               |
| Design System      | `constants/theme.ts`                                                                                                                                                                                                                                                                                                                                                      | ✅                               |
| Typography         | Plus Jakarta Sans (`@expo-google-fonts/plus-jakarta-sans`)                                                                                                                                                                                                                                                                                                                | ✅                               |
| Icons              | Phosphor Icons (`phosphor-react-native`)                                                                                                                                                                                                                                                                                                                                  | ✅                               |
| Gradients          | `expo-linear-gradient`                                                                                                                                                                                                                                                                                                                                                    | ✅                               |
| Haptics            | `expo-haptics`                                                                                                                                                                                                                                                                                                                                                            | ✅                               |
| Blur               | `expo-blur`                                                                                                                                                                                                                                                                                                                                                               | ✅                               |
| Animation engine   | `react-native-reanimated` + `react-native-gesture-handler` — powers the RTIDS overlay's pulse/scale/bar animations (was missing from this table entirely)                                                                                                                                                                                                              | ✅                               |
| Animations         | `lottie-react-native`                                                                                                                                                                                                                                                                                                                                                     | ✅ installed                     |
| Bottom Sheet       | `@gorhom/bottom-sheet`                                                                                                                                                                                                                                                                                                                                                    | ✅ installed                     |
| Subscriptions      | RevenueCat                                                                                                                                                                                                                                                                                                                                                                  | 🔲 Pending                       |
| State Management   | Zustand (`store/index.ts`)                                                                                                                                                                                                                                                                                                                                                | ✅                               |
| Session Storage    | AsyncStorage                                                                                                                                                                                                                                                                                                                                                                | ✅                               |
| Email Validation   | `lib/emailValidator.ts` (300+ blocklist)                                                                                                                                                                                                                                                                                                                                  | ✅                               |

> `lucide-react-native`, `nativewind`, and `tailwindcss` were removed from `package.json` in v2.2 — grep confirmed zero usages anywhere in source; they were unused dead weight left over from before the Phosphor/`theme.ts` migration.
>
> `newArchEnabled` is no longer set explicitly in `app.json` — SDK 56 defaults to the New Architecture, so the earlier explicit `true`/`false` toggle documented in prior versions of this doc no longer applies either way.
>
> No new runtime dependency was added for RTIDS — fuzzy matching is a hand-rolled Levenshtein implementation (`detection/FuzzyMatcher.ts`), not Fuse.js or similar.

### 9.2 Design System — `constants/theme.ts`

All UI tokens centralised:

- **Colors** — primary (#22C55E), background (#F8FAFC), surface (#FFFFFF), semantic (success/warning/danger), safety levels (safe/caution/harmful/unknown), country status, personal flag (#8B5CF6)
- **Fonts** — PlusJakartaSans weights: 200–800 + italics
- **FontSizes** — xs(11) through 7xl(42)
- **Spacing** — xs(4) through 6xl(64)
- **Radius** — sm(6) through full(9999)
- **Shadows** — sm/md/lg/primary/danger
- **SafetyConfig** — label + color + bg + icon per level
- **CountryStatusConfig** — label + color + bg per status

### 9.3 Key Technical Decisions & Resolved Issues

| Issue                                              | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `personal_flag` leaked across users              | **(v2.2)** Was written to the shared `ingredients` cache by whichever user's preferences triggered the Gemini call, then shown as-is to every later viewer — e.g. User A's peanut-allergy flag could be shown to User B, who has no peanut allergy. Fixed by no longer persisting `personal_flag` in `saveIngredients()` (`hooks/useIngredientAnalysis.ts`), and removing the DB-value shortcut in `getPersonalFlag()` (`app/results/[scanId].tsx`) so relevance is always computed fresh, client-side, from the current viewer's own preferences via local keyword matching. **Correction (v2.4):** this doc previously cited a migration file at `supabase/migrations/20260704120000_drop_personal_flag_column.sql` dropping the now-unused column — re-verified against a fresh clone, no `migrations/` folder exists anywhere in this repo. Either that migration was applied directly against Supabase and never committed, or the column is still sitting there unused. Worth confirming directly in the Supabase dashboard.                                                                                               |
| Onboarding flow added friction                     | **(v2.3)** Removed the 4-slide onboarding screen and its AsyncStorage flag entirely (deleted `app/(auth)/onboarding.tsx` and `constants/onboarding.ts`). Every signed-out user — first install or after logging out — now lands directly on `/(auth)/welcome`, which already carries the same value-prop messaging. `_layout.tsx`'s `AuthGate` simplified accordingly; see §9.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native splash hid before app was ready             | **(v2.3)** `expo-splash-screen` was installed and configured in `app.json` but never actually called from code, so the OS hid the native splash the instant JS started — before fonts or the session check had finished — leaving a blank/spinner flash on every launch. Fixed with `SplashScreen.preventAutoHideAsync()` at module scope in `app/_layout.tsx`, and `SplashScreen.hideAsync()` once `AuthGate`'s session check resolves (fonts are guaranteed loaded by that point, since `RootLayout` doesn't mount `AuthGate` until `fontsLoaded` is true).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Unused`RECORD_AUDIO` Android permission          | **(v2.3)** Declared in `app.json` with no corresponding microphone/audio code anywhere in the app (confirmed via repo-wide grep). Removed — unused sensitive permissions are both an unnecessary privacy footprint and a Play Store review risk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Public Edge Function had no input size limit       | **(v2.3)** `analyze-ingredients` accepted `ingredientText` of any length, so a malicious or buggy caller could send an oversized payload to run up Gemini costs or exceed its context window. Added a 3,000-character cap returning `400` if exceeded — generous for any real label, low enough to block abuse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No`.env.example`                                 | **(v2.3, claimed)** This row previously said `.env.example` had been added, documenting `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`. **Correction (v2.4):** re-verified against a fresh clone — the file does not exist anywhere in the repo. Either it was created locally and never committed, or committed and later deleted. Still needed, and now also needs to cover `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, which Google Sign-In requires and currently has no documentation anywhere in the repo (see §9.1, §15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Alert.alert` silent on web                      | **(v2.2)** Four instances remained after the v2.1 fix: scan delete confirmation (`history.tsx`), account delete confirmation + error (`settings.tsx`), and a signup email-verification message (`signup.tsx`). All replaced — confirmations now use a new reusable `components/ConfirmDialog.tsx` (built on RN `Modal`, which renders correctly on web), and the verification message uses an inline success banner matching the existing error-banner pattern. Repo-wide grep confirms zero remaining `Alert.alert` usages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Gemini API called client-side                      | **(v2.2, confirmed)** Fully migrated to a Supabase Edge Function (`supabase/functions/analyze-ingredients`). `lib/gemini.ts` now calls `supabase.functions.invoke('analyze-ingredients')`; the Gemini API key lives only in the Edge Function's environment (`Deno.env.get('GEMINI_API_KEY')`) and never ships in the client bundle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Legal pages were placeholders                      | **(v2.2, confirmed)** `/legal/[type]` renders real Privacy Policy / Terms of Service content and is linked from Settings — no longer a "coming soon" stub.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Unused dependencies                                | **(v2.2)** `lucide-react-native`, `nativewind`, and `tailwindcss` removed from `package.json` after confirming zero usages in source and no references in `babel.config.js` or `tsconfig.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Dead`else` block                                 | **(v2.2)** Removed a leftover empty `else {}` after the insert-error check in `useIngredientAnalysis.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Alert.alert` silent on web (v2.1)               | Replaced with inline error banners across all auth screens (superseded by the v2.2 pass above, which caught the remaining instances)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Onboarding routing loop (v2.1)                     | `_layout.tsx` read AsyncStorage directly per segment change to fix a dual-instance routing loop — moot as of v2.3, since the entire onboarding screen and flag were removed rather than kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `signup.tsx` had signin code                     | Rebuilt correctly with`handleSignUp`, `fullName`, `PasswordStrength`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `app/index.tsx` routing conflict                 | Simplified to loading spinner — all routing owned by`_layout.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dual`useOnboarding` hook instances (v2.1)        | Hook removed entirely in v2.1; the AsyncStorage helpers it wrapped (`constants/onboarding.ts`) were themselves removed in v2.3 along with the onboarding screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dietary_preferences` upsert `23505` error     | Added`{ onConflict: 'user_id' }` to upsert call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ScanLine` not in Phosphor                       | Renamed to`Scan`; aliased as `ScanIcon` where local type conflict exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `--legacy-peer-deps` required                    | Set once in`.npmrc` (`legacy-peer-deps=true`) so it applies automatically to every install                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| RTIDS shipped without a PRD entry                  | **(v2.4)** The `changes made by antigravity` commit added the entire real-time detection system — `detection/`, `hooks/useRealtimeDetection.ts`, `components/CameraOverlay.tsx` — with no corresponding update to this doc. Documented retroactively in §7.9, §8.6, §9.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Device tracking shipped without a PRD entry        | **(v2.4)** Same gap for the `feat: Add device tracking and fix Google Auth bug` commit — `lib/deviceSignature.ts`, `supabase/functions/track-device`. Documented retroactively in §7.10, §9.8, §10.7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| RTIDS flash strobed during live scanning           | **(v2.4, written — not yet pushed)** The flash toggle was wired to `CameraView`'s `flash` prop, which fires only at capture time — fine for a single manual tap, but RTIDS calls `takePictureAsync` every 400–750ms, so with flash on it strobed continuously during scanning. Fixed by switching the toggle to drive `enableTorch` (a genuine continuous flashlight, decoupled from capture) and hardcoding `flash="off"` permanently, so no `takePictureAsync` call — preview, auto-capture, or manual — ever triggers a flash. Arguably a better UX than before this bug existed, too: continuous torch is more useful than a capture-time flash for a live scanning screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| RTIDS leaked preview snapshots to disk             | **(v2.4, written — not yet pushed)** Every ~400–750ms preview frame was written to disk via `takePictureAsync` and never deleted — roughly 2 files/second accumulating in the cache directory for as long as scanning was active. Fixed with `FileSystem.deleteAsync(uri, { idempotent: true })` in a `finally` block after each frame's OCR pass, so cleanup runs regardless of which exit path that frame takes. Also silenced `shutterSound` on both preview and auto-capture calls, which would otherwise have clicked on every cycle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| RTIDS sampled at a fixed rate regardless of signal | **(v2.4, written — not yet pushed)** The frame loop ran on a fixed 400ms `setInterval` at all times, including while pointed at nothing. Replaced with a self-rescheduling `setTimeout` loop that checks state each cycle: 750ms while IDLE/SEARCHING (no signal), dropping to 400ms once something starts to register (POSSIBLE_INGREDIENT+) — cuts capture frequency roughly in half during dead time without sacrificing responsiveness once a real detection starts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| RTIDS overlay colour jumped between 3 bands        | **(v2.4, written — not yet pushed)** `CameraOverlay.tsx`'s border colour was a `switch` on discrete state (red for SEARCHING, yellow for POSSIBLE_INGREDIENT, green only at CONFIRMED) rather than the live confidence number, so it visibly snapped instead of climbing. Replaced with continuous RGB interpolation — red at 0%, yellow at 50%, green at 100% — driven directly off the confidence float, so the border eases toward green as confidence rises. CONFIRMED/CAPTURING still hold solid green regardless of momentary fluctuation, since those states mean a capture is already committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| RTIDS read text from outside the guide box         | **(v2.4, written — not yet pushed)** The on-screen guide box was purely decorative — both the live loop and the final captured image ran OCR on the *entire* frame, so a nutrition table above the label, a neighbouring product, or background clutter could pollute both live confidence and the final result. Fixed by filtering ML Kit's per-block bounding boxes (`detection/textRegionFilter.ts`) down to just what falls inside the same centered 86%×26% region as the visual guide box, applied to both the live loop and the one-time final capture (manual tap and RTIDS auto-capture alike) — deliberately **not** applied to gallery picks, which never had an on-screen box to confine to. Falls back to the unfiltered text if filtering would leave nothing, so a mismatch degrades gracefully rather than breaking the scan. **Caveat:** live preview frames use `takePictureAsync({ skipProcessing: true })` for speed, which per Expo's own docs can leave image orientation unresolved on some devices — worth confirming filtering behaves correctly on a real device, especially in portrait vs. landscape. |

### 9.4 Project Folder Structure

```
ingryn/
├── .env.example                 ❌ Does not exist — v2.3 claimed this was added, re-verified absent (see §9.3, §15)
├── app/
│   ├── _layout.tsx              ✅ Auth gate + font loading + splash screen control + fires device tracking on SIGNED_IN
│   ├── index.tsx                ✅ Loading spinner only (no routing)
│   ├── reset-password.tsx       ✅ Deep-link landing screen for the password-reset email
│   ├── (auth)/
│   │   ├── _layout.tsx          ✅
│   │   ├── welcome.tsx          ✅ Premium light theme — sole landing screen (onboarding removed v2.3)
│   │   ├── signin.tsx           ✅ Premium light theme + rate limiting + forgot password + Google Sign-In
│   │   └── signup.tsx           ✅ Premium light theme + PasswordStrength
│   ├── (tabs)/
│   │   ├── _layout.tsx          ✅ Phosphor icons + floating scan button
│   │   ├── home.tsx             ✅ Premium redesign
│   │   ├── scanner.tsx          ✅ RTIDS live overlay wired in; torch/flash + guide-box filter fix written, not yet pushed (see §9.7.4)
│   │   ├── history.tsx          ✅ Premium redesign + delete (ConfirmDialog) + search + pagination
│   │   └── settings.tsx         ✅ Premium redesign + delete account (ConfirmDialog)
│   ├── legal/
│   │   └── [type].tsx           ✅ Live Privacy Policy / Terms of Service content
│   ├── results/
│   │   └── [scanId].tsx         ✅ Premium redesign + dietary flags (computed client-side)
│   └── ingredient/
│       └── [ingredientId].tsx   ✅ Premium redesign
│
├── components/
│   ├── CameraOverlay.tsx            ✅ RTIDS confidence overlay (§9.7) — gradient colour fix written, not yet pushed
│   ├── ConfirmDialog.tsx            ✅ Reusable confirm/cancel modal — replaces Alert.alert everywhere
│   ├── DietaryPreferencesModal.tsx  ✅
│   └── ErrorBoundary.tsx            ✅
│
├── constants/
│   └── theme.ts                 ✅ Full design system
│
├── detection/                   ✅ RTIDS engine (§9.7) — no new runtime dependency added
│   ├── DetectionEngine.ts       ✅ Classifies INGREDIENTS / NUTRITION / BARCODE / UNKNOWN, weighted confidence
│   ├── CameraStateMachine.ts    ✅ IDLE → SEARCHING → POSSIBLE_INGREDIENT → CONFIRMED → CAPTURING → PROCESSING
│   ├── FuzzyMatcher.ts          ✅ Custom Levenshtein matcher, OCR-confusion-aware (o↔0, l↔1, etc.)
│   ├── imageQuality.ts          ✅ Blur/lighting proxy inferred from OCR text shape, not real pixel analysis (documented tradeoff — ML Kit exposes no blur/brightness score via expo-camera)
│   ├── textRegionFilter.ts      ✅ written, 🔲 not yet pushed — confines OCR text to the on-screen guide box (§9.7.4)
│   └── constants/
│       ├── ingredientDatabase.ts   ✅ ~200-entry curated dictionary, includes India-relevant terms (maida, ghee, jaggery)
│       ├── ingredientKeywords.ts   ✅
│       └── nutritionKeywords.ts    ✅
│
├── lib/
│   ├── supabase.ts              ✅
│   ├── auth.ts                  ✅ Google Sign-In (`GoogleSignin.signOut()` called defensively before every `signIn()` to force the account picker rather than silently reusing a cached native-module account)
│   ├── deviceSignature.ts       ✅ Composes + SHA-256 hashes a device signature for anti-abuse tracking (§9.8)
│   ├── scanUtils.ts             ✅ Small formatting helpers (dates, etc.)
│   ├── gemini.ts                ✅ Invokes the analyze-ingredients Edge Function (no client-side API key)
│   └── emailValidator.ts        ✅ 300+ disposable domain blocklist
│
├── hooks/
│   ├── useScanner.ts            ✅ `recognizeFromUri` now takes an optional `guideBox` param (written, 🔲 not yet pushed — see §9.7.4); gallery picks never pass one
│   ├── useRealtimeDetection.ts  ✅ RTIDS orchestrator (§9.7) — adaptive frame rate + preview-file cleanup written, not yet pushed
│   ├── useIngredientAnalysis.ts ✅ personal_flag intentionally NOT saved (see §9.3)
│   └── useDietaryPreferences.ts ✅ onConflict fix
│
├── supabase/
│   └── functions/
│       ├── analyze-ingredients/ ✅ Deno Edge Function — Gemini key lives here server-side; input length-capped (v2.3)
│       └── track-device/        ✅ Records device↔account link on sign-in, flags devices linked to >3 accounts (§9.8)
│
└── store/
    └── index.ts                 ✅ Zustand auth store
```

> No `supabase/migrations/` folder exists in this repo at all — the `personal_flag` column drop and the anti-abuse tables (`devices`, `user_devices`, `device_flags`, §10.7) both appear to have been applied directly against Supabase rather than committed as migrations. This document previously cited a specific migration file for the `personal_flag` drop; that citation was incorrect (see §9.3). Worth setting up tracked migrations going forward so schema changes aren't only visible from the Supabase dashboard.

> Removed in v2.3: `app/(auth)/onboarding.tsx` and `constants/onboarding.ts` — the onboarding flow no longer exists (see §8.1, §9.5).

> Corrected in v2.2: `hooks/useOnboarding.ts` and `hooks/useHistory.ts` don't exist in the live repo (history logic is inlined in `history.tsx`), and there is no `components/ui/` folder. This document previously listed all three. (The onboarding helpers this note originally referred to were themselves removed in v2.3 — see above.)

### 9.5 Auth Flow ✅ Simplified in v2.3 (onboarding removed)

```
App launch
    └─ Native splash stays visible (SplashScreen.preventAutoHideAsync)
         └─ Fonts load, then Supabase session is checked
              └─ Splash hides once both are ready (SplashScreen.hideAsync)
                   ├─ No session → /(auth)/welcome (new AND returning/logged-out users alike)
                   └─ Session exists → /(tabs)/home
```

There is no separate "first launch" path anymore — the AsyncStorage onboarding flag, the onboarding screen, and its helper file (`constants/onboarding.ts`) were all removed in v2.3. Every signed-out user, whether installing for the first time or just signing out, sees the same welcome screen.

`/legal/[type]` and `/reset-password` are public standalone routes, reachable without a session and without triggering the redirects above (`_layout.tsx` exempts them explicitly).

### 9.6 Dietary Preferences Flow ✅

```
User sets preferences in DietaryPreferencesModal
    └─ Saved to dietary_preferences table (upsert with onConflict: 'user_id')
         └─ useScanner reads preferences → passes to saveAnalysis()
              └─ analyzeIngredients() sends preferences to the analyze-ingredients
                   Edge Function, which asks Gemini for a personal_flag
                   (used only as a per-request hint — never persisted)
                        └─ Ingredient record is cached WITHOUT personal_flag
                             └─ Results screen: getPersonalFlag() always computes
                                  relevance fresh, client-side, from the CURRENT
                                  viewer's own preferences via local keyword
                                  matching — identical logic for fresh and
                                  cached ingredients, so no viewer ever sees
                                  another user's health flag
```

Fixed in v2.2 — previously, Gemini's `personal_flag` was written to the shared `ingredients` row and read back as-is for any later viewer, regardless of that viewer's own preferences. See §9.3.

### 9.7 Real-Time Ingredient Detection System (RTIDS) Architecture ✅ Base complete, refinement pass written (🔲 not yet pushed)

#### 9.7.1 Pipeline

```
CameraView (live preview)
    └─ Every 400–750ms (adaptive, see §9.7.4): capture a low-quality
       preview snapshot (skipProcessing: true, for speed)
            └─ ML Kit on-device OCR (@react-native-ml-kit/text-recognition)
                 └─ Guide-box filter (§9.7.4) — keep only text blocks whose
                    bounding box falls inside the visible guide rectangle
                      └─ DetectionEngine.detect() → classification
                         (INGREDIENTS / NUTRITION / BARCODE / UNKNOWN) +
                         weighted confidence score
                           └─ CameraStateMachine.transition()
                                IDLE → SEARCHING → POSSIBLE_INGREDIENT
                                     → CONFIRMED (≥85% held 1000ms)
                                          └─ CAPTURING → high-quality photo
                                               └─ PROCESSING → hands off to
                                                  the EXISTING pipeline
                                                  (recognizeFromUri → manual
                                                  review step → Gemini) —
                                                  unchanged by RTIDS
```

Manual capture, gallery picker, and manual text entry all remain available untouched — RTIDS augments the scanner, it doesn't replace any existing path.

#### 9.7.2 Confidence Scoring

`DetectionEngine.ts` weights four signals: keyword density (30%), structural pattern — commas, "Ingredients:" prefix, etc. (40%), text length (20%), and an image-quality proxy (10%, see below). `CameraStateMachine.ts` requires confidence to hold at ≥85% for a full 1000ms before transitioning to CONFIRMED and auto-capturing, which is what prevents a single lucky/noisy frame from triggering a premature capture.

`imageQuality.ts` is a **documented compromise**: it infers a blur/lighting proxy from OCR text characteristics (word length, character density) rather than real pixel-level analysis, since ML Kit doesn't expose a blur/brightness score through `expo-camera`, and there's no frame-processor access to raw pixel data available here (see below). Reasonable given the constraint, but worth knowing it's not literally measuring the image.

#### 9.7.3 Known Architecture Tradeoff — Still Captures, Not a Frame Processor

The live loop works by repeatedly calling `takePictureAsync()` — a full still-image capture (sensor readout, JPEG encode, disk write) — rather than sampling the live preview buffer the way a true frame-processor pipeline (e.g. `react-native-vision-camera`'s frame processors) would. `expo-camera`'s `CameraView` doesn't expose frame processors, so this was very likely the only option without swapping camera libraries.

It works, but it's heavier than the spec's implicit target of a lightweight, battery-friendly live scan — each cycle pays the cost of a full capture pipeline, not a cheap frame sample. The adaptive frame rate (§9.7.4) mitigates this somewhat by backing off when nothing's detected, but doesn't eliminate the underlying cost. A proper fix would mean migrating off `expo-camera` to a frame-processor-capable library — a real migration, not a patch — and is intentionally **not** being done unless real-device testing shows it's actually a problem (battery drain, visible preview stutter on mid-range Android). See §15.

#### 9.7.4 This Session's Refinement Pass — written, 🔲 not yet committed/pushed

Five fixes found during review and fixed in this session, delivered as files but not yet applied to the live repo (see the Product Scope note and §9.3 for full detail on each):

1. Flash toggle now drives continuous torch (`enableTorch`) instead of capture-time flash — no more strobing every 400–750ms while scanning
2. Preview snapshot files are deleted after each frame's OCR pass instead of accumulating in the cache directory
3. Frame rate adapts — 750ms while idle/searching, 400ms once something starts to register — instead of a fixed rate regardless of signal
4. Overlay border colour interpolates continuously with the live confidence number instead of jumping between 3 fixed bands
5. OCR text (both the live loop and the one-time final capture) is confined to the on-screen guide box via `detection/textRegionFilter.ts`, instead of reading the entire camera frame

### 9.8 Anti-Abuse Device Tracking Architecture ✅ Tracking-only, no enforcement

```
User signs in (email/password or Google)
    └─ Supabase fires a SIGNED_IN auth event
         └─ app/_layout.tsx dynamically imports and calls
            trackDeviceSession(session.user.id)
              └─ lib/deviceSignature.ts composes a signature from
                 device brand + model + OS + a vendor/installation ID,
                 then SHA-256 hashes it (expo-device + expo-application
                 + expo-crypto)
                   └─ track-device Edge Function (service-role key,
                      server-side only):
                        ├─ Upserts into `devices` (signature → seen count)
                        ├─ Upserts into `user_devices` (links this user_id
                        │  to this device_signature; unique on the pair)
                        └─ Counts distinct accounts linked to this
                           signature — if > 3, upserts a row into
                           `device_flags` marking it suspicious
```

Nothing reads `device_flags` anywhere in the client or in any other Edge Function yet — flags are written but never acted on. This is deliberate groundwork for Phase 4 (e.g. capping free-tier scans per device rather than just per account, or requiring extra verification for flagged devices), not active enforcement today. See §7.10, §10.7, §14 for the deferred items (FK cascade behaviour, RLS verification) blocking that next step.

---

## 10. Data Models & Database Schema

### 10.1 `profiles` ✅

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  avatar_url  text,
  scan_count  integer default 0,
  created_at  timestamptz default now()
);
```

### 10.2 `scans` ✅

```sql
create table scans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id) on delete cascade,
  label           text,
  raw_ocr_text    text,
  image_url       text,
  safety_score    integer,
  ingredient_ids  uuid[],
  created_at      timestamptz default now()
);
```

### 10.3 `ingredients` ✅ (with caching)

```sql
create table ingredients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  aliases         text[],
  category        text,
  description     text,
  safety_level    text check (safety_level in ('safe', 'caution', 'harmful', 'unknown')),
  health_concerns text[],
  country_status  jsonb,
  last_updated    timestamptz default now()
);
```

> **v2.2:** `personal_flag` removed from this table. It was previously stored here and shown to every viewer of a cached ingredient regardless of their own preferences — a cross-user data leakage bug. The app no longer writes or reads this column. `supabase/migrations/20260704120000_drop_personal_flag_column.sql` drops it; run this against the live database (`alter table ingredients drop column if exists personal_flag;`).

### 10.4 `dietary_preferences` ✅

```sql
create table dietary_preferences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade unique,
  conditions  text[] default '{}',
  allergies   text[] default '{}',
  diet_type   text default 'none',
  updated_at  timestamptz default now()
);

alter table dietary_preferences enable row level security;

create policy "Users can manage own dietary preferences"
  on dietary_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

### 10.5 `subscriptions` 🔲 Pending (Phase 4)

```sql
create table subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid references profiles(id) on delete cascade unique,
  revenuecat_user_id   text,
  plan                 text check (plan in ('free', 'pro')),
  status               text,
  expires_at           timestamptz,
  updated_at           timestamptz default now()
);
```

### 10.6 Supabase RPC Functions

- `increment_scan_count(user_id)` 🔲 Exists in the schema but is **not called anywhere in client code** — `profiles.scan_count` is never actually updated today. Needs wiring into `saveAnalysis()`/`saveScan()` before PAY-01/SCAN-11 (free tier limit) can work. Recommend calling it as a non-blocking, best-effort fire-and-forget after a successful scan save, so a failure here never breaks scanning.
- `delete_user_account(user_id)` ✅ Called from Settings → deletes user data and auth record

### 10.7 Anti-Abuse Device Tables — ⚠️ Schema inferred, not from a tracked migration

There is no `migrations/` folder in this repo (see §9.4), so these three tables — used by `supabase/functions/track-device` (§9.8) — aren't defined in committed SQL anywhere. The shape below is **reconstructed from the Edge Function's queries**, not read from an actual schema definition — treat it as a best-effort reference and confirm real column types/constraints directly in the Supabase dashboard before relying on it.

```sql
-- Inferred — not from a tracked migration, see note above
create table devices (
  device_signature  text primary key,
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  account_count     integer default 0
);

create table user_devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references profiles(id) on delete cascade,
  device_signature  text references devices(device_signature),
  first_seen_at     timestamptz default now(),
  last_active_at    timestamptz default now(),
  unique (user_id, device_signature)
);

create table device_flags (
  device_signature  text primary key references devices(device_signature),
  status            text,   -- e.g. 'suspicious'
  reason            text,   -- e.g. 'linked to 4+ accounts'
  flagged_at        timestamptz default now()
);
```

Two known issues, both deliberately deferred to Phase 4 rather than fixed now (see §14):

- **`user_devices.user_id` is `ON DELETE CASCADE`** — an abusive account that deletes itself to evade detection would also erase its own device-linkage history, which defeats the point of tracking it in the first place. Should probably be `ON DELETE SET NULL` with the row otherwise retained, so the device-signature trail survives account deletion.
- **RLS lockdown is unverified.** Whether these three tables actually have row-level security policies locking access down to the service role (rather than being readable/writable by any authenticated client) isn't something that can be confirmed from this repo — needs checking directly in the Supabase dashboard.

---

## 11. API Specifications

### 11.1 Gemini API ✅

**Model:** `gemini-2.5-flash`
**Free tier:** 1,500 req/day
**Caching:** Supabase `ingredients` table
**Called from:** `supabase/functions/analyze-ingredients` (Deno Edge Function) — the client never talks to Gemini or holds its API key. `lib/gemini.ts` invokes the Edge Function via `supabase.functions.invoke('analyze-ingredients')`.
**Dietary context:** User preferences are sent to the Edge Function and injected into the Gemini prompt — Gemini returns a `personal_flag` per ingredient, but the client discards it rather than storing it (see §9.3) to avoid leaking one user's health context to others through the shared cache. Personal relevance shown on the results screen is always computed client-side instead.

**Response schema per ingredient (as returned by the Edge Function):**

```json
{
  "name": "Sodium Benzoate",
  "aliases": ["E211"],
  "category": "Preservative",
  "description": "...",
  "safety_level": "caution",
  "health_concerns": ["..."],
  "country_status": { "US": "permitted", "EU": "permitted_with_limits", ... },
  "personal_flag": "May trigger your sulphite allergy" | null
}
```

`personal_flag` here is a per-request hint only — see §9.3 for why it isn't persisted.

### 11.2 Email Validation — `lib/emailValidator.ts` ✅

1. Regex format check
2. IP address domain rejection
3. 300+ disposable/temp email domain blocklist
4. Subdomain variant check

Returns: `{ valid: true } | { valid: false; reason: string }`

### 11.3 Device Tracking — `supabase/functions/track-device` ✅ Tracking-only

**Called from:** `app/_layout.tsx`, fired once per Supabase `SIGNED_IN` auth event (not on every app launch/session restore — only on an actual sign-in action).
**Auth:** service-role key, server-side only — never exposed to the client.
**Input:** `{ userId: string, deviceSignature: string }` (signature generated client-side by `lib/deviceSignature.ts`, see §9.8).
**Behaviour:** upserts `devices` and `user_devices`, counts distinct accounts linked to the signature, and upserts a `device_flags` row if that count exceeds 3. Returns success/failure only — nothing in the response is currently read or acted on by the client. See §10.7 for the (inferred) table shapes.

---

## 12. Monetization Model

### 12.1 Tiers

| Feature                      | Free         | Pro ($4.99/mo or $34.99/yr) |
| ---------------------------- | ------------ | --------------------------- |
| Scans per month              | 5            | Unlimited                   |
| Basic ingredient definitions | ✅           | ✅                          |
| Safety level                 | ✅           | ✅                          |
| Full AI descriptions         | ❌ Truncated | ✅                          |
| Country ban data             | ❌ Locked    | ✅                          |
| Health concerns list         | ❌ Locked    | ✅                          |
| Dietary preference flagging  | ✅           | ✅                          |
| Scan history                 | Last 10      | Unlimited                   |
| PDF export                   | ❌           | ✅ Future                   |

### 12.2 Paywall Triggers 🔲

- Scan #6 in a month
- Tapping locked country data section
- Tapping truncated description
- Settings → Upgrade to Pro

### 12.3 RevenueCat 🔲

- `ingryn_pro_monthly` — $4.99/mo
- `ingryn_pro_annual` — $34.99/yr (~42% saving)
- Entitlement: `pro`

---

## 13. Non-Functional Requirements

### 13.1 Performance

- Scan-to-results: < 10s (target < 7s)
- App launch: < 3s cold start
- OCR: < 2s
- Gemini response: < 5s (target < 3s)
- Cache hit: < 500ms
- History list: 60fps up to 500 records

### 13.2 Security

- All API keys in env variables — Gemini's key specifically lives only in the `analyze-ingredients` Edge Function's environment, never in an `EXPO_PUBLIC_` variable or the client bundle
- Supabase RLS on all tables — confirmed on `dietary_preferences`; RLS coverage on remaining tables (`ingredients`, `scans`, `profiles`) should be verified directly in the Supabase dashboard, as this repo doesn't track that state
- Client-side rate limiting on auth
- Disposable email blocking
- Account deletion via RPC
- No personal health data (allergies/conditions) is ever written to a table shared across users — enforced by keeping `personal_flag` client-side only (v2.2)
- `analyze-ingredients` Edge Function rejects requests over 3,000 characters, blocking oversized-payload abuse against a public, cost-metered endpoint (v2.3)
- Confirmed repo-wide: no hardcoded API keys/secrets, no tracked `.env` files, `.gitignore` covers `.env`, key files (`.jks`/`.p8`/`.p12`/`.key`/`.mobileprovision`), and `google-services-key.json`
- `npm audit` reports 11 moderate-severity findings, all in build-only tooling (`uuid` → `xcode` → `@expo/config-plugins`, pulled in transitively by Expo's own CLI/config tooling) — none of this ships in the app bundle. **Do not run `npm audit fix --force`**: it would downgrade to `expo@46`, which would break this SDK 56 app.
- ⚠️ Not verifiable from this repo — confirm directly in Supabase: does `delete_user_account(user_id)` check `auth.uid() = user_id` *inside* the function body (e.g. `security definer` with an internal check), or does it trust the client-supplied `user_id` param as-is? If the latter, a signed-in user could potentially pass a different user's ID and delete someone else's account. Client-side, `settings.tsx` always passes the caller's own ID, but that's not a security boundary — the RPC itself needs to enforce it.
- Unused `RECORD_AUDIO` Android permission removed (v2.3) — no microphone code exists anywhere in the app; unused sensitive permissions are an unnecessary privacy footprint and a Play Store review risk
- ⚠️ Google Sign-In (`lib/auth.ts`) throws at import time on native if `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` aren't set, and there's currently no `.env.example` anywhere in the repo documenting them — see §9.1, §15
- ⚠️ RLS lockdown on the three anti-abuse device tables (`devices`, `user_devices`, `device_flags`, §10.7) is unverified from this repo, and `user_devices.user_id`'s `ON DELETE CASCADE` would erase abuse evidence exactly when an abusive account deletes itself — both deliberately deferred to Phase 4, see §14

### 13.3 Privacy

- No third-party data selling
- GDPR-compliant full data deletion ✅
- No individual-identifying analytics
- Device-tracking anti-abuse system (§7.10, §9.8) hashes a device fingerprint (SHA-256, not stored in plaintext) and links it to signing-in accounts, purely for anti-abuse instrumentation ahead of Phase 4 enforcement — worth reflecting explicitly in the Privacy Policy content served from `/legal/[type]` once enforcement actually ships, since "we fingerprint your device" is the kind of thing users reasonably expect disclosed

### 13.4 Accessibility

- Accessible labels on all interactive elements
- Minimum touch target: 44×44pt
- Safety level always shown as text + colour
- System font size scaling supported

### 13.5 App Store Requirements

- Camera permission string: "INGRYN needs camera access to scan ingredient labels"
- iOS minimum: iOS 15
- Android minimum: API 26 (Android 8.0)
- Android permissions requested: `CAMERA`, `READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `INTERNET` — `RECORD_AUDIO` removed in v2.3 as unused (see §13.2); every remaining permission has a corresponding, justifiable in-app feature
- Native splash screen (`assets/splash-icon.png`) now correctly stays visible through app launch instead of flashing to blank/spinner (v2.3, see §9.3)

---

## 14. Release Phases

### Phase 1 — Foundation ✅ Complete

Expo + Supabase setup, auth, tab navigation shell

### Phase 2 — Core Scanner ✅ Complete

Camera, OCR, Gemini integration, results + ingredient detail screens

### Phase 3 — Data & Auth Hardening ✅ Complete

Scan history, ingredient caching, inline errors, rate limiting, email validation, forgot password, dietary preferences

### Phase 3.5 — UI Overhaul ✅ Complete

- Full premium light theme across all 13 screens
- Design system (`constants/theme.ts`)
- Plus Jakarta Sans typography
- Phosphor icons replacing lucide-react-native
- LinearGradient CTAs and safety cards
- Onboarding routing fixed (AsyncStorage direct read)
- `signup.tsx` bug fixed (had signin code)
- `app/index.tsx` routing conflict removed
- `dietary_preferences` upsert `onConflict` fix
- 117-ingredient seed dataset

### Phase 3.6 — Data Integrity & Hygiene Pass ✅ Complete (July 2026)

- Fixed cross-user `personal_flag` data leakage — no longer persisted to the shared `ingredients` cache; computed client-side per viewer instead
- ~~Migration written to drop the now-unused `personal_flag` column~~ **Correction (v2.4):** no `migrations/` folder exists in this repo — either applied directly against Supabase or not yet done; worth confirming (see §9.3, §9.4)
- Removed all remaining `Alert.alert` usage (history delete, account delete + error, signup verification) via new `ConfirmDialog` component
- Confirmed Gemini analysis fully migrated to a Supabase Edge Function — no client-side API key
- Confirmed legal pages (Privacy/Terms) are live, not placeholders
- Removed unused `lucide-react-native`, `nativewind`, `tailwindcss` dependencies
- Cleaned up a dead empty `else` block in `useIngredientAnalysis.ts`
- Corrected this document's folder structure, schema, and status tables against the live repo

### Phase 3.7 — Production Readiness Pass ✅ Complete (July 2026)

- Removed the 4-slide onboarding flow entirely — welcome screen is now the only landing screen for signed-out users, new or returning (see §8.1, §9.5)
- Fixed the native splash screen hiding before fonts/session were ready, which caused a blank/spinner flash on every app launch
- Removed the unused `RECORD_AUDIO` Android permission — no microphone code exists anywhere in the app
- Added a 3,000-character input cap to the `analyze-ingredients` Edge Function to block abuse/cost overruns on that public endpoint (🔲 needs redeploying — see below)
- ~~Added `.env.example` documenting required environment variables~~ **Correction (v2.4):** re-verified against a fresh clone, this file does not exist in the repo (see §9.3, §15)
- Confirmed no hardcoded secrets, no tracked `.env` files, `.gitignore` covers key material
- Flagged (not yet resolved, needs manual verification in Supabase): RLS coverage on `ingredients`/`scans`/`profiles`, and whether `delete_user_account` enforces `auth.uid() = user_id` server-side rather than trusting the client-supplied ID
- Confirmed `npm audit`'s 11 moderate findings are all in build-only tooling, not runtime code — no action needed pre-launch

> The Edge Function change in this phase (`supabase/functions/analyze-ingredients/index.ts`) needs `supabase functions deploy analyze-ingredients` to take effect — code changes to Edge Functions don't go live until redeployed.

### Phase 3.8 — Anti-Abuse Device Tracking ✅ Base complete (tracking-only) — undocumented until v2.4

- Device signature generation + hashing (`lib/deviceSignature.ts`)
- `track-device` Edge Function: records device↔account links, flags devices linked to >3 accounts (`supabase/functions/track-device`)
- Fires on every sign-in (`SIGNED_IN` auth event in `app/_layout.tsx`)
- 🔲 Deliberately not yet: acting on flags, RLS lockdown verification, `user_devices.user_id` FK cascade fix (currently erases evidence on account deletion) — all deferred to Phase 4, see §7.10, §9.8, §10.7

### Phase 3.9 — Real-Time Ingredient Detection System (RTIDS) ✅ Base complete — undocumented until v2.4

- Live auto-scan: `DetectionEngine`, `CameraStateMachine`, `FuzzyMatcher`, red→yellow→green confidence overlay (`changes made by antigravity` commit)
- No new runtime dependency added
- 🔧 This session's refinement pass, **written but not yet committed/pushed**: torch/flash decoupling, preview-frame cache cleanup, adaptive frame rate, continuous confidence-gradient overlay colour, guide-box text confinement — see §9.7.4
- 🔲 Not planned unless real-device testing shows a problem: migrating off `expo-camera` to a true frame-processor pipeline (see §9.7.3)

### Phase 4 — Monetisation 🔲 Next

- RevenueCat SDK
- Paywall screen
- Free tier scan limit (5/month) — first requires wiring `increment_scan_count` into the scan-save flow (see §10.6)
- Feature gating
- Subscription status in settings + restore purchases
- Act on device-abuse flags from Phase 3.8 (currently tracking-only) — likely alongside the free-tier limit work, since per-device limits are the more natural anti-abuse lever than per-account alone
- Fix `user_devices.user_id` FK cascade behaviour + verify RLS lockdown on the three anti-abuse tables (§10.7) before enforcement goes live

### Phase 5 — Polish & Launch 🔲

- ~~Google OAuth~~ ✅ Already done — corrected in v2.4, see §7.1
- ~~OCR text review/edit before analysis~~ ✅ Already done — corrected in v2.4, see §7.2
- Add `.env.example` (still doesn't exist — see §9.3, §15), covering both Supabase and Google Sign-In vars
- Error state hardening across all screens
- App Store + Play Store assets
- TestFlight / internal testing
- Submission

---

## 15. Open Questions & Risks

| #  | Question / Risk                                                                                                                                                                   | Status                                                                                                                                                                                                                                                                                 |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Gemini free tier (1,500 req/day) — ingredient caching significantly reduces calls                                                                                                | ✅ Mitigated                                                                                                                                                                                                                                                                           |
| 2  | ML Kit OCR accuracy on glossy/curved labels                                                                                                                                       | 🔲 Test on physical device                                                                                                                                                                                                                                                             |
| 3  | Country ban data accuracy — Gemini has training cutoff                                                                                                                           | 🔲 Add disclaimer in UI                                                                                                                                                                                                                                                                |
| 4  | App Store approval — avoid medical claims in all copy                                                                                                                            | 🔲 Copy review needed                                                                                                                                                                                                                                                                  |
| 5  | OCR garbled text confidence threshold                                                                                                                                             | ✅ Implemented as`text.length < 10` in `useScanner.ts` (this doc previously proposed <50 — decide if 10 is intentionally low or should be raised, since very short-but-valid OCR results could still slip through)                                                                |
| 6  | Gemini API called client-side — should move to Edge Function pre-launch                                                                                                          | ✅ Resolved — confirmed migrated to`analyze-ingredients` Edge Function                                                                                                                                                                                                              |
| 7  | Mixed-script labels (English + Hindi) — OCR behaviour untested                                                                                                                   | 🔲 Open                                                                                                                                                                                                                                                                                |
| 8  | `--legacy-peer-deps` required for all installs                                                                                                                                  | ✅ Documented, and now automatic via`.npmrc`                                                                                                                                                                                                                                         |
| 9  | `personal_flag` on cached ingredients shows null until re-scan                                                                                                                  | ✅ Resolved differently than originally planned — rather than a "shows null" gap, this was actually a cross-user leakage bug (a stale non-null flag from a different user could be shown). Fixed in v2.2 by never persisting the field and always computing it client-side; see §9.3 |
| 10 | RLS coverage on`ingredients`, `scans`, and `profiles` tables                                                                                                                | 🔲 Not verifiable from this repo — confirm directly in the Supabase dashboard (only`dietary_preferences` RLS is visible in tracked SQL)                                                                                                                                             |
| 11 | `increment_scan_count` RPC exists but is never invoked                                                                                                                          | 🔲 Needs wiring into the scan-save flow before free-tier enforcement (PAY-01/SCAN-11) can work — see §10.6                                                                                                                                                                           |
| 12 | Does`delete_user_account(user_id)` enforce `auth.uid() = user_id` server-side?                                                                                                | 🔲 Not verifiable from this repo — confirm in Supabase that the RPC checks this internally rather than trusting the client-supplied ID; see §13.2                                                                                                                                    |
| 13 | `npm audit` — 11 moderate findings via `uuid`/`xcode`/`@expo/config-plugins`                                                                                             | ✅ Confirmed build-tooling-only (not shipped in the app bundle); do not`npm audit fix --force`, it would downgrade Expo and break the app — see §13.2                                                                                                                              |
| 14 | `analyze-ingredients` Edge Function input-length fix needs redeployment                                                                                                         | 🔲 Code changed in the repo (v2.3) but Edge Functions don't auto-deploy — run`supabase functions deploy analyze-ingredients`                                                                                                                                                        |
| 15 | RTIDS uses repeated full-image captures instead of a true frame-processor pipeline                                                                                                | ⚠️ Known tradeoff, not a bug —`expo-camera` doesn't expose frame processors. Heavier on battery/latency than a lightweight frame sample would be. Only worth migrating to `react-native-vision-camera` if real-device testing shows an actual problem — see §9.7.3            |
| 16 | Guide-box → photo pixel mapping assumes screen-percentage ≈ photo-percentage                                                                                                    | 🔲 Not pixel-verified on a real device — works in the common case but hasn't been checked against an actual capture on an actual phone; see §9.7.4                                                                                                                                   |
| 17 | RTIDS live-preview frames use`skipProcessing: true`, which can leave orientation unresolved on some devices per Expo's own docs                                                 | 🔲 Could skew guide-box filtering (#16) specifically for live-loop frames — the final one-time capture doesn't use `skipProcessing` and isn't affected; worth confirming on a real device, especially portrait vs. landscape                                                        |
| 18 | Google Sign-In throws at native app startup if its required env vars aren't set, and there's no`.env.example` anywhere in the repo to document them                             | 🔲 Open — see §9.1, §15 item 20 for the missing file itself                                                                                                                                                                                                                         |
| 19 | `devices`/`user_devices`/`device_flags` aren't defined in any tracked migration — schema in §10.7 is inferred from Edge Function code, not read from an actual definition | 🔲 Confirm real column types/constraints directly in Supabase; consider setting up tracked migrations going forward so this stops happening                                                                                                                                            |
| 20 | `.env.example` still doesn't exist, despite two prior versions of this doc (v2.3, and the folder-structure note before that) claiming it had been added                         | 🔲 Open — needs creating, now covering both Supabase and Google Sign-In vars (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`/`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`); see §9.1, §9.3                                                                                                            |
| 21 | `user_devices.user_id` is `ON DELETE CASCADE` — erases device-linkage evidence if an abusive account deletes itself                                                          | 🔲 Deliberately deferred to Phase 4 — should likely be`ON DELETE SET NULL` with the row retained instead; see §10.7, §14                                                                                                                                                          |
| 22 | RLS lockdown on the three anti-abuse device tables is unverified                                                                                                                  | 🔲 Deliberately deferred to Phase 4 — confirm directly in the Supabase dashboard before any enforcement logic goes live against these tables; see §10.7, §14                                                                                                                        |
| 23 | This session's RTIDS refinement pass (torch/flash, cache cleanup, adaptive rate, gradient overlay, guide-box filter) is written but not yet committed/pushed                      | 🔲 Files delivered — apply locally, run`npm run` on a real device to sanity-check items #15–17 above, then push. See §9.7.4                                                                                                                                                       |

---

*End of PRD v2.4*
*Update version and date on every significant change.*
