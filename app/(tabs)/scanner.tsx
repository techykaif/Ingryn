import { useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator,
  Platform, useWindowDimensions, InteractionManager
} from 'react-native'
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing, withDelay } from 'react-native-reanimated'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuthStore } from '@/store'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useScanner, IS_WEB } from '@/hooks/useScanner'
import { useRealtimeDetection } from '@/hooks/useRealtimeDetection'
import { Colors, Fonts, FontSizes, Spacing, Radius, Shadows } from '@/constants/theme'
import type { DetectionState } from '@/detection/CameraStateMachine'
import type { DetectionClassification } from '@/detection/DetectionEngine'
import {
  Image as ImageIcon, Lightning, LightningSlash,
  Scan, ArrowLeft, Camera, Warning, X
} from 'phosphor-react-native'

export default function ScannerScreen() {
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const guideViewport = useMemo(() => ({ width, height }), [width, height])
  const { user } = useAuthStore()
  const [permission, requestPermission] = useCameraPermissions()

  const {
    step, setStep,
    flash, setFlash,
    cameraActive,
    cameraReady, setCameraReady,
    processingTip,
    scanError, clearError,
    cameraRef,
    processingTips,
    activateCamera,
    deactivateCamera,
    handleCapture,
    handleGalleryPick,
    cancelProcessing,
    recognizeFromUri,
  } = useScanner(
    user?.id || '',
    (scanId) => router.push(`/results/${scanId}`),
    guideViewport
  )

  // ── Real-time detection ──
  const handleAutoCapture = useCallback((uri: string, width?: number, height?: number) => {
    // Auto-detected ingredient labels go straight from camera -> OCR -> durable
    // server analysis. There is no manual editing/review step.
    recognizeFromUri(uri, { photoWidth: width, photoHeight: height })
  }, [recognizeFromUri])

  const {
    detectionState,
    confidence,
    classification,
    guidanceMessage,
    isScanning,
    startScanning,
    stopScanning,
    resetDetection,
  } = useRealtimeDetection(
    cameraRef,
    cameraReady,
    handleAutoCapture,
    guideViewport
  )

  // Start realtime scanning when camera becomes ready (native only)
  useEffect(() => {
    if (cameraReady && cameraActive && step === 'camera' && !IS_WEB) {
      startScanning()
    }
    return () => { stopScanning() }
  }, [cameraReady, cameraActive, step, startScanning, stopScanning])

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        activateCamera()
      })
      return () => {
        task.cancel()
        deactivateCamera()
        resetDetection()
      }
    }, [activateCamera, deactivateCamera, resetDetection])
  )

  if (step === 'processing') {
    return <ProcessingScreen tip={processingTips[processingTip]} tipIndex={processingTip} total={processingTips.length} onCancel={cancelProcessing} />
  }



  if (!permission?.granted) {
    return (
      <PermissionScreen onGrant={requestPermission} onGallery={handleGalleryPick} />
    )
  }

  return (
    <CameraScreen
      cameraRef={cameraRef}
      cameraActive={cameraActive}
      cameraReady={cameraReady}
      onCameraReady={() => setCameraReady(true)}
      flash={flash}
      onFlashToggle={() => setFlash(!flash)}
      onCapture={handleCapture}
      onGallery={handleGalleryPick}
      error={scanError?.message}
      clearError={clearError}
      detectionState={detectionState}
      confidence={confidence}
      classification={classification}
      guidanceMessage={guidanceMessage}
      isScanning={isScanning}
    />
  )
}

// ─── Processing ───────────────────────────────────────────────────────────────
function ProcessingScreen({ tip, tipIndex, total, onCancel }: { tip: string; tipIndex: number; total: number; onCancel: () => void }) {
  const pulse1 = useSharedValue(1)
  const pulse2 = useSharedValue(1)
  const pulse3 = useSharedValue(1)

  useEffect(() => {
    pulse1.value = withRepeat(withSequence(withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }), withTiming(1, { duration: 0 })), -1, false)
    pulse2.value = withDelay(400, withRepeat(withSequence(withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }), withTiming(1, { duration: 0 })), -1, false))
    pulse3.value = withDelay(800, withRepeat(withSequence(withTiming(1.6, { duration: 1200, easing: Easing.out(Easing.ease) }), withTiming(1, { duration: 0 })), -1, false))
  }, [])

  const style1 = useAnimatedStyle(() => ({ transform: [{ scale: pulse1.value }], opacity: 1 - (pulse1.value - 1) / 0.6 }))
  const style2 = useAnimatedStyle(() => ({ transform: [{ scale: pulse2.value }], opacity: 1 - (pulse2.value - 1) / 0.6 }))
  const style3 = useAnimatedStyle(() => ({ transform: [{ scale: pulse3.value }], opacity: 1 - (pulse3.value - 1) / 0.6 }))

  return (
    <View style={styles.processingContainer}>
      <StatusBar style="dark" />
      <View style={styles.processingRingsContainer}>
        <Animated.View style={[styles.pulseRing, style3]} />
        <Animated.View style={[styles.pulseRing, style2]} />
        <Animated.View style={[styles.pulseRing, style1]} />
        <View style={styles.processingRingInner}>
          <Scan size={32} color={Colors.primary} weight="bold" />
        </View>
      </View>
      <Text style={styles.processingTitle}>Analysing</Text>
      <Text style={styles.processingSubtitle}>AI is reading your ingredients</Text>
      <Text style={styles.processingTip}>{tip}</Text>
      <View style={styles.processingDots}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === tipIndex ? Colors.primary : Colors.border, width: i === tipIndex ? 20 : 6 }]} />
        ))}
      </View>
      <TouchableOpacity style={styles.cancelProcessingBtn} onPress={onCancel}>
        <Text style={styles.cancelProcessingText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Permission ───────────────────────────────────────────────────────────────
function PermissionScreen({ onGrant, onGallery }: { onGrant: () => void; onGallery: () => void }) {
  return (
    <View style={styles.permissionContainer}>
      <StatusBar style="dark" />
      <View style={styles.permissionBlob} />
      <View style={[styles.permissionIconBox, Shadows.md]}>
        <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.permissionIconGradient}>
          <Camera size={40} color="#fff" weight="fill" />
        </LinearGradient>
      </View>
      <Text style={styles.permissionTitle}>Camera access needed</Text>
      <Text style={styles.permissionSubtitle}>
        INGRYN needs camera access to{'\n'}scan ingredient labels.
      </Text>
      <TouchableOpacity style={[styles.permissionBtn, Shadows.primary]} onPress={onGrant} activeOpacity={0.9}>
        <LinearGradient colors={[Colors.primary, Colors.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.permissionBtnGradient}>
          <Text style={styles.permissionBtnText}>Grant camera access</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity style={styles.permissionSecondary} onPress={onGallery}>
        <ImageIcon size={18} color={Colors.primary} weight="bold" />
        <Text style={styles.permissionSecondaryText}>Choose a label photo</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Camera (stays dark) ──────────────────────────────────────────────────────
function CameraScreen({
  cameraRef, cameraActive, cameraReady, onCameraReady,
  flash, onFlashToggle, onCapture, onGallery,
  error, clearError,
  detectionState, confidence, guidanceMessage, isScanning,
}: {
  cameraRef: React.RefObject<CameraView | null>
  cameraActive: boolean
  cameraReady: boolean
  onCameraReady: () => void
  flash: boolean
  onFlashToggle: () => void
  onCapture: () => void
  onGallery: () => void
  error?: string
  clearError: () => void
  detectionState: DetectionState
  confidence: number
  guidanceMessage: string
  isScanning: boolean
}) {
  const insets = useSafeAreaInsets()

  const getCenterHint = () => {
    if (!cameraReady) return 'Opening camera…'
    if (detectionState === 'CONFIRMED' || detectionState === 'CAPTURING') {
      return 'Ingredient list found'
    }
    if (isScanning && guidanceMessage) return guidanceMessage
    return 'Center the ingredients in view'
  }

  const autoDetected = detectionState === 'CONFIRMED' || detectionState === 'CAPTURING'

  return (
    <View style={styles.cameraContainer}>
      <StatusBar style="light" hidden />

      {cameraActive && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          flash="off"
          enableTorch={flash}
          onCameraReady={onCameraReady}
        />
      )}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.68)', 'rgba(0,0,0,0.08)', 'transparent']}
        locations={[0, 0.35, 1]}
        style={styles.cameraTopGradient}
      />

      <View style={[styles.cameraTopBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.cameraIconBtn} onPress={() => {}}>
          <ArrowLeft size={22} color="#fff" weight="bold" />
        </TouchableOpacity>

        <View style={styles.livePill}>
          <View style={[styles.liveDot, autoDetected && styles.liveDotActive]} />
          <Text style={styles.livePillText}>{autoDetected ? 'Detected' : 'Live scan'}</Text>
        </View>

        <TouchableOpacity
          style={[styles.cameraIconBtn, flash && styles.cameraIconBtnActive]}
          onPress={onFlashToggle}
          activeOpacity={0.8}
        >
          {flash
            ? <LightningSlash size={19} color="#111" weight="fill" />
            : <Lightning size={19} color="#fff" weight="bold" />
          }
        </TouchableOpacity>
      </View>

      <View style={styles.cameraCenterContent} pointerEvents="none">
        <View style={[styles.focusPulse, autoDetected && styles.focusPulseDetected]}>
          <View style={[styles.focusCore, autoDetected && styles.focusCoreDetected]} />
        </View>

        <View style={styles.cameraHintPill}>
          <View style={[styles.cameraHintDot, autoDetected && styles.cameraHintDotDetected]} />
          <Text style={styles.cameraHintText}>{getCenterHint()}</Text>
        </View>

        {!autoDetected && (
          <Text style={styles.cameraSubHint}>
            Hold steady — capture starts automatically
          </Text>
        )}

        {autoDetected && (
          <Text style={styles.cameraSubHint}>
            Reading the label…
          </Text>
        )}
      </View>

      {error ? (
        <View style={styles.cameraErrorBanner}>
          <Warning size={14} color="#fff" weight="fill" />
          <Text style={styles.cameraErrorText} numberOfLines={2}>{error}</Text>
          <TouchableOpacity
            onPress={clearError}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.cameraErrorClose}
          >
            <X size={15} color="#fff" weight="bold" />
          </TouchableOpacity>
        </View>
      ) : null}

      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(0,0,0,0.24)', 'rgba(0,0,0,0.86)']}
        locations={[0, 0.3, 1]}
        style={styles.cameraBottomGradient}
      />

      <View style={[styles.cameraBottomControls, { paddingBottom: Math.max(insets.bottom, 18) + 14 }]}>
        <TouchableOpacity style={styles.galleryControl} onPress={onGallery} activeOpacity={0.85}>
          <View style={styles.galleryThumb}>
            <ImageIcon size={22} color="#fff" weight="regular" />
          </View>
          <Text style={styles.galleryLabel}>Photos</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.captureBtn, !cameraReady && { opacity: 0.35 }]}
          onPress={onCapture}
          disabled={!cameraReady || autoDetected}
          activeOpacity={0.9}
        >
          <View style={styles.captureOuter}>
            <View style={styles.captureInner} />
          </View>
        </TouchableOpacity>

        <View style={styles.autoControl}>
          <View style={[styles.autoBadge, autoDetected && styles.autoBadgeActive]}>
            <View style={[styles.autoBadgeDot, autoDetected && styles.autoBadgeDotActive]} />
            <Text style={styles.autoBadgeText}>{autoDetected ? 'Reading' : 'Auto'}</Text>
          </View>
          <Text style={styles.galleryLabel}>Instant</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  processingContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'const styles = StyleSheet.create({
  processingContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: Spacing.lg, paddingHorizontal: Spacing['3xl'] },
  processingRingsContainer: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  pulseRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary },
  processingRingInner: { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', ...Shadows.sm },
  processingTitle: { fontFamily: Fonts.extrabold, fontSize: FontSizes['4xl'], color: Colors.textPrimary },
  processingSubtitle: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textSecondary, marginTop: -Spacing.sm },
  processingTip: { fontFamily: Fonts.medium, fontSize: FontSizes.base, color: Colors.textSecondary, textAlign: 'center', lineHeight: 24, marginTop: Spacing.md },
  processingDots: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md, marginBottom: Spacing['2xl'] },
  dot: { height: 6, borderRadius: 3 },
  cancelProcessingBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.xl },
  cancelProcessingText: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.danger },

  permissionContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing['3xl'], gap: Spacing.lg },
  permissionBlob: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: `${Colors.primary}10`, top: -100, right: -80 },
  permissionIconBox: { borderRadius: 32, overflow: 'hidden', marginBottom: Spacing.md },
  permissionIconGradient: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  permissionTitle: { fontFamily: Fonts.extrabold, fontSize: FontSizes['3xl'], color: Colors.textPrimary, textAlign: 'center' },
  permissionSubtitle: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  permissionBtn: { width: '100%', borderRadius: Radius.xl, overflow: 'hidden', marginTop: Spacing.md },
  permissionBtnGradient: { paddingVertical: Spacing.xl, alignItems: 'center' },
  permissionBtnText: { fontFamily: Fonts.bold, fontSize: FontSizes.lg, color: '#fff' },
  permissionSecondary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Spacing.md },
  permissionSecondaryText: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.primary },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraTopGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 210 },
  cameraTopBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cameraIconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cameraIconBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.68)' },
  liveDotActive: { backgroundColor: Colors.primary },
  livePillText: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs, color: '#fff', letterSpacing: 0.2 },

  cameraCenterContent: { position: 'absolute', left: 24, right: 24, top: '37%', alignItems: 'center' },
  focusPulse: { width: 92, height: 92, borderRadius: 46, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.38)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  focusPulseDetected: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}18` },
  focusCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  focusCoreDetected: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.primary },
  cameraHintPill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, paddingHorizontal: 15, paddingVertical: 9, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', maxWidth: '92%' },
  cameraHintDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.7)' },
  cameraHintDotDetected: { backgroundColor: Colors.primary },
  cameraHintText: { fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: '#fff', textAlign: 'center', flexShrink: 1 },
  cameraSubHint: { marginTop: 10, fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: 'rgba(255,255,255,0.62)', textAlign: 'center' },

  cameraErrorBanner: { position: 'absolute', left: 16, right: 16, bottom: 154, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: Radius.xl, padding: Spacing.lg },
  cameraErrorText: { flex: 1, fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: '#fff', lineHeight: 18 },
  cameraErrorClose: { paddingLeft: 6 },

  cameraBottomGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 250 },
  cameraBottomControls: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 24, paddingHorizontal: 40 },

  galleryControl: { width: 72, alignItems: 'center', gap: 7 },
  galleryThumb: { width: 50, height: 50, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.11)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  galleryLabel: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: 'rgba(255,255,255,0.72)' },

  captureBtn: { alignItems: 'center', justifyContent: 'center' },
  captureOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  captureInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },

  autoControl: { width: 72, alignItems: 'center', gap: 7 },
  autoBadge: { minWidth: 50, height: 50, paddingHorizontal: 9, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.11)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  autoBadgeActive: { backgroundColor: `${Colors.primary}22`, borderColor: `${Colors.primary}88` },
  autoBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.7)' },
  autoBadgeDotActive: { backgroundColor: Colors.primary },
  autoBadgeText: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs, color: '#fff' },
})
