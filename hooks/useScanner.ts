import { useState, useRef, useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import { CameraView } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { saveAnalysis } from './useIngredientAnalysis'
import { useDietaryPreferences } from './useDietaryPreferences'
import { filterTextToGuideBox } from '@/detection/textRegionFilter'

export const IS_WEB = Platform.OS === 'web'

export type ScanStep = 'camera' | 'processing' | 'manual'
export type ScanError = { message: string; allowManual?: boolean } | null

const PROCESSING_TIPS = [
  'Identifying ingredients...',
  'Checking safety levels...',
  'Scanning country regulations...',
  'Analyzing health concerns...',
  'Almost there...',
]

const PROCESSING_TIMEOUT_MS = 30_000

export function useScanner(userId: string, onSuccess: (scanId: string) => void) {
  const { preferences } = useDietaryPreferences()
  const [step, setStep] = useState<ScanStep>('camera')
  const [flash, setFlash] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [processingTip, setProcessingTip] = useState(0)
  const [manualText, setManualText] = useState('')
  const [scanError, setScanError] = useState<ScanError>(null)
  const cameraRef = useRef<CameraView>(null)
  const tipInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  const startTipCycle = useCallback(() => {
    if (tipInterval.current) clearInterval(tipInterval.current)
    let i = 0
    tipInterval.current = setInterval(() => {
      i = (i + 1) % PROCESSING_TIPS.length
      setProcessingTip(i)
    }, 1800)
  }, [])

  const stopTipCycle = useCallback(() => {
    if (tipInterval.current) {
      clearInterval(tipInterval.current)
      tipInterval.current = null
    }
  }, [])

  const clearProcessingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const activateCamera = useCallback(() => {
    setCameraActive(true)
    setScanError(null)
  }, [])

  const deactivateCamera = useCallback(() => {
    setCameraActive(false)
    setCameraReady(false)
    stopTipCycle()
    clearProcessingTimeout()
  }, [clearProcessingTimeout, stopTipCycle])

  useEffect(() => {
    return () => {
      stopTipCycle()
      clearProcessingTimeout()
    }
  }, [clearProcessingTimeout, stopTipCycle])

  const processText = useCallback(async (text: string) => {
    if (!userId) {
      setScanError({ message: 'Must be logged in to scan.', allowManual: true })
      return
    }
    setScanError(null)
    setStep('processing')
    startTipCycle()
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return
      requestIdRef.current += 1
      stopTipCycle()
      clearProcessingTimeout()
      setStep(IS_WEB ? 'manual' : 'camera')
      setScanError({ message: 'The analysis took too long. Please try again.', allowManual: true })
    }, PROCESSING_TIMEOUT_MS)

    const { scanId, error } = await saveAnalysis(text, userId, preferences)
    clearProcessingTimeout()
    if (requestIdRef.current !== requestId) return

    stopTipCycle()

    if (error || !scanId) {
      setStep(IS_WEB ? 'manual' : 'camera')
      setScanError({ message: error || 'Could not analyse ingredients. Please try again.', allowManual: true })
      return
    }

    setManualText('')
    setScanError(null)
    setStep(IS_WEB ? 'manual' : 'camera')
    onSuccess(scanId)
  }, [userId, preferences, clearProcessingTimeout, startTipCycle, stopTipCycle, onSuccess])

  const recognizeFromUri = useCallback(async (
    uri: string,
    guideBox?: { photoWidth?: number; photoHeight?: number }
  ) => {
    if (IS_WEB) {
      stopTipCycle()
      setStep('manual')
      setScanError({ message: 'Camera OCR is not available on web. Please type the ingredients manually.' })
      return
    }

    try {
      const TextRecognition = (await import('@react-native-ml-kit/text-recognition')).default
      const result = await TextRecognition.recognize(uri)
      const rawText = result.text?.trim() || ''
      // Only camera captures pass a guideBox — gallery picks have no on-screen
      // box to confine to, so they always use the full recognized text.
      const text = guideBox
        ? filterTextToGuideBox(result.blocks, rawText, guideBox.photoWidth, guideBox.photoHeight).trim()
        : rawText

      if (!text || text.length < 10) {
        stopTipCycle()
        setStep('camera')
        setScanError({
          message: 'Could not read the label. Try better lighting or a flatter surface.',
          allowManual: true,
        })
        return
      }

      setManualText(text)
      stopTipCycle()
      setStep('manual')
      setScanError(null)
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: e.message || 'Could not read the image.', allowManual: true })
    }
  }, [stopTipCycle])

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return
    setScanError(null)

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
      })

      if (!photo?.uri) return

      setStep('processing')
      startTipCycle()
      await recognizeFromUri(photo.uri, { photoWidth: photo.width, photoHeight: photo.height })
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({
        message: e.message || 'Could not take photo. Try again.',
        allowManual: true,
      })
    }
  }, [cameraReady, startTipCycle, stopTipCycle, recognizeFromUri])

  const handleGalleryPick = useCallback(async () => {
    setScanError(null)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      })

      if (result.canceled || !result.assets?.[0]) return

      setStep('processing')
      startTipCycle()
      await recognizeFromUri(result.assets[0].uri)
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: e.message || 'Could not open gallery.', allowManual: true })
    }
  }, [startTipCycle, stopTipCycle, recognizeFromUri])

  const handleManualSubmit = useCallback(async () => {
    if (!manualText.trim() || manualText.trim().length < 3) {
      setScanError({ message: 'Please enter at least one ingredient.' })
      return
    }
    await processText(manualText.trim())
  }, [manualText, processText])

  const clearError = useCallback(() => setScanError(null), [])

  const cancelProcessing = useCallback(() => {
    stopTipCycle()
    clearProcessingTimeout()
    requestIdRef.current += 1 // Invalidate current request
    setScanError(null)
    setStep(IS_WEB ? 'manual' : 'camera')
  }, [stopTipCycle, clearProcessingTimeout])

  return {
    step, setStep,
    flash, setFlash,
    cameraActive,
    cameraReady, setCameraReady,
    processingTip,
    manualText, setManualText,
    scanError, clearError,
    cameraRef,
    processingTips: PROCESSING_TIPS,
    activateCamera,
    deactivateCamera,
    handleCapture,
    handleGalleryPick,
    handleManualSubmit,
    cancelProcessing,
    recognizeFromUri,
  }
}