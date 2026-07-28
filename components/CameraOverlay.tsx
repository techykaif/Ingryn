/**
 * CameraOverlay — Real-time detection feedback overlay.
 *
 * Displays:
 *   - Color-coded scan frame (RED / YELLOW / GREEN)
 *   - Guidance message
 *   - Confidence indicator
 *   - State-aware instructions
 */

import React, { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated'
import { Fonts, FontSizes } from '@/constants/theme'
import type { DetectionState } from '@/detection/CameraStateMachine'

// ── Overlay color mapping ─────────────────────────────────────────────────────

const OVERLAY_COLORS: Record<string, string> = {
  red: '#EF4444',
  yellow: '#F59E0B',
  green: '#22C55E',
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

function lerpColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from)
  const [r2, g2, b2] = hexToRgb(to)
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t])
}

function getOverlayColor(state: DetectionState, confidence: number): string {
  // Once we've locked onto a stable detection, hold solid green — we've
  // already committed to a capture, so the colour shouldn't waver.
  if (state === 'CONFIRMED' || state === 'CAPTURING') {
    return OVERLAY_COLORS.green
  }

  // Otherwise interpolate red -> yellow -> green continuously as confidence
  // climbs, so the frame visibly eases toward green rather than jumping
  // between three fixed bands.
  const t = Math.max(0, Math.min(1, confidence))
  return t <= 0.5
    ? lerpColor(OVERLAY_COLORS.red, OVERLAY_COLORS.yellow, t / 0.5)
    : lerpColor(OVERLAY_COLORS.yellow, OVERLAY_COLORS.green, (t - 0.5) / 0.5)
}

// ── Props ─────────────────────────────────────────────────────────────────────

type CameraOverlayProps = {
  state: DetectionState
  confidence: number
  guidanceMessage: string
  classification: string
  frameW: number
  frameH: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CameraOverlay({
  state,
  confidence,
  guidanceMessage,
  classification,
  frameW,
  frameH,
}: CameraOverlayProps) {
  const color = getOverlayColor(state, confidence)
  const isActive = state !== 'IDLE' && state !== 'PROCESSING'

  // ── Pulse animation for CONFIRMED state ──
  const pulseScale = useSharedValue(1)

  useEffect(() => {
    if (state === 'CONFIRMED' || state === 'CAPTURING') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    } else {
      pulseScale.value = withTiming(1, { duration: 200 })
    }
  }, [state, pulseScale])

  const frameAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }))

  // ── Confidence bar width animation ──
  const barWidth = useSharedValue(0)

  useEffect(() => {
    barWidth.value = withTiming(confidence * 100, {
      duration: 300,
      easing: Easing.out(Easing.ease),
    })
  }, [confidence, barWidth])

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%` as any,
    backgroundColor: color,
  }))

  if (!isActive) return null

  return (
    <View style={styles.overlayContainer} pointerEvents="none">
      {/* Scan frame with color-coded corners */}
      <Animated.View style={[styles.frame, { width: frameW, height: frameH }, frameAnimStyle]}>
        {/* Corner indicators */}
        <View style={[styles.corner, styles.tl, { borderColor: color }]} />
        <View style={[styles.corner, styles.tr, { borderColor: color }]} />
        <View style={[styles.corner, styles.bl, { borderColor: color }]} />
        <View style={[styles.corner, styles.br, { borderColor: color }]} />

        {/* Scan line */}
        <View style={[styles.scanLine, { backgroundColor: `${color}50` }]} />
      </Animated.View>

      {/* Confidence bar */}
      <View style={styles.confidenceContainer}>
        <View style={styles.confidenceTrack}>
          <Animated.View style={[styles.confidenceBar, barStyle]} />
        </View>
        <Text style={[styles.confidenceLabel, { color }]}>
          {Math.round(confidence * 100)}%
        </Text>
      </View>

      {/* Guidance message */}
      {guidanceMessage ? (
        <View style={[styles.guidanceBadge, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
          <View style={[styles.guidanceDot, { backgroundColor: color }]} />
          <Text style={[styles.guidanceText, { color: '#fff' }]}>
            {guidanceMessage}
          </Text>
        </View>
      ) : null}

      {/* State label for CONFIRMED */}
      {state === 'CONFIRMED' && (
        <View style={[styles.autoCaptureBadge, { backgroundColor: `${OVERLAY_COLORS.green}CC` }]}>
          <Text style={styles.autoCaptureText}>Auto capturing...</Text>
        </View>
      )}

      {state === 'CAPTURING' && (
        <View style={[styles.autoCaptureBadge, { backgroundColor: `${OVERLAY_COLORS.green}CC` }]}>
          <Text style={styles.autoCaptureText}>Capturing...</Text>
        </View>
      )}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
  },
  tl: {
    top: 0, left: 0,
    borderTopWidth: 3, borderLeftWidth: 3,
    borderTopLeftRadius: 6,
  },
  tr: {
    top: 0, right: 0,
    borderTopWidth: 3, borderRightWidth: 3,
    borderTopRightRadius: 6,
  },
  bl: {
    bottom: 0, left: 0,
    borderBottomWidth: 3, borderLeftWidth: 3,
    borderBottomLeftRadius: 6,
  },
  br: {
    bottom: 0, right: 0,
    borderBottomWidth: 3, borderRightWidth: 3,
    borderBottomRightRadius: 6,
  },

  scanLine: {
    width: '100%',
    maxWidth: 240,
    height: 1.5,
  },

  // Confidence bar
  confidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
    paddingHorizontal: 32,
    width: '100%',
    maxWidth: 280,
  },
  confidenceTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  confidenceBar: {
    height: '100%',
    borderRadius: 2,
  },
  confidenceLabel: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.xs,
    minWidth: 36,
    textAlign: 'right',
  },

  // Guidance badge
  guidanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    maxWidth: '85%',
  },
  guidanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  guidanceText: {
    fontFamily: Fonts.medium,
    fontSize: FontSizes.sm,
    lineHeight: 16,
    flexShrink: 1,
  },

  // Auto capture badge
  autoCaptureBadge: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  autoCaptureText: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.sm,
    color: '#fff',
    letterSpacing: 0.5,
  },
})