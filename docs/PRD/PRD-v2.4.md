# INGRYN — Product Requirements Document

**Version:** 2.4  
**Date:** July 2026  
**Status:** Active Development  
**Platform:** iOS + Android (React Native / Expo)

> Archived product specification for the v2.4 development baseline. The root `README.md` is intentionally kept concise and developer-facing; detailed product requirements belong in this directory.

## 1. Executive Summary

INGRYN is a mobile-first SaaS application that allows users to scan product ingredient labels using a phone camera and receive AI-powered analysis. The application extracts ingredient text, lets the user review/edit OCR output, identifies ingredients, provides definitions and safety information, highlights country-specific restrictions, and applies the user's dietary preferences to the results.

The product is designed for health-conscious consumers, parents, people with dietary restrictions, travellers, fitness users, and anyone who wants to understand product ingredient labels without researching every ingredient manually.

The current product includes native authentication, Google OAuth, camera/gallery scanning, OCR, OCR review, Gemini-powered analysis through a Supabase Edge Function, ingredient caching, country restrictions, dietary personalization, scan history, a premium UI system, Real-Time Ingredient Detection System (RTIDS), and device-tracking instrumentation for future anti-abuse enforcement.

## 2. Problem Statement

Ingredient labels can contain many unfamiliar compounds, preservatives, additives, colours, flavour enhancers, and other substances. Consumers often need to research ingredients individually and may not know whether an ingredient is restricted in another country or relevant to their own dietary requirements.

INGRYN addresses this with a camera-first workflow:

```text
Product label
    ↓
Camera / Gallery
    ↓
OCR
    ↓
Review & Edit
    ↓
Ingredient Analysis
    ↓
AI + Cached Ingredient Data
    ↓
Personalized Results
```

## 3. Product Goals

- Make ingredient-label analysis fast and accessible.
- Keep the scan-to-results experience simple.
- Provide structured ingredient explanations rather than raw AI text.
- Personalize results using the current user's dietary preferences.
- Keep AI credentials and privileged operations server-side.
- Maintain per-user data isolation.
- Support a sustainable SaaS monetization model.

## 4. Current Product Scope

### Completed

- Email/password authentication.
- Password reset.
- Disposable-email blocking.
- Client-side login attempt backoff.
- Native Google Sign-In → Supabase `signInWithIdToken`.
- Session persistence and authenticated routing.
- Camera scanning.
- Gallery fallback.
- OCR text extraction.
- OCR review/edit before analysis.
- Manual ingredient text entry.
- AI ingredient analysis through the `analyze-ingredients` Supabase Edge Function.
- Server-side Gemini API key handling.
- Ingredient definitions, categories, safety information, and country restrictions.
- Ingredient caching in Supabase.
- Dietary preferences including allergies, conditions, and diet type.
- Viewer-specific relevance flagging computed client-side rather than persisted to shared ingredient cache.
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
- Device-tracking anti-abuse instrumentation.

### In Progress / Next

- RevenueCat subscription integration.
- Paywall and entitlement handling.
- Free-tier scan limits.
- Wiring the existing scan-count RPC into the actual scan flow.
- Enforcement/response logic for device-abuse flags.
- Further RTIDS refinement.

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
- Google OAuth through native Google Sign-In.
- Password reset.
- Persistent sessions.
- Sign-out.
- Authenticated route protection.
- Display-name editing.
- Password change.
- Account deletion.
- Disposable-email blocking.
- Login attempt backoff.

### Scanner

- Camera permission handling.
- Live camera preview.
- Automatic ingredient-list detection and capture.
- Tap-to-capture fallback.
- Gallery selection.
- Manual ingredient entry.
- OCR extraction.
- Direct image OCR-to-analysis flow without an editable review screen.
- Manual text-to-analysis flow.
- Reset/retry flow.
- Lifecycle-safe scanner state handling.

### Real-Time Ingredient Detection System (RTIDS)

RTIDS adds live detection on top of the normal scanner pipeline. A custom detection engine evaluates camera frames and identifies likely ingredient-list content using confidence scoring and fuzzy matching.

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
Subtle camera feedback
    ↓
Stable detection
    ↓
Auto capture
    ↓
OCR
    ↓
Durable analysis pipeline
```

Camera is the primary scan experience, with Photos and Manual Entry as alternate input modes. Camera and photo OCR bypass editable review and enter the analysis pipeline directly.

### AI Analysis

The client sends ingredient text to the Supabase Edge Function rather than directly exposing the Gemini API key. The function authenticates the request, validates and sanitizes input, validates dietary-preference values, calls Gemini, retries appropriate rate-limit responses, and validates the returned structured data.

### Personalization

Dietary preferences are stored for the authenticated user. Personal relevance is calculated for that viewer and is not written into the shared ingredient cache. This prevents one user's dietary flags from leaking into another user's results.

### Country Restrictions

The product includes country-specific ingredient restriction information for the supported countries documented by the application data model.

### Scan History

Users can review previous scans, search their history, open scan details, and delete scan records. Database access is protected with row-level security for user-owned scan data.

### Device Tracking / Anti-Abuse

The current system records a hashed device signature when users authenticate and links the device to the account through the `track-device` Edge Function. Devices associated with more than three accounts can be flagged.

This is currently **tracking-only**. It does not block or restrict users yet. Enforcement is planned as part of monetization/abuse-prevention work.

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

- Supabase.
- Supabase Auth.
- PostgreSQL.
- Row Level Security for user-owned application data.
- Supabase Edge Functions.
- Gemini through the `analyze-ingredients` Edge Function.
- `track-device` Edge Function for device instrumentation.

### High-level architecture

```text
┌───────────────────────────────────────────────┐
│                 INGRYN Mobile App             │
│                                               │
│  Expo Router • React Native • Zustand         │
│  Camera • OCR • RTIDS • User Preferences      │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────┐
│                    Supabase                   │
│                                               │
│ Auth • PostgreSQL • RLS • Edge Functions      │
└───────────────┬───────────────────┬───────────┘
                │                   │
                ▼                   ▼
       Ingredient Cache       AI Analysis
                               Edge Function
                                    │
                                    ▼
                                  Gemini
```

## 7. Data Model

The current Supabase application schema includes tables such as:

- `profiles`
- `ingredients`
- `scans`
- `dietary_preferences`
- `devices`
- `user_devices`
- `device_flags`

User-owned application data is protected with RLS. The `devices` and `device_flags` tables are intentionally handled by the server-side device-tracking function using privileged access after authentication and user validation.

The production database schema is currently maintained through the Supabase environment/dashboard rather than being fully represented as local repository migrations.

## 8. Security Requirements

- Never expose the Gemini API key in the client bundle.
- Authenticate protected Edge Function requests.
- Validate user identity before privileged device operations.
- Validate and sanitize AI input.
- Restrict dietary-preference values to known values.
- Keep user-owned database records isolated with RLS.
- Do not persist viewer-specific dietary flags in shared ingredient cache records.
- Use secure native session storage for mobile authentication sessions.
- Avoid storing secrets in source control.

## 9. UX / UI Requirements

The current design system emphasizes a premium light/natural visual language with:

- Plus Jakarta Sans.
- Phosphor icons.
- Consistent spacing, radius, typography, shadows, and colors.
- LinearGradient primary actions and safety cards.
- Inline feedback instead of platform alert dialogs.
- Clear loading and processing states.
- Review-before-analysis interaction for OCR results.
- A scanner experience that supports both automatic RTIDS capture and manual fallbacks.

## 10. Monetization

The next product phase is monetization.

Planned model:

- Free tier with a limited number of scans per month.
- Premium subscription through RevenueCat.
- Paywall and entitlement-aware feature gating.
- Server/data-layer support for scan usage.
- Device-abuse signals used as an additional protection layer.

The current schema already contains scan-count infrastructure, but the complete client-to-RPC wiring and subscription enforcement are still development work.

## 11. Release Phases

### Phase 1 — Core Product

Authentication, scanner, OCR, ingredient analysis, results, and basic data storage.

### Phase 2 — Product Experience

Personalization, scan history, settings, legal screens, design-system overhaul, caching, and reliability improvements.

### Phase 3 — Intelligent Scanning & Hardening

Google OAuth, OCR review, RTIDS, scanner lifecycle improvements, server-side Gemini processing, data-integrity fixes, and device-tracking instrumentation.

### Phase 4 — Monetization

RevenueCat, paywall, free scan limits, entitlement enforcement, scan-count wiring, and device-abuse response logic.

## 12. Known Development Priorities

1. Complete RevenueCat integration.
2. Implement paywall and subscription state.
3. Enforce the free scan allowance through the existing backend/RPC infrastructure.
4. Define safe behavior for flagged devices.
5. Finish RTIDS refinement and validate it across supported devices.
6. Add stronger automated test/CI infrastructure as the product approaches release.
7. Verify database RPC security and production database definitions before launch.

## 13. Documentation History

| Version | Date | Summary |
|---|---|---|
| 1.0 | June 2026 | Initial PRD. |
| 2.0 | June 2026 | Major product update covering the completed early phases, authentication hardening, and ingredient caching. |
| 2.1 | June 2026 | UI/design-system overhaul, typography/icons, dietary preference fixes, onboarding routing, and signup fixes. |
| 2.2 | July 2026 | Data-integrity and hygiene pass, including viewer-specific dietary flag isolation, confirmation-dialog migration, server-side Gemini processing, legal screens, and dependency cleanup. |
| 2.3 | July 2026 | Production-readiness pass covering onboarding removal, splash timing, permission cleanup, Edge Function input limits, and secret/configuration review. |
| 2.4 | July 2026 | Documentation catch-up for RTIDS and device tracking, corrected stale Google OAuth/OCR status, and documented the current scanner refinement direction. |

## 14. Status

**Active development.** Core scanning and AI-analysis functionality is implemented. The current product focus is monetization and abuse-prevention completion, followed by broader release hardening.
