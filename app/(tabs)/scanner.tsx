import { useCallback, useEffect, useMemo } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, ScrollView, useWindowDimensions, InteractionManager
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
import { CameraOverlay } from '@/components/CameraOverlay'
import { GUIDE_WIDTH_RATIO, GUIDE_HEIGHT_RATIO } from '@/detection/textRegionFilter'
import { Colors, Fonts, FontSizes, Spacing, Radius, Shadows } from '@/constants/theme'
import type { DetectionState } from '@/detection/CameraStateMachine'
import type { DetectionClassification } from '@/detection/DetectionEngine'
import {
  Image as ImageIcon, TextT, Lightning, LightningSlash,
  Scan, ArrowLeft, Camera, Warning, X
} from 'phosphor-react-native'

const FRAME_W = GUIDE_WIDTH_RATIO
const FRAME_H = GUIDE_HEIGHT_RATIO

export default function ScannerScreen() {
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const frameW = width * FRAME_W
  const frameH = height * FRAME_H
  const guideViewport = useMemo(() => ({ width, height }), [width, height])
  const { user } = useAuthStore()
  const [permission, requestPermission] = useCameraPermissions()

  const {
    step, setStep,
    flash, setFlash,
    cameraActive,
    cameraReady, setCameraReady,
    processingTip,
    manualText, setManualText,
    scanError, clearError,
    cameraRef,
    processingTips,
    activateCamera,
    deactivateCamera,
    handleCapture,
    handleGalleryPick,
    handleManualSubmit,
    cancelProcessing,
    recognizeFromUri,
  } = useScanner(
    user?.id || '',
    (scanId) => router.push(`/results/${scanId}`),
    guideViewport
  )

  // ── Real-time detection ──
  const handleAutoCapture = useCallback((uri: string, width?: number, height?: number) => {
    // Feed the auto-captured photo into the existing OCR → manual-review pipeline,
    // confined to the guide box so text outside it doesn't leak into the result.
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

  if (step === 'manual') {
    return (
      <ManualScreen
        value={manualText}
        onChange={setManualText}
        onSubmit={handleManualSubmit}
        onBack={() => { setStep('camera'); clearError() }}
        error={scanError?.message}
        clearError={clearError}
      />
    )
  }

  if (!permission?.granted) {
    return (
      <PermissionScreen
        onGrant={requestPermission}
        onManual={() => setStep('manual')}
      />
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
      onManual={() => { setStep('manual'); clearError() }}
      error={scanError?.message}
      allowManual={scanError?.allowManual}
      clearError={clearError}
      frameW={frameW}
      frameH={frameH}
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
function PermissionScreen({ onGrant, onManual }: { onGrant: () => void; onManual: () => void }) {
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
      <TouchableOpacity style={styles.permissionSecondary} onPress={onManual}>
        <TextT size={16} color={Colors.primary} weight="bold" />
        <Text style={styles.permissionSecondaryText}>Type ingredients manually</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Manual entry ─────────────────────────────────────────────────────────────
function ManualScreen({
  value, onChange, onSubmit, onBack, error, clearError
}: {
  value: string; onChange: (t: string) => void; onSubmit: () => void
  onBack: () => void; error?: string; clearError: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView style={styles.manualContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="dark" />
      <View style={[styles.manualHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onBack} style={[styles.backBtn, Shadows.sm]}>
          <ArrowLeft size={22} color={Colors.textPrimary} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.manualTitle}>Review ingredients</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={styles.manualScroll} contentContainerStyle={styles.manualContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.manualSubtitle}>Please verify and edit the ingredients list before analyzing.</Text>

        {error ? (
          <View style={styles.errorBanner}>
            <Warning size={14} color={Colors.danger} weight="fill" />
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={clearError} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color={Colors.danger} weight="bold" />
            </TouchableOpacity>
          </View>
        ) : null}

        <TextInput
          style={styles.manualInput}
          value={value}
          onChangeText={t => { onChange(t); clearError() }}
          placeholder="Water, Sugar, Salt, Sodium Benzoate, Yellow 5..."
          placeholderTextColor={Colors.textTertiary}
          multiline
          numberOfLines={8}
          autoFocus
          textAlignVertical="top"
        />
        <Text style={styles.manualHint}>Comma-separated works best</Text>

        <TouchableOpacity
          style={[styles.analyzeBtn, !value.trim() && styles.analyzeBtnDisabled, Shadows.primary]}
          onPress={onSubmit}
          disabled={!value.trim()}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={value.trim() ? [Colors.primary, Colors.primaryDark] : [Colors.border, Colors.border]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={styles.analyzeBtnGradient}
          >
            <Scan size={18} color={value.trim() ? '#fff' : Colors.textTertiary} weight="bold" />
            <Text style={[styles.analyzeBtnText, !value.trim() && styles.analyzeBtnTextDisabled]}>
              Analyse ingredients
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ─── Camera (stays dark) ──────────────────────────────────────────────────────
function CameraScreen({
  cameraRef, cameraActive, cameraReady, onCameraReady,
  flash, onFlashToggle, onCapture, onGallery, onManual,
  error, allowManual, clearError, frameW, frameH,
  detectionState, confidence, classification, guidanceMessage, isScanning
}: {
  cameraRef: React.RefObject<CameraView | null>
  cameraActive: boolean; cameraReady: boolean; onCameraReady: () => void
  flash: boolean; onFlashToggle: () => void
  onCapture: () => void; onGallery: () => void; onManual: () => void
  error?: string; allowManual?: boolean; clearError: () => void
  frameW: number; frameH: number
  detectionState: DetectionState
  confidence: number
  classification: DetectionClassification
  guidanceMessage: string
  isScanning: boolean
}) {
  const insets = useSafeAreaInsets()

  // Determine top instruction text based on realtime detection
  const getTopInstruction = () => {
    if (!cameraReady) return 'Initialising camera...'
    if (isScanning && guidanceMessage) return guidanceMessage
    return 'Point at ingredient list'
  }

  // Determine bottom hint text
  const getBottomHint = () => {
    if (!cameraReady) return 'Please wait...'
    if (detectionState === 'CONFIRMED' || detectionState === 'CAPTURING') {
      return 'Auto capturing...'
    }
    if (isScanning) return 'Auto-capture enabled • or tap to capture'
    return 'Tap the button to capture'
  }

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

      {/* Top bar */}
      <View style={[styles.topFade, { paddingTop: insets.top || 24 }]}>
        <View style={styles.topBar}>
          <Text style={styles.topBarBrand}>INGRYN</Text>
          <TouchableOpacity style={[styles.flashBtn, flash && styles.flashBtnActive]} onPress={onFlashToggle}>
            {flash
              ? <LightningSlash size={18} color="#000" weight="fill" />
              : <Lightning size={18} color="#fff" weight="bold" />
            }
          </TouchableOpacity>
        </View>
        <Text style={styles.topInstruction}>
          {getTopInstruction()}
        </Text>
      </View>

      {/* Real-time detection overlay (replaces static frame when scanning) */}
      {isScanning ? (
        <View style={styles.frameWrapper}>
          <CameraOverlay
            state={detectionState}
            confidence={confidence}
            guidanceMessage={guidanceMessage}
            classification={classification}
            frameW={frameW}
            frameH={frameH}
          />
        </View>
      ) : (
        /* Static scan frame (fallback when not scanning, e.g. web) */
        <View style={styles.frameWrapper}>
          <View style={[styles.frame, { width: frameW, height: frameH }]}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            <View style={styles.scanLine} />
          </View>
        </View>
      )}

      {/* Error banner over camera */}
      {error ? (
        <View style={styles.cameraErrorBanner}>
          <Warning size={14} color="#fff" weight="fill" />
          <Text style={styles.cameraErrorText} numberOfLines={2}>{error}</Text>
          <View style={styles.cameraErrorActions}>
            {allowManual && (
              <TouchableOpacity style={styles.cameraErrorBtn} onPress={onManual}>
                <Text style={styles.cameraErrorBtnText}>Type</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={clearError} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color="#fff" weight="bold" />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Bottom controls */}
      <View style={styles.bottomFade}>
        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.sideBtn} onPress={onGallery} activeOpacity={0.8}>
            <View style={styles.sideBtnInner}>
              <ImageIcon size={22} color="#fff" weight="regular" />
            </View>
            <Text style={styles.sideBtnLabel}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.captureBtn, !cameraReady && { opacity: 0.4 }]}
            onPress={onCapture}
            disabled={!cameraReady}
            activeOpacity={0.85}
          >
            <View style={styles.captureOuter}>
              <View style={styles.captureInner} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sideBtn} onPress={onManual} activeOpacity={0.8}>
            <View style={styles.sideBtnInner}>
              <TextT size={22} color="#fff" weight="regular" />
            </View>
            <Text style={styles.sideBtnLabel}>Manual</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bottomHint}>
          {getBottomHint()}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
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

  manualContainer: { flex: 1, backgroundColor: Colors.background },
  manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 0, paddingHorizontal: Spacing['2xl'], marginBottom: Spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  manualTitle: { fontFamily: Fonts.bold, fontSize: FontSizes.xl, color: Colors.textPrimary },
  manualScroll: { flex: 1 },
  manualContent: { paddingHorizontal: Spacing['2xl'], paddingBottom: 48, paddingTop: Spacing.md },
  manualSubtitle: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textSecondary, lineHeight: 24, marginBottom: Spacing.lg },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.lg },
  errorBannerText: { flex: 1, fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: Colors.danger, lineHeight: 18 },
  manualInput: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.xl, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl, fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textPrimary, minHeight: 180, marginBottom: Spacing.sm, lineHeight: 24, ...Shadows.sm },
  manualHint: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: Colors.textTertiary, marginBottom: Spacing['2xl'] },
  analyzeBtn: { borderRadius: Radius.xl, overflow: 'hidden' },
  analyzeBtnDisabled: { opacity: 0.5 },
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  analyzeBtnText: { fontFamily: Fonts.bold, fontSize: FontSizes.lg, color: '#fff' },
  analyzeBtnTextDisabled: { color: Colors.textTertiary },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 0, paddingBottom: 24, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.55)', gap: 6 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarBrand: { fontFamily: Fonts.extrabold, fontSize: FontSizes.base, color: Colors.primary, letterSpacing: 4 },
  flashBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  flashBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  topInstruction: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.3 },
  frameWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: Colors.primary },
  tl: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 5 },
  tr: { top: 0, right: 0, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 5 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 5 },
  br: { bottom: 0, right: 0, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 5 },
  scanLine: { width: '100%', maxWidth: 240, height: 1.5, backgroundColor: `${Colors.primary}40` },
  cameraErrorBanner: { position: 'absolute', left: 16, right: 16, bottom: 160, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.9)', borderRadius: Radius.xl, padding: Spacing.lg },
  cameraErrorText: { flex: 1, fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: '#fff', lineHeight: 18 },
  cameraErrorActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cameraErrorBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  cameraErrorBtnText: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs, color: '#fff' },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 52, paddingTop: 28, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', gap: 16 },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  sideBtn: { alignItems: 'center', gap: 8 },
  sideBtnInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  sideBtnLabel: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.3 },
  captureBtn: { alignItems: 'center', justifyContent: 'center' },
  captureOuter: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: `${Colors.primary}12` },
  captureInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: Colors.primary },
  bottomHint: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: 'rgba(255,255,255,0.25)', letterSpacing: 0.3 },
})