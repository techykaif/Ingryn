import { useState, useRef, useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import { CameraView } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { saveAnalysis } from './useIngredientAnalysis'
import { useDietaryPreferences } from './useDietaryPreferences'
import { filterTextToGuideBox } from '@/detection/textRegionFilter'

export const IS_WEB = Platform.OS === 'web'

export type ScanStep = 'camera' | 'processing'
export type ScanError = { message: string } | null

const PROCESSING_TIPS = [
  'Identifying ingredients...',
  'Checking safety levels...',
  'Scanning country regulations...',
  'Analyzing health concerns...',
  'Almost there...',
]

const PROCESSING_TIMEOUT_MS = 30_000

export function useScanner(
  userId: string,
  onSuccess: (scanId: string) => void,
  guideViewport: { width: number; height: number }
) {
  const { preferences } = useDietaryPreferences()
  const [step, setStep] = useState<ScanStep>('camera')
  const [flash, setFlash] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [processingTip, setProcessingTip] = useState(0)
  const [scanError, setScanError] = useState<ScanError>(null)
  const cameraRef = useRef<CameraView>(null)
  const tipInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  const startTipCycle = useCallback(() => {
    if (tipInterval.current) clearInterval(tipInterval.current)
    let i = 0
    setProcessingTip(0)
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
      setStep('camera')
      setScanError({ message: 'Please sign in before scanning.' })
      return
    }

    setScanError(null)
    setStep('processing')
    startTipCycle()
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    clearProcessingTimeout()
    timeoutRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return
      requestIdRef.current += 1
      stopTipCycle()
      clearProcessingTimeout()
      setStep('camera')
      setScanError({ message: 'The analysis took too long. Please try again.' })
    }, PROCESSING_TIMEOUT_MS)

    const { scanId, error } = await saveAnalysis(text, userId, preferences)
    clearProcessingTimeout()

    if (requestIdRef.current !== requestId) return

    stopTipCycle()

    if (error || !scanId) {
      setStep('camera')
      setScanError({ message: error || 'Could not analyse ingredients. Please try again.' })
      return
    }

    setScanError(null)
    setStep('camera')
    onSuccess(scanId)
  }, [
    userId,
    preferences,
    clearProcessingTimeout,
    startTipCycle,
    stopTipCycle,
    onSuccess,
  ])

  const recognizeFromUri = useCallback(async (
    uri: string,
    guideBox?: { photoWidth?: number; photoHeight?: number }
  ) => {
    if (IS_WEB) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: 'Camera analysis is available in the mobile app.' })
      return
    }

    try {
      const TextRecognition = (await import('@react-native-ml-kit/text-recognition')).default
      const result = await TextRecognition.recognize(uri)
      const rawText = result.text?.trim() || ''
      const text = guideBox
        ? filterTextToGuideBox(
          result.blocks,
          rawText,
          guideBox.photoWidth,
          guideBox.photoHeight,
          guideViewport
        ).trim()
        : rawText

      if (!text || text.length < 10) {
        stopTipCycle()
        setStep('camera')
        setScanError({
          message: 'Could not read the label. Try better lighting and keep the ingredients centered.',
        })
        return
      }

      // Direct flow: OCR -> durable server analysis -> results.
      // There is deliberately no editable/manual review step here.
      await processText(text)
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: e.message || 'Could not read the image.' })
    }
  }, [guideViewport, processText, stopTipCycle])

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return
    setScanError(null)

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        shutterSound: false,
      })

      if (!photo?.uri) return

      await recognizeFromUri(photo.uri, {
        photoWidth: photo.width,
        photoHeight: photo.height,
      })
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: e.message || 'Could not take photo. Try again.' })
    }
  }, [cameraReady, stopTipCycle, recognizeFromUri])

  const handleGalleryPick = useCallback(async () => {
    setScanError(null)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      })

      if (result.canceled || !result.assets?.[0]) return

      await recognizeFromUri(result.assets[0].uri)
    } catch (e: any) {
      stopTipCycle()
      setStep('camera')
      setScanError({ message: e.message || 'Could not open gallery.' })
    }
  }, [stopTipCycle, recognizeFromUri])

  const clearError = useCallback(() => setScanError(null), [])

  const cancelProcessing = useCallback(() => {
    stopTipCycle()
    clearProcessingTimeout()
    requestIdRef.current += 1
    setScanError(null)
    setStep('camera')
  }, [stopTipCycle, clearProcessingTimeout])

  return {
    step,
    setStep,
    flash,
    setFlash,
    cameraActive,
    cameraReady,
    setCameraReady,
    processingTip,
    scanError,
    clearError,
    cameraRef,
    processingTips: PROCESSING_TIPS,
    activateCamera,
    deactivateCamera,
    handleCapture,
    handleGalleryPick,
    cancelProcessing,
    recognizeFromUri,
  }
}
