# Real-Time Ingredient Detection System (RTIDS)

## Overview

This document describes the implementation of a production-grade real-time ingredient detection system for IngRyn.

The goal is to eliminate user confusion during scanning by detecting ingredient lists **before** capturing an image, while avoiding additional AI API calls.

This feature should make the scanning experience similar to Google Lens or Microsoft Lens, where the application guides the user in real time.

---

# Goals

The system should:

- Detect ingredient lists in real-time
- Detect nutrition tables
- Detect barcodes
- Prevent incorrect captures
- Automatically capture when an ingredient list is confidently detected
- Never call AI during live preview
- Work smoothly on mid-range Android devices
- Consume minimal battery
- Integrate into the existing OCR pipeline

---

# Existing Pipeline

Current architecture:

Camera

↓

Capture Image

↓

OCR

↓

Supabase Cache

↓

AI Analysis

↓

Result Screen

---

# New Pipeline

Camera Preview

↓

Real-Time Detection Engine

↓

Auto Capture

↓

Existing OCR Pipeline

↓

Supabase Cache

↓

AI Analysis

↓

Result Screen

Nothing after image capture should change.

The new feature only improves the camera experience.

---

# Architecture

Camera Preview
        │
        ▼
Frame Scheduler
        │
        ▼
ML Kit OCR
        │
        ▼
Detection Engine
        │
        ├───────────────┐
        │               │
        ▼               ▼
Confidence         Image Quality
        │               │
        └───────┬───────┘
                ▼
Overlay Manager
                │
                ▼
State Machine
                │
                ▼
Auto Capture
                │
                ▼
Existing Pipeline

---

# Camera Processing

Camera runs at approximately 30 FPS.

DO NOT process every frame.

Instead:

Process only every 300–500ms.

Target OCR frequency:

2–3 scans per second.

Never process multiple frames simultaneously.

If OCR is already running, skip incoming frames.

---

# OCR

Continue using Google ML Kit Text Recognition.

OCR should execute only on scheduled frames.

The OCR output is immediately passed to the Detection Engine.

No AI requests should happen here.

---

# Detection Engine

This is the core component.

It receives OCR text and determines what the user is scanning.

Possible classifications:

- INGREDIENTS
- NUTRITION
- BARCODE
- UNKNOWN

The Detection Engine must be completely local.

No network requests.

---

# Detection Strategy

The engine combines multiple techniques.

## 1. Ingredient Keyword Detection

Maintain a keyword dictionary.

Examples:

- ingredients
- contains
- composition
- made with

Each detected keyword increases the Ingredient Score.

---

## 2. Ingredient Vocabulary

Maintain a database of common ingredients.

Examples:

Sugar

Salt

Palm Oil

Milk Solids

Citric Acid

Starch

Emulsifier

Preservative

Stabilizer

INS322

INS330

E322

E621

Every successful match increases Ingredient Score.

---

## 3. Nutrition Detection

Maintain a nutrition keyword list.

Examples:

Calories

Energy

Protein

Fat

Carbohydrate

Serving Size

Vitamin

Sodium

Daily Value

Each match increases Nutrition Score.

---

## 4. Barcode Detection

Detect:

Long numeric sequences

UPC

EAN

Barcode patterns

Barcode score should immediately classify the image as BARCODE.

---

# Fuzzy Matching

Never perform exact ingredient matching.

OCR frequently produces mistakes.

Examples:

Sugar

↓

Suga

Palm Oil

↓

Palm OiI

Emulsifier

↓

Emulsfier

Implement fuzzy matching.

Recommended libraries:

- Fuse.js
- fast-fuzzy
- Levenshtein distance

Similarity threshold:

Approximately 85%.

---

# Confidence Calculation

Calculate a final confidence score.

Suggested weights:

Ingredient Keywords

30%

Ingredient Matches

40%

OCR Quality

20%

Text Density

10%

Total:

100%

---

# Classification Rules

Confidence >= 85%

↓

INGREDIENTS

Confidence between 50 and 85

↓

UNKNOWN

Confidence below 50

↓

Use Nutrition Score

↓

Use Barcode Score

↓

Show Guidance

---

# Image Quality Checks

Before accepting OCR results:

Evaluate:

- Blur
- Brightness
- Motion
- Text size
- Focus

If image quality is poor:

Reject detection.

Display guidance instead.

Examples:

Move closer.

Improve lighting.

Hold camera steady.

---

# Camera Overlay

Overlay states:

RED

No ingredient list detected.

YELLOW

Possible ingredient list.

Hold steady.

GREEN

Ingredient list detected.

Auto capture in progress.

The overlay should update continuously.

---

# State Machine

Implement a state machine.

States:

IDLE

↓

SEARCHING

↓

POSSIBLE_INGREDIENT

↓

CONFIRMED

↓

CAPTURING

↓

PROCESSING

Transitions must prevent accidental captures.

---

# Stable Detection

Never capture immediately.

Ingredient confidence must remain above threshold continuously.

Recommended:

Confidence >85%

for

1000 milliseconds

Then capture automatically.

If confidence drops:

Reset timer.

---

# Auto Capture

When stable detection succeeds:

Freeze preview.

Capture image.

Continue into the existing OCR pipeline.

The user should not need to press a capture button.

---

# Existing OCR Pipeline

After capture:

Use the existing implementation.

OCR

↓

Supabase Cache

↓

AI Ingredient Analysis

↓

Feature Flag Analysis

↓

Result Screen

No modifications required.

---

# Performance Requirements

Target:

Live preview:

60 FPS

OCR:

2–3 FPS

Detection latency:

Below 100ms

Capture latency:

Below 1 second

CPU usage:

Minimal

Battery usage:

Minimal

Memory leaks:

Zero

---

# Error Handling

Nutrition table detected

↓

Show:

"This looks like the Nutrition Facts table.

Please scan the Ingredients section."

Barcode detected

↓

Show:

"Barcode detected.

Please scan the Ingredients list."

No readable text

↓

Show:

"No readable text detected."

Poor lighting

↓

Show:

"Increase lighting."

Blur

↓

Show:

"Hold camera steady."

---

# Folder Structure

src/

camera/

- CameraScreen.tsx
- CameraOverlay.tsx
- CameraStateMachine.ts

detection/

- OCRProcessor.ts
- DetectionEngine.ts
- IngredientDetector.ts
- NutritionDetector.ts
- BarcodeDetector.ts
- FuzzyMatcher.ts
- ConfidenceCalculator.ts

hooks/

- useRealtimeDetection.ts

constants/

- ingredientKeywords.ts
- nutritionKeywords.ts
- ingredientDatabase.ts

services/

- MLKitService.ts

utils/

- imageQuality.ts

---

# Edge Cases

Handle all of the following.

Small ingredient lists

Very large ingredient lists

Curved packaging

Rotated packaging

Low light

Flash reflection

Motion blur

Multiple products in one frame

Mixed ingredient + nutrition table

OCR mistakes

Unknown ingredients

Languages

Very small fonts

Large fonts

Partial ingredient list

User moving camera rapidly

Camera permission denied

Offline mode

App minimized

Camera interruption

Memory pressure

Slow devices

---

# Future Improvements

Do NOT implement these now.

Region detection

YOLO

TensorFlow Lite object detector

Barcode product lookup

Ingredient alias learning

Offline ingredient database

Automatic ingredient cropping

These belong in Version 2.

---

# Acceptance Criteria

The implementation is complete when:

✅ User receives live feedback while scanning.

✅ No AI request is made during preview.

✅ Ingredient detection works in real time.

✅ Nutrition tables are rejected.

✅ Barcodes are rejected.

✅ Auto capture works reliably.

✅ Existing OCR pipeline remains unchanged.

✅ No frame backlog occurs.

✅ No noticeable UI lag.

✅ Works on mid-range Android devices.

---

# Development Notes

The implementation should prioritize:

Performance

Battery efficiency

Reliability

Maintainability

Readable architecture

Reusable components

Avoid overengineering.

Prefer small, isolated modules over one large implementation.

The implementation should be production-ready and extensible for future computer vision improvements.
