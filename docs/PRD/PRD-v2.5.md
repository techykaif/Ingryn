# INGRYN — Product Requirements Document

**Version:** 2.5  
**Date:** September 30, 2026  
**Status:** Active Development  
**Platform:** iOS + Android (React Native / Expo)

> Current product specification for the v2.5 development baseline. The root `README.md` is intentionally kept concise and developer-facing; detailed product requirements belong in this directory.

## 1. Executive Summary

INGRYN is a mobile-first SaaS application that allows users to scan product ingredient labels using a phone camera and receive AI-powered analysis. The application extracts ingredient text, identifies ingredients, provides definitions and safety information, highlights country-specific restrictions, and applies the user's dietary preferences to the results.

The scanner is intentionally camera-first while retaining three explicit input modes: **Camera, Photos, and Manual Entry**. Camera and photo inputs move directly from OCR into the durable server-side analysis pipeline. Manual Entry is a deliberate text-input path for users who already have the ingredient list available.

The current product includes native authentication, Google Sign-In, camera/photo scanning, ML Kit OCR, direct OCR-to-analysis UX, Real-Time Ingredient Detection System (RTIDS), durable server-side scan processing, ingredient caching, country-rule freshness and refresh infrastructure, dietary personalization, scan history, account/device security controls, and a server-enforced billing foundation for future monetization.

## 2. Problem Statement

Ingredient labels can contain many unfamiliar compounds, preservatives, additives, colours, flavour enhancers, and other substances. Consumers often need to research ingredients individually and may not know whether an ingredient is restricted in another country or relevant to their own dietary requirements.

INGRYN addresses this with a camera-first workflow while preserving alternate input methods:

```text
                   ┌─────────────── Camera ───────────────┐
                   │                                      ↓
Product label →  Photos → OCR → Durable Analysis → Personalized Results
                   │
                   └────────── Manual Entry ──────────────┘
```

The image paths do **not** include an OCR review/edit screen. Manual text editing happens only in the dedicated Manual Entry mode.

## 3. Product Goals

- Make ingredient-label analysis fast and accessible.
- Make camera scanning feel immediate through live detection and automatic capture.
- Preserve reliable fallback paths through Photos and Manual Entry.
- Move long-running ingredient analysis to durable server-side processing.
- Provide structured ingredient explanations rather than raw AI text.
- Personalize results using the current user's dietary preferences.
- Keep AI credentials, shared-cache writes, and privileged operations server-side.
- Maintain per-user data isolation.
- Prepare the backend for sustainable SaaS monetization without trusting client-side counters.

## 4. Current Product Scope

### Completed

- Email/password authentication.
- Password reset.
- Disposable-email blocking.
- Client-side login attempt backoff.
- Native Google Sign-In → Supabase `signInWithIdToken`.
- Session persistence and authenticated routing.
- Camera scanning with live preview.
- Automatic ingredient-list detection and capture through RTIDS.
- Tap-to-capture fallback.
- Photos/gallery label selection.
- Manual ingredient text entry.
- ML Kit OCR extraction.
- Direct Camera/Photos OCR → analysis flow with no OCR review/edit step.
- Manual Entry text → the same analysis path.
- Durable `scan_analysis_jobs` queue for server-side scan processing.
- Lease/retry/cursor handling for long ingredient lists and transient worker failures.
- Realtime scan-result updates with polling fallback.
- AI ingredient analysis through the `analyze-ingredients` Supabase Edge Function.
- Server-side Gemini API key handling.
- Ingredient definitions, categories, safety information, and country restrictions.
- Server-owned ingredient caching.
- Dietary preferences including allergies, conditions, and diet type.
- Viewer-specific relevance flagging without persisting personal flags into the shared ingredient cache.
- Scan history, search, and deletion.
- Ingredient detail views.
- Settings, profile editing, password change, sign-out, and account deletion.
- Premium light UI/design system.
- Plus Jakarta Sans typography.
- Phosphor icons.
- LinearGradient UI elements.
- Inline errors/notices and reusable confirmation dialogs instead of `Alert.alert`.
- Legal screens for Privacy Policy and Terms of Service.
- Seed ingredient dataset.
- Native splash handling through font/session initialization.
- Real-Time Ingredient Detection System (RTIDS).
- Country-rule source/versioning and automated refresh infrastructure.
- Device-tracking anti-abuse instrumentation.
- Server-side usage accounting and AI usage telemetry.
- Server-enforced billing/entitlement foundation with enforcement configurable independently from the client.
- Least-privilege access controls for server-managed tables.
- Vault-backed internal authentication for the scan-analysis worker.

### In Progress / Next

- RevenueCat subscription integration.
- Paywall and entitlement UI/state.
- Production free-tier scan allowance configuration and user-facing enforcement behavior.
- Device-abuse enforcement/response rules.
- Broader RTIDS device validation and tuning.
- Database migration/reproducibility improvements so the repository can fully reproduce the production schema locally.

### Out of Scope for the current product baseline

- Barcode scanning.
- Social/sharing features.
- Web application.
- Offline mode.
- Multi-language label OCR.
- Nutritional analysis.
- PDF export.

## 5. Feature Requirements

### Authentication

- Email/password sign-up and sign-in.
- Google Sign-In through native Google Sign-In.
- Password reset.
- Persistent sessions.
- Sign-out.
- Authenticated route protection.
- Display-name editing.
- Password change.
- Account deletion through an authenticated server function.
- Disposable-email blocking.
- Login attempt backoff.
- Secure native session storage.

### Scanner

The scanner exposes exactly three entry modes:

**Camera**
- Camera permission handling.
- Full-screen live camera preview.
- RTIDS live ingredient detection.
- Automatic capture after stable high-confidence detection.
- Tap-to-capture fallback.
- Direct OCR → durable analysis.
- No OCR review/edit screen.

**Photos**
- Select an existing label photo from the device library.
- OCR extraction.
- Direct OCR → durable analysis.
- No OCR review/edit screen.

**Manual Entry**
- Dedicated multiline ingredient text input.
- User can type or paste ingredient text.
- Direct text → durable analysis.
- This is the only intentional text-editing step in the scanner experience.

All three modes converge on the same server-owned scan analysis lifecycle after text is obtained.

### Real-Time Ingredient Detection System (RTIDS)

RTIDS adds live detection on top of the normal scanner pipeline without calling the AI model during the camera preview.

The current state machine uses a stable high-confidence threshold before automatic capture:

- Ingredient confidence threshold: 85%.
- Required continuous stability: 1 second.
- Nutrition-table detections are treated as guidance to find the ingredient section.
- Barcode detections are treated as guidance to find the ingredient list.
- Unknown/probable detections provide non-blocking guidance rather than triggering an AI request.

The intended flow is:

```text
Live camera
    ↓
Frame detection
    ↓
DetectionEngine
    ↓
Confidence evaluation
    ↓
Minimal camera feedback
    ↓
Stable ingredient detection
    ↓
Auto capture
    ↓
OCR
    ↓
Durable scan job
    ↓
Server analysis
    ↓
Results
```

The camera interface intentionally avoids the legacy rectangular bracket overlay, confidence bar, and scan-line treatment.

### OCR

- OCR is performed on-device using ML Kit text recognition.
- Camera captures and selected Photos images are analyzed immediately after OCR.
- OCR text is optionally constrained to the centered ingredient region using the existing guide-box mapping/filter.
- The OCR result is not presented in an intermediate editable review screen.
- Manual Entry bypasses OCR entirely.

### Durable Scan Analysis

The mobile client creates a scan and the server owns long-running ingredient resolution.

The queue stores durable state including:

- Scan/job status.
- Retry state.
- Lease/claim information.
- Ingredient processing cursor.
- Persisted analysis state and errors.

Processing is chunked so long ingredient lists do not depend on the app remaining open. Successful chunks reset consecutive retry state, while transient failures use bounded retry/backoff behavior.

The production recovery model includes:

- Immediate worker invocation after eligible scan creation.
- One-minute cron recovery for outstanding work.
- Realtime scan updates when the result changes.
- Polling fallback when Realtime is unavailable.

### AI Analysis

The client does not call Gemini directly. The `analyze-ingredients` Edge Function handles:

- Authentication/authorization.
- Input validation and sanitization.
- Dietary-preference validation.
- Shared ingredient-cache lookup and server-owned writes.
- Gemini requests.
- Structured-result validation.
- Appropriate retry behavior and spend controls.

The `process-scan-analysis` worker coordinates durable processing and uses a Vault-backed internal token rather than the normal user JWT.

### Personalization

Dietary preferences are stored for the authenticated user. Personal relevance is computed for that viewer and is not written into shared ingredient-cache records. This prevents one user's dietary flags from leaking into another user's results.

### Country Restrictions

The product includes country-specific ingredient restriction information for the supported countries documented by the application data model.

Country-rule data is versioned and refreshed through a protected server-side process. Source freshness and verification state are part of the read/publish model so stale regulatory information is not silently presented as current.

### Scan History

Users can review previous scans, search their history, open scan details, and delete scan records. Database access is protected with row-level security for user-owned scan data.

### Device Tracking / Anti-Abuse

The current system records a hashed device signature when users authenticate and links the device to the account through the `track-device` Edge Function. Devices associated with more than three accounts can be flagged.

This remains **tracking-only** until monetization enforcement rules are enabled. Server-side usage and entitlement infrastructure is designed so future enforcement does not rely on client counters.

### Billing Foundation

The backend contains the foundations for monetization:

- Monthly scan-usage accounting.
- Daily AI request telemetry.
- Server-owned entitlement records.
- Configurable billing/usage enforcement.
- AI emergency kill switch and per-user daily request guard.
- Device-abuse signals.

Current defaults keep the product available while these controls are being integrated into the user-facing subscription experience.

## 6. Technical Architecture

### Client

- React Native.
- Expo SDK 56.
- Expo Router.
- React 19.
- React Native 0.85.
- Zustand for client state.
- TanStack Query for server/data fetching where applicable.
- Expo Camera and Image Picker.
- ML Kit text recognition for OCR.
- Reanimated.
- Phosphor icons.
- Plus Jakarta Sans.

### Backend

- Supabase Auth.
- PostgreSQL.
- Row Level Security.
- Supabase Edge Functions.
- pg_cron and pg_net for scheduled/recovery work.
- Gemini through the `analyze-ingredients` Edge Function.
- Durable scan processing through the `process-scan-analysis` Edge Function.
- `track-device` for device instrumentation.
- `delete-account` for privileged account deletion.
- `refresh-country-rules` for regulatory refresh/versioning.

### High-level architecture

```text
┌──────────────────────────────────────────────────────┐
│                   INGRYN Mobile App                  │
│                                                      │
│ Expo Router • React Native • Zustand                 │
│ Camera • RTIDS • OCR • Photos • Manual Entry         │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│                     Supabase                         │
│                                                      │
│ Auth • PostgreSQL • RLS • Realtime • pg_cron/pg_net │
└───────┬─────────────────────┬────────────────────────┘
        │                     │
        ▼                     ▼
 Ingredient / User Data   Edge Functions
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
 analyze-ingredients  process-scan-     refresh-country-
                      analysis           rules
          │               │
          └───────┬───────┘
                  ▼
                Gemini
```

## 7. Data Model

The current Supabase application schema includes tables such as:

- `profiles`
- `ingredients`
- `scans`
- `dietary_preferences`
- `scan_analysis_jobs`
- `scan_usage_monthly`
- `ai_usage_daily`
- `billing_config`
- `user_entitlements`
- `country_rule_sources`
- `country_rule_versions`
- `ingredient_country_rules`
- `country_rule_refresh_runs`
- `devices`
- `user_devices`
- `device_flags`

User-owned application data is protected with RLS. Server-managed tables such as usage telemetry, billing configuration, entitlement state, refresh-run state, device instrumentation, and scan-analysis jobs are intentionally not directly writable/readable by `anon` or `authenticated`; privileged server components use service-role access.

The production database schema is currently maintained through the Supabase environment alongside repository migrations. Full local schema reproducibility remains an engineering priority.

## 8. Security Requirements

- Never expose the Gemini API key in the client bundle.
- Authenticate protected Edge Function requests.
- Use a protected internal token for service-triggered scan-worker invocations.
- Validate user identity before privileged account/device operations.
- Validate and sanitize AI input.
- Restrict dietary-preference values to known values.
- Keep user-owned database records isolated with RLS.
- Keep server-managed tables inaccessible to normal client roles.
- Do not persist viewer-specific dietary flags in shared ingredient-cache records.
- Use secure native session storage for mobile authentication sessions.
- Avoid storing secrets in source control.
- Keep privileged database primitives inaccessible as direct public APIs where possible.
- Preserve server-side ownership of usage, entitlement, and abuse-prevention decisions.

## 9. UX / UI Requirements

The current design system emphasizes a premium light/natural visual language with:

- Plus Jakarta Sans.
- Phosphor icons.
- Consistent spacing, radius, typography, shadows, and colors.
- LinearGradient primary actions and safety cards.
- Inline feedback instead of platform alert dialogs.
- Clear loading and processing states.

Scanner-specific requirements:

- Camera is the primary surface.
- Camera uses a clean full-screen presentation rather than a boxed scan target.
- No legacy rectangular brackets, scan line, or confidence bar.
- Camera shows minimal live/detected state feedback.
- Photos and Manual Entry remain one-tap alternate modes.
- Camera and Photos never expose OCR review/edit.
- Manual Entry is a separate, explicit text-input experience.
- Processing state is visible while a scan is being created.
- Results state is driven by the persisted server-side scan lifecycle.

## 10. Monetization

The next product phase is monetization.

Planned model:

- Free tier with a limited number of scans per month.
- Premium subscription through RevenueCat.
- Paywall and entitlement-aware feature gating.
- Server-side scan usage enforcement.
- Device-abuse signals as an additional protection layer.

The backend already contains usage accounting, entitlement storage, billing configuration, Gemini request guards, and an emergency AI kill switch. The remaining work is integrating RevenueCat and enabling the desired production policies.

## 11. Release Phases

### Phase 1 — Core Product

Authentication, scanner, OCR, ingredient analysis, results, and basic data storage.

### Phase 2 — Product Experience

Personalization, scan history, settings, legal screens, design-system overhaul, caching, and reliability improvements.

### Phase 3 — Intelligent Scanning & Hardening

Google Sign-In, RTIDS, direct OCR-to-analysis scanner UX, durable server-side Gemini processing, country-rule freshness, account/device security hardening, least-privilege database access, and production CI validation.

### Phase 4 — Monetization

RevenueCat, paywall, free scan limits, entitlement enforcement, scan-count wiring, and device-abuse response logic.

### Phase 5 — Release Hardening

Preview-build validation, supported-device testing, migration reproducibility, auth-security configuration, observability, failure-mode testing, and final store-readiness work.

## 12. Known Development Priorities

1. Complete RevenueCat integration.
2. Implement paywall and production subscription state.
3. Enable the desired free scan allowance and verify server enforcement end-to-end.
4. Define safe behavior for flagged devices.
5. Finish RTIDS refinement across supported devices.
6. Validate Camera, Photos, and Manual Entry flows in preview builds.
7. Improve local database migration/reproducibility.
8. Enable stronger authentication security settings, including leaked-password protection.
9. Add broader production observability and failure-mode coverage.
10. Complete final iOS/Android release-readiness checks.

## 13. Documentation History

| Version | Date | Summary |
|---|---|---|
| 1.0 | June 2026 | Initial PRD. |
| 2.0 | June 2026 | Major product update covering the completed early phases, authentication hardening, and ingredient caching. |
| 2.1 | June 2026 | UI/design-system overhaul, typography/icons, dietary preference fixes, onboarding routing, and signup fixes. |
| 2.2 | July 2026 | Data-integrity and hygiene pass, including viewer-specific dietary flag isolation, confirmation-dialog migration, server-side Gemini processing, legal screens, and dependency cleanup. |
| 2.3 | July 2026 | Production-readiness pass covering onboarding removal, splash timing, permission cleanup, Edge Function input limits, and secret/configuration review. |
| 2.4 | July 2026 | Documentation catch-up for RTIDS and device tracking, plus scanner refinement direction. |
| 2.5 | September 2026 | Current baseline: three-mode scanner UX, direct OCR-to-analysis flow, durable server-side scan worker/retries, Realtime result updates, country-rule freshness infrastructure, billing foundation, and server-side security/least-privilege hardening. |

## 14. Status

**Active development.** Core scanning, OCR, durable AI analysis, personalization, country-rule infrastructure, and major security foundations are implemented. The current product focus is preview-build validation and monetization completion, followed by final release hardening.
