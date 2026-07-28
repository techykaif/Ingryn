/**
 * useRealtimeDetection — Orchestrator hook for real-time ingredient detection.
 *
 * Responsibilities:
 *   1. Schedule frame processing every ~400ms (2–3 OCR scans/sec)
 *   2. Run ML Kit OCR on captured frames
 *   3. Feed results to DetectionEngine
 *   4. Drive CameraStateMachine transitions
 *   5. Manage stable-detection timer → auto-capture
 *
 * Never processes multiple frames simultaneously.
 * Never calls AI during live preview.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import type { CameraView } from 'expo-camera'
import { DetectionEngine, type DetectionResult } from '@/detection/DetectionEngine'
import { filterTextToGuideBox } from '@/detection/textRegionFilter'
import {
  CameraStateMachine,
  type DetectionState,
  type DetectionClassification,
} from '@/detection/CameraStateMachine'

// ── Configuration ─────────────────────────────────────────────────────────────

/** Milliseconds between OCR frames once something resembling an ingredient
 *  list has actually been spotted (POSSIBLE_INGREDIENT or higher) — fast,
 *  so we lock onto a real detection quickly. */
const ACTIVE_FRAME_INTERVAL_MS = 400

/** Milliseconds between OCR frames while idle/searching with no signal —
 *  deliberately slower so the camera isn't firing at full rate while
 *  pointed at a wall, a hand, or nothing in particular. */
const IDLE_FRAME_INTERVAL_MS = 750

/** Quality setting for preview snapshots (lower = faster) */
const PREVIEW_QUALITY = 0.4

// ── Types ─────────────────────────────────────────────────────────────────────

export type RealtimeDetectionState = {
  /** Current state machine state */
  detectionState: DetectionState
  /** Detection confidence 0–1 */
  confidence: number
  /** What was classified */
  classification: DetectionClassification
  /** Guidance message for overlay */
  guidanceMessage: string
  /** Whether realtime detection is actively scanning */
  isScanning: boolean
}

export type UseRealtimeDetectionReturn = RealtimeDetectionState & {
  /** Start real-time scanning */
  startScanning: () => void
  /** Stop real-time scanning */
  stopScanning: () => void
  /** Reset the detection state machine */
  resetDetection: () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRealtimeDetection(
  cameraRef: React.RefObject<CameraView | null>,
  cameraReady: boolean,
  /**
   * Called when stable detection triggers auto-capture.
   * Receives the camera photo URI plus its pixel dimensions, so the
   * caller can confine the follow-up OCR pass to the guide box too.
   */
  onAutoCapture: (uri: string, width?: number, height?: number) => void
): UseRealtimeDetectionReturn {
  // ── State ──
  const [detectionState, setDetectionState] = useState<DetectionState>('IDLE')
  const [confidence, setConfidence] = useState(0)
  const [classification, setClassification] = useState<DetectionClassification>('UNKNOWN')
  const [guidanceMessage, setGuidanceMessage] = useState('')
  const [isScanning, setIsScanning] = useState(false)

  // ── Refs (no re-renders) ──
  const engineRef = useRef<DetectionEngine | null>(null)
  const stateMachineRef = useRef<CameraStateMachine | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isProcessingRef = useRef(false)
  const isScanningRef = useRef(false)
  const isMountedRef = useRef(true)

  // ── Initialize engine & state machine (once) ──
  useEffect(() => {
    engineRef.current = new DetectionEngine()
    stateMachineRef.current = new CameraStateMachine()
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  // ── Process a single frame ──
  const processFrame = useCallback(async () => {
    // Guard: don't process if already processing, not scanning, or no camera
    if (
      isProcessingRef.current ||
      !isScanningRef.current ||
      !cameraRef.current ||
      !cameraReady ||
      Platform.OS === 'web'
    ) {
      return
    }

    const sm = stateMachineRef.current
    const engine = engineRef.current
    if (!sm || !engine) return

    // Don't process during capture/processing states
    if (sm.state === 'CAPTURING' || sm.state === 'PROCESSING') return

    isProcessingRef.current = true
    // Tracked outside the try body so the `finally` block below can always
    // clean it up, regardless of which return path this frame takes.
    let previewUri: string | null = null

    try {
      // ── Step 1: Capture a low-quality preview snapshot ──
      const photo = await cameraRef.current.takePictureAsync({
        quality: PREVIEW_QUALITY,
        base64: false,
        skipProcessing: true,
        shutterSound: false,
      })
      previewUri = photo?.uri ?? null

      if (!photo?.uri || !isMountedRef.current || !isScanningRef.current) return

      // ── Step 2: Run ML Kit OCR ──
      const TextRecognition = (
        await import('@react-native-ml-kit/text-recognition')
      ).default
      const ocrResult = await TextRecognition.recognize(photo.uri)
      const ocrText = filterTextToGuideBox(
        ocrResult.blocks,
        ocrResult.text?.trim() || '',
        photo.width,
        photo.height
      ).trim()

      if (!isMountedRef.current || !isScanningRef.current) return

      // ── Step 3: Run Detection Engine ──
      const detection: DetectionResult = engine.detect(ocrText)

      // ── Step 4: Feed into State Machine ──
      sm.transition({
        type: 'DETECTION_RESULT',
        classification: detection.classification,
        confidence: detection.confidence,
      })

      const ctx = sm.context

      // ── Step 5: Update React state ──
      if (isMountedRef.current) {
        setDetectionState(sm.state)
        setConfidence(detection.confidence)
        setClassification(detection.classification)
        setGuidanceMessage(
          detection.qualityIssues.length > 0
            ? detection.qualityIssues[0]
            : ctx.guidanceMessage
        )
      }

      // ── Step 6: Auto-capture if CONFIRMED ──
      if (sm.state === 'CONFIRMED' && isScanningRef.current) {
        sm.transition({ type: 'CAPTURE_START' })
        setDetectionState('CAPTURING')

        try {
          // Take a high-quality photo for the actual OCR pipeline
          const capturePhoto = await cameraRef.current!.takePictureAsync({
            quality: 0.85,
            base64: false,
            shutterSound: false,
          })

          if (capturePhoto?.uri && isMountedRef.current) {
            sm.transition({ type: 'CAPTURE_COMPLETE' })
            setDetectionState('PROCESSING')

            // Stop scanning during processing
            stopScanningInternal()
            onAutoCapture(capturePhoto.uri, capturePhoto.width, capturePhoto.height)
          }
        } catch (captureError) {
          console.warn('[RTIDS] Auto-capture failed:', captureError)
          // Reset to allow retry
          sm.transition({ type: 'RESET' })
          if (isMountedRef.current) {
            setDetectionState('SEARCHING')
            setGuidanceMessage('Capture failed. Please try again.')
          }
        }
      }
    } catch (error) {
      // Silently skip frame on error — next frame will retry
      console.warn('[RTIDS] Frame processing error:', error)
    } finally {
      isProcessingRef.current = false
      // Preview snapshots are throwaway — OCR has already read them by now.
      // Delete unconditionally so the cache directory never accumulates
      // ~2-3 leftover images per second of scanning.
      if (previewUri) {
        FileSystem.deleteAsync(previewUri, { idempotent: true }).catch(() => {})
      }
    }
  }, [cameraRef, cameraReady, onAutoCapture])

  // ── Schedule the next frame, adapting cadence to current detection state ──
  const scheduleNextFrame = useCallback(() => {
    if (!isScanningRef.current) return

    const sm = stateMachineRef.current
    const delay =
      sm && (sm.state === 'IDLE' || sm.state === 'SEARCHING')
        ? IDLE_FRAME_INTERVAL_MS
        : ACTIVE_FRAME_INTERVAL_MS

    timeoutRef.current = setTimeout(async () => {
      await processFrame()
      scheduleNextFrame()
    }, delay)
  }, [processFrame])

  // ── Start scanning ──
  const startScanning = useCallback(() => {
    if (isScanningRef.current || Platform.OS === 'web') return

    isScanningRef.current = true
    setIsScanning(true)

    stateMachineRef.current?.transition({ type: 'START_SCANNING' })
    setDetectionState('SEARCHING')
    setGuidanceMessage('Point at ingredient list')

    // Start the adaptive frame processing loop
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    scheduleNextFrame()
  }, [scheduleNextFrame])

  // ── Stop scanning (internal — no state reset) ──
  const stopScanningInternal = useCallback(() => {
    isScanningRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // ── Stop scanning (public) ──
  const stopScanning = useCallback(() => {
    stopScanningInternal()
    setIsScanning(false)
    isProcessingRef.current = false
  }, [stopScanningInternal])

  // ── Reset detection ──
  const resetDetection = useCallback(() => {
    stopScanning()
    stateMachineRef.current?.reset()
    setDetectionState('IDLE')
    setConfidence(0)
    setClassification('UNKNOWN')
    setGuidanceMessage('')
  }, [stopScanning])

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      stopScanningInternal()
    }
  }, [stopScanningInternal])

  return {
    detectionState,
    confidence,
    classification,
    guidanceMessage,
    isScanning,
    startScanning,
    stopScanning,
    resetDetection,
  }
}