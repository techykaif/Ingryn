# INGRYN

> AI-powered ingredient intelligence for the products you buy.

INGRYN is a React Native / Expo mobile application that turns an ingredient label into a structured, easy-to-understand analysis. Users can scan a label with the camera, choose a label photo from the gallery, or enter ingredients manually. Camera and photo OCR go directly into the durable server analysis pipeline, while manual entry sends the entered text directly to the same analysis path.

**Status:** Active development  
**Platform:** iOS + Android  
**Runtime:** Expo SDK 56 / React Native 0.85  
**Backend:** Supabase  
**AI:** Gemini via Supabase Edge Functions

---

## ✨ What INGRYN Does

### 📷 Smart ingredient scanning

- Live camera scanning
- Gallery/image fallback
- ML Kit OCR
- Direct OCR → analysis flow with no manual review screen
- Manual ingredient entry
- Automatic real-time ingredient-list detection through **RTIDS**
- Tap-to-capture remains available as a camera fallback

### 🧠 AI ingredient analysis

INGRYN analyzes detected ingredients and provides structured information such as:

- Ingredient definitions
- Safety information
- Categories
- Country-specific restrictions
- Personalized relevance
- Dietary-preference flags

AI requests run through the Supabase `analyze-ingredients` Edge Function, keeping the Gemini API key out of the mobile client.

### 🎯 Personalized results

Users can configure dietary preferences such as allergies, conditions, and diet type. Personal relevance is calculated for the current viewer rather than being persisted into the shared ingredient cache, preventing cross-user preference leakage.

### 📚 Scan history

Users can:

- Save scan results
- Browse previous scans
- Search history
- Open scan details
- Delete scans

### 🔐 Authentication

- Email/password authentication
- Native Google Sign-In
- Supabase session persistence
- Password reset
- Authenticated route protection
- Disposable-email blocking
- Login attempt backoff
- Profile/name editing
- Password changes
- Account deletion

### 🛡️ Device tracking & abuse signals

INGRYN includes a server-side device-tracking layer that records a hashed device signature and links devices to authenticated accounts. Devices associated with more than three accounts can be flagged.

This system is currently **tracking-only**. No user is blocked based on these signals yet; enforcement is part of the upcoming monetization/abuse-prevention phase.

---

## ⚡ Real-Time Ingredient Detection (RTIDS)

RTIDS is INGRYN's custom live scanning layer. Instead of requiring the user to press capture at exactly the right moment, the scanner evaluates the camera stream and looks for likely ingredient-list content.

```text
Live Camera
     ↓
Frame Detection
     ↓
DetectionEngine
     ↓
Stable Detection
     ↓
Auto Capture
     ↓
OCR
     ↓
Durable AI Analysis
```

RTIDS is built around application-level detection logic including a custom `DetectionEngine`, camera state management, confidence scoring, and fuzzy matching. It feeds into the same OCR/review pipeline used by manual capture, so the automatic path does not create a separate analysis architecture.

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────┐
│                 INGRYN App                  │
│                                             │
│ Expo Router • React Native • Zustand        │
│ Camera • OCR • RTIDS • Preferences          │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│                  Supabase                   │
│                                             │
│ Auth • PostgreSQL • RLS • Edge Functions    │
└───────────────┬──────────────────┬──────────┘
                │                  │
                ▼                  ▼
       Ingredient Cache      AI Analysis
                              Edge Function
                                   │
                                   ▼
                                 Gemini
```

### Analysis flow

```text
Camera / Gallery / Manual Text
            ↓
           OCR
            ↓
   Ingredient Recognition
            ↓
 ┌──────────┴──────────┐
 │                     │
 ▼                     ▼
Supabase Cache     Gemini Edge Function
 │                     │
 └──────────┬──────────┘
            ↓
   Structured Results
            ↓
 Personal Dietary Flags
            ↓
       Scan History
```

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native |
| Framework | Expo SDK 56 |
| Routing | Expo Router |
| Language | TypeScript / JavaScript |
| UI | React Native + custom design system |
| State | Zustand |
| Server data | TanStack Query where applicable |
| OCR | Google ML Kit Text Recognition |
| Camera | Expo Camera |
| Authentication | Supabase Auth + Google Sign-In |
| Database | PostgreSQL via Supabase |
| Security | Supabase Row Level Security |
| Server logic | Supabase Edge Functions |
| AI | Gemini |
| Animations | Reanimated |
| Icons | Phosphor Icons |
| Typography | Plus Jakarta Sans |
| Builds | EAS Build |

---

## 📁 Project Structure

```text
Ingryn/
├── app/                 # Expo Router screens and navigation
│   ├── (auth)/          # Welcome, sign-in, sign-up
│   ├── (tabs)/          # Home, scanner, history, settings
│   ├── ingredient/      # Ingredient details
│   ├── results/         # Scan results
│   └── legal/           # Privacy / Terms
│
├── components/          # Reusable UI components
├── constants/           # Design system and app constants
├── detection/           # RTIDS detection + camera state logic
├── hooks/               # Scanner, AI, preferences and data hooks
├── lib/                 # Supabase, auth and shared services
├── store/               # Zustand state
├── supabase/
│   ├── functions/       # Server-side Edge Functions
│   └── seed.sql         # Seed data
│
├── docs/
│   └── PRD/             # Versioned product requirements
│
├── assets/              # App assets
├── audit.md             # Engineering audit history
├── app.json             # Expo configuration
├── eas.json             # EAS build configuration
└── package.json         # Dependencies and scripts
```

---

## 🔒 Security & Data Design

Security is part of the architecture rather than an afterthought.

- Gemini credentials remain server-side.
- Protected Edge Functions validate authenticated users.
- AI input is validated and sanitized.
- Dietary preference values are constrained to known values.
- User-owned database records use RLS.
- Scan queries are scoped to the authenticated user.
- Viewer-specific dietary flags are not stored in the shared ingredient cache.
- Native Supabase sessions use secure mobile storage.
- Device tracking uses a hashed device signature rather than storing a raw device identifier in the application flow.

The `devices` and `device_flags` tables are intentionally operated by the server-side device-tracking function using privileged access after authentication and user validation.

---

## 🎨 Design System

INGRYN currently uses a premium light/natural visual direction built around:

- Plus Jakarta Sans
- Phosphor icons
- Centralized colors, typography, spacing, radius, and shadows
- LinearGradient primary actions and safety cards
- Reusable confirmation dialogs
- Inline error and status feedback
- Consistent loading/processing states

The application does not rely on native `Alert.alert` for its product interaction model.

---

## 🚧 Current Development

The core product experience is implemented. Current development is focused on turning the product into a monetized release.

### Next priorities

- [ ] RevenueCat integration
- [ ] Subscription state and entitlement handling
- [ ] Paywall
- [ ] Free-tier scan limit enforcement
- [ ] Wire the existing scan-count RPC into the scan flow
- [ ] Define enforcement behavior for flagged devices
- [ ] Finish RTIDS refinement and device validation
- [ ] Expand automated testing and CI before release
- [ ] Final verification of production database RPC/security definitions

### Product direction

The current roadmap is:

```text
Core Scanner
     ↓
AI Analysis
     ↓
Personalization
     ↓
Instant / Real-Time Scanning
     ↓
Abuse Protection Instrumentation
     ↓
Monetization
     ↓
Release Hardening
```

---

## 📖 Documentation

The detailed product specification is intentionally kept out of the root README.

- **Product Requirements:** [`docs/PRD/`](docs/PRD/)
- **Current PRD:** [`docs/PRD/PRD-v2.4.md`](docs/PRD/PRD-v2.4.md)
- **Engineering Audit:** [`audit.md`](audit.md)

PRDs are versioned so historical product decisions remain traceable instead of being overwritten by future requirements.

---

## 🚀 Development Setup

### Prerequisites

- Node.js
- npm
- Expo tooling / EAS CLI as required by the local workflow
- Supabase project credentials
- Native development environment for iOS and/or Android when running native builds

### Install

```bash
npm install
```

### Start Expo

```bash
npm start
```

### Run on iOS

```bash
npm run ios
```

### Run on Android

```bash
npm run android
```

Environment configuration should be supplied through the project's local/EAS environment configuration. Secrets must never be committed to the repository.

---

## 🏗️ Build & Release

INGRYN uses Expo Application Services (EAS) for native build configuration.

- Development builds use the configured development profile.
- Preview builds use the configured preview profile.
- Production builds use the production profile with automatic version-code/build-number progression.

See [`eas.json`](eas.json) and [`app.json`](app.json) for the repository's current build configuration.

---

## 📌 Project Status

**Active development — core product complete, monetization next.**

INGRYN has evolved from a basic OCR scanner into a full mobile ingredient-intelligence product with authentication, AI analysis, personalization, caching, scan history, real-time detection, server-side AI security, and anti-abuse instrumentation.

The remaining work is primarily around monetization, usage enforcement, abuse response, device validation, and release hardening rather than rebuilding the core product architecture.

---

## License

No public open-source license has been declared for this project yet.
