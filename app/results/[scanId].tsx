import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, TextInput, Modal
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '@/lib/supabase'
import { useAuthStore, useScanProgressStore } from '@/store'
import { useDietaryPreferences } from '@/hooks/useDietaryPreferences'
import { parseIngredientNames } from '@/hooks/useIngredientAnalysis'
import { Colors, Fonts, FontSizes, Spacing, Radius, Shadows } from '@/constants/theme'
import { getScoreColor, getScoreLabel, getSafetyColor, getSafetyLabel, formatDate } from '@/lib/scanUtils'
import { fetchCountryRules } from '@/lib/countryRules'
import {
  ArrowLeft, PencilSimple, Warning, CheckCircle,
  ShieldWarning, Globe, User, ArrowRight, X
} from 'phosphor-react-native'

type Ingredient = {
  id: string
  name: string
  aliases: string[]
  category: string
  description: string
  safety_level: 'safe' | 'caution' | 'harmful' | 'unknown'
  health_concerns: string[]
  country_status: Record<string, string>
}

type ScanData = {
  id: string
  label: string | null
  safety_score: number
  created_at: string
  raw_ocr_text: string
  ingredient_ids: string[]
}

const ALLERGY_KEYWORDS: Record<string, string[]> = {
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'malt'],
  dairy: ['dairy', 'milk', 'lactose', 'casein', 'whey', 'cream', 'butter'],
  nuts: ['almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'pistachio'],
  peanuts: ['peanut', 'groundnut', 'arachis'],
  soy: ['soy', 'soya', 'soybean', 'tofu'],
  eggs: ['egg', 'albumin', 'lecithin'],
  shellfish: ['shrimp', 'crab', 'lobster', 'shellfish', 'prawn'],
  fish: ['fish', 'anchovy', 'salmon', 'tuna', 'cod'],
  sulphites: ['sulphite', 'sulfite', 'sulphur', 'sulfur', 'e220', 'e221', 'e222', 'e223', 'e224'],
  sesame: ['sesame', 'tahini', 'til'],
}

const CONDITION_KEYWORDS: Record<string, string[]> = {
  diabetes: ['sugar', 'fructose', 'glucose', 'dextrose', 'maltose', 'sucrose', 'syrup'],
  hypertension: ['sodium', 'salt', 'monosodium', 'msg'],
  celiac: ['gluten', 'wheat', 'barley', 'rye'],
  kidney_disease: ['potassium', 'phosphate', 'phosphorus', 'sodium'],
  heart_disease: ['trans fat', 'hydrogenated', 'palm oil'],
  pregnancy: ['caffeine', 'retinol', 'aspartame', 'saccharin', 'nitrate', 'nitrite'],
  ibs: ['sorbitol', 'mannitol', 'xylitol', 'fructose', 'lactose', 'dairy', 'wheat', 'carrageenan'],
  liver_disease: ['alcohol', 'ethanol', 'sodium', 'trans fat', 'fructose', 'sugar'],
}

const DIET_KEYWORDS: Record<string, string[]> = {
  vegan: ['gelatin', 'carmine', 'e120', 'lard', 'rennet', 'casein', 'whey', 'albumin', 'lactose', 'honey', 'bone broth', 'animal fat'],
  vegetarian: ['gelatin', 'lard', 'rennet', 'carmine', 'e120', 'bone broth', 'animal fat'],
  halal: ['alcohol', 'ethanol', 'gelatin', 'lard', 'pork', 'animal fat'],
  kosher: ['lard', 'pork', 'shellfish', 'gelatin', 'animal fat'],
  keto: ['sugar', 'glucose', 'fructose', 'maltodextrin', 'starch', 'dextrose'],
  paleo: ['grain', 'wheat', 'soy', 'legume', 'lentil', 'bean', 'corn', 'oat', 'barley', 'rye', 'dextrose', 'maltodextrin', 'sugar'],
}

export default function ResultsScreen() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>()
  const router = useRouter()
  const { preferences } = useDietaryPreferences()
  const { user } = useAuthStore()
  const isProcessing = useScanProgressStore(state => state.activeScans[scanId])

  const [scan, setScan] = useState<ScanData | null>(null)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [labelModal, setLabelModal] = useState(false)
  const [labelText, setLabelText] = useState('')
  const [labelError, setLabelError] = useState('')
  const [saving, setSaving] = useState(false)
  const insets = useSafeAreaInsets()

  const fetchResults = useCallback(async () => {
    if (!user?.id) return
    try {
      const { data: scanData, error: scanError } = await supabase
        .from('scans').select('id, label, safety_score, created_at, raw_ocr_text, ingredient_ids').eq('id', scanId).eq('user_id', user.id).single()
      if (scanError) throw scanError
      setScan(scanData)
      setLabelText(scanData.label || '')

      if (scanData.ingredient_ids?.length > 0) {
        const [ingredientResult, countryRules] = await Promise.all([
          supabase
            .from('ingredients')
            .select('id, name, aliases, category, description, safety_level, health_concerns')
            .in('id', scanData.ingredient_ids),
          fetchCountryRules(scanData.ingredient_ids),
        ])

        if (ingredientResult.error) throw ingredientResult.error

        const order = { harmful: 0, caution: 1, unknown: 2, safe: 3 }
        const merged = (ingredientResult.data || []).map(ingredient => ({
          ...ingredient,
          country_status: countryRules.get(ingredient.id)?.status || {},
        }))

        const sorted = merged.sort((a, b) =>
          (order[a.safety_level as keyof typeof order] ?? 2) -
          (order[b.safety_level as keyof typeof order] ?? 2)
        )
        setIngredients(sorted)
      }
    } catch (e: any) {
      setErrorMsg(e.message)
    } finally {
      setLoading(false)
    }
  }, [scanId, user?.id])

  useEffect(() => { fetchResults() }, [fetchResults])

  useEffect(() => {
    if (!isProcessing || !scanId) return

    let disposed = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null

    const clearFallback = () => {
      if (fallbackInterval) {
        clearInterval(fallbackInterval)
        fallbackInterval = null
      }
    }

    const startFallback = () => {
      if (fallbackInterval || disposed) return
      fallbackInterval = setInterval(() => {
        fetchResults()
      }, 5000)
    }

    const channel = supabase
      .channel(`scan-results-${scanId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scans',
          filter: `id=eq.${scanId}`,
        },
        () => {
          if (!disposed) fetchResults()
        },
      )
      .subscribe((status) => {
        if (disposed) return

        if (status === 'SUBSCRIBED') {
          clearFallback()
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          startFallback()
        }
      })

    return () => {
      disposed = true
      clearFallback()
      void supabase.removeChannel(channel)
    }
  }, [isProcessing, scanId, fetchResults])

  async function saveLabel() {
    if (!labelText.trim()) {
      setLabelError('Please enter a name for this scan.')
      return
    }
    if (!user?.id) return
    setSaving(true)
    const { error } = await supabase
      .from('scans').update({ label: labelText.trim() }).eq('id', scanId).eq('user_id', user?.id)
    setSaving(false)
    if (error) {
      setLabelError(error.message || 'Could not save the name. Please try again.')
    } else {
      setScan(prev => prev ? { ...prev, label: labelText.trim() } : prev)
      setLabelError('')
      setLabelModal(false)
    }
  }

  function openLabelModal() {
    setLabelError('')
    setLabelModal(true)
  }

  const hasPreferences =
    preferences.conditions.length > 0 ||
    preferences.allergies.length > 0 ||
    preferences.diet_type !== 'none'

  const getPersonalFlag = useCallback((ingredient: Ingredient): string | null => {
    if (!hasPreferences) return null

    const haystack = [ingredient.name, ...(ingredient.aliases || []), ingredient.category]
      .join(' ').toLowerCase()

    for (const allergy of preferences.allergies) {
      if ((ALLERGY_KEYWORDS[allergy] || []).some(k => haystack.includes(k)))
        return `May trigger your ${allergy} allergy`
    }
    for (const condition of preferences.conditions) {
      if ((CONDITION_KEYWORDS[condition] || []).some(k => haystack.includes(k)))
        return `May be relevant to your ${condition.replace('_', ' ')}`
    }
    if (preferences.diet_type !== 'none') {
      if ((DIET_KEYWORDS[preferences.diet_type] || []).some(k => haystack.includes(k)))
        return `May not be suitable for ${preferences.diet_type} diet`
    }
    return null
  }, [hasPreferences, preferences])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading results...</Text>
      </View>
    )
  }

  if (errorMsg || !scan) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMsg || 'Something went wrong'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.errorBtn}>
          <Text style={styles.errorBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const scoreColor = isProcessing ? Colors.textTertiary : getScoreColor(scan.safety_score)
  const scoreLabel = isProcessing ? 'Analyzing...' : getScoreLabel(scan.safety_score)
  const harmfulCount = ingredients.filter(i => i.safety_level === 'harmful').length
  const cautionCount = ingredients.filter(i => i.safety_level === 'caution').length
  const safeCount = ingredients.filter(i => i.safety_level === 'safe').length
  const bannedCount = ingredients.filter(i => Object.values(i.country_status || {}).includes('banned')).length
  const flaggedIngredients = ingredients.filter(i => getPersonalFlag(i))

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={Colors.textPrimary} weight="bold" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.labelBtn} onPress={openLabelModal}>
            <Text style={styles.labelBtnText} numberOfLines={1}>
              {scan.label || 'Name this scan'}
            </Text>
            <PencilSimple size={14} color={Colors.primary} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* Score card */}
        <View style={[styles.scoreCard, Shadows.md]}>
          <View style={styles.scoreLeft}>
            <Text style={styles.scoreTitle}>Safety score</Text>
            {isProcessing && ingredients.length === 0 ? (
              <ActivityIndicator color={Colors.primary} size="small" style={{ alignSelf: 'flex-start', marginVertical: 8 }} />
            ) : (
              <Text style={[styles.scoreNumber, { color: scoreColor }]}>{scan.safety_score}</Text>
            )}
            <Text style={styles.scoreDate}>{formatDate(scan.created_at, true)}</Text>
          </View>
          <View style={[styles.scoreRing, { borderColor: `${scoreColor}40` }]}>
            <View style={[styles.scoreRingInner, { backgroundColor: `${scoreColor}12` }]}>
              {isProcessing && ingredients.length === 0 ? (
               <ActivityIndicator color={scoreColor} size="small" />
              ) : (
                <>
                  <Text style={[styles.scoreRingNum, { color: scoreColor }]}>{scan.safety_score}</Text>
                  <Text style={[styles.scoreRingLabel, { color: scoreColor }]}>{scoreLabel}</Text>
                </>
              )}
            </View>
          </View>
        </View>

        {/* Stats strip */}
        <View style={[styles.statsStrip, Shadows.sm]}>
          {[
            { num: harmfulCount, label: 'Harmful', color: Colors.harmful },
            { num: cautionCount, label: 'Caution', color: Colors.caution },
            { num: safeCount, label: 'Safe', color: Colors.safe },
            { num: bannedCount, label: 'Banned', color: Colors.harmful },
          ].map((s, i, arr) => (
            <View key={s.label} style={styles.statGroup}>
              <View style={styles.statItem}>
                <Text style={[styles.statNum, { color: s.color }]}>{s.num}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
              {i < arr.length - 1 && <View style={styles.statDivider} />}
            </View>
          ))}
        </View>

        {isProcessing && (
          <View style={styles.processingAlert}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text style={styles.processingAlertText}>AI is analyzing ingredients in the background...</Text>
          </View>
        )}

        {/* Personal flag alert */}
        {hasPreferences && flaggedIngredients.length > 0 && (
          <View style={styles.personalAlert}>
            <View style={styles.personalAlertIcon}>
              <User size={16} color={Colors.personal} weight="fill" />
            </View>
            <View style={styles.personalAlertText}>
              <Text style={styles.personalAlertTitle}>
                {flaggedIngredients.length} ingredient{flaggedIngredients.length > 1 ? 's' : ''} flagged for you
              </Text>
              <Text style={styles.personalAlertSub}>Based on your dietary preferences</Text>
            </View>
          </View>
        )}

        {/* Country ban alert */}
        {bannedCount > 0 && (
          <View style={styles.banAlert}>
            <Globe size={18} color={Colors.harmful} weight="fill" />
            <Text style={styles.banAlertText}>
              {bannedCount} ingredient{bannedCount > 1 ? 's are' : ' is'} banned in at least one country
            </Text>
          </View>
        )}

        {/* Ingredients */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Ingredients ({ingredients.length}{isProcessing ? '...' : ''})
          </Text>
          {ingredients.map(ingredient => {
            const personalFlag = getPersonalFlag(ingredient)
            const safetyColor = getSafetyColor(ingredient.safety_level)
            const safetyLabel = getSafetyLabel(ingredient.safety_level)
            return (
              <TouchableOpacity
                key={ingredient.id}
                style={[styles.card, personalFlag && styles.cardFlagged, Shadows.sm]}
                onPress={() => router.push(`/ingredient/${ingredient.id}`)}
                activeOpacity={0.8}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.cardName}>
                      {ingredient.name.charAt(0).toUpperCase() + ingredient.name.slice(1)}
                    </Text>
                    <Text style={styles.cardCategory}>{ingredient.category}</Text>
                  </View>
                  <View style={[styles.safetyBadge, { backgroundColor: `${safetyColor}15` }]}>
                    {ingredient.safety_level === 'harmful' && <ShieldWarning size={10} color={safetyColor} weight="fill" />}
                    {ingredient.safety_level === 'caution' && <Warning size={10} color={safetyColor} weight="fill" />}
                    {ingredient.safety_level === 'safe' && <CheckCircle size={10} color={safetyColor} weight="fill" />}
                    <Text style={[styles.safetyBadgeText, { color: safetyColor }]}>{safetyLabel}</Text>
                  </View>
                </View>

                <Text style={styles.cardDesc} numberOfLines={2}>{ingredient.description}</Text>

                {personalFlag && (
                  <View style={styles.personalFlagRow}>
                    <User size={11} color={Colors.personal} weight="fill" />
                    <Text style={styles.personalFlagText}>{personalFlag}</Text>
                  </View>
                )}

                {ingredient.health_concerns?.length > 0 && (
                  <View style={styles.concernRow}>
                    <Warning size={11} color={Colors.caution} weight="fill" />
                    <Text style={styles.concernText} numberOfLines={1}>
                      {ingredient.health_concerns[0]}
                    </Text>
                  </View>
                )}

                <View style={styles.cardFooter}>
                  <Text style={styles.viewDetails}>View details</Text>
                  <View style={styles.cardFooterRight}>
                    {Object.values(ingredient.country_status || {}).includes('banned') && (
                      <View style={styles.bannedChip}>
                        <Text style={styles.bannedChipText}>🚫 Banned</Text>
                      </View>
                    )}
                    <ArrowRight size={14} color={Colors.textTertiary} weight="bold" />
                  </View>
                </View>
              </TouchableOpacity>
            )
          })}

          {isProcessing && Array.from({ length: Math.min(5, Math.max(1, parseIngredientNames(scan.raw_ocr_text).length - ingredients.length)) }).map((_, i) => (
            <View key={`skel-${i}`} style={[styles.card, Shadows.sm, { opacity: 0.5 }]}>
              <View style={styles.cardTop}>
                <View style={[styles.skeletonLine, { width: '40%' }]} />
                <View style={[styles.skeletonLine, { width: 60 }]} />
              </View>
              <View style={[styles.skeletonLine, { width: '80%', marginTop: 8 }]} />
              <View style={[styles.skeletonLine, { width: '60%', marginTop: 4 }]} />
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Label modal */}
      <Modal visible={labelModal} transparent animationType="slide" onRequestClose={() => setLabelModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, Shadows.lg]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Name this scan</Text>
              <TouchableOpacity onPress={() => { setLabelModal(false); setLabelError('') }} style={styles.modalCloseBtn}>
                <X size={16} color={Colors.textSecondary} weight="bold" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>Product name</Text>
            <TextInput
              style={[styles.modalInput, labelError ? { borderColor: Colors.danger, marginBottom: Spacing.sm } : null]}
              value={labelText}
              onChangeText={t => { setLabelText(t); setLabelError('') }}
              placeholder="e.g. Lays Classic, Coca Cola..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              autoCapitalize="words"
            />
            {labelError ? (
              <Text style={styles.modalErrorText}>{labelError}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.modalBtn, saving && { opacity: 0.6 }, Shadows.primary]}
              onPress={saveLabel}
              disabled={saving}
            >
              <LinearGradient
                colors={[Colors.primary, Colors.primaryDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalBtnGradient}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.modalBtnText}>Save name</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textSecondary },
  errorText: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.danger, textAlign: 'center', paddingHorizontal: 32 },
  errorBtn: { backgroundColor: Colors.primaryLight, borderRadius: Radius.xl, paddingHorizontal: 24, paddingVertical: 12 },
  errorBtnText: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 0, paddingHorizontal: Spacing['2xl'], marginBottom: Spacing.xl,
  },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', ...Shadows.sm },
  labelBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingLeft: 16 },
  labelBtnText: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.textPrimary, maxWidth: 200 },

  scoreCard: { marginHorizontal: Spacing['2xl'], backgroundColor: Colors.surface, borderRadius: Radius['2xl'], padding: Spacing['2xl'], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  scoreLeft: { gap: 4 },
  scoreTitle: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreNumber: { fontFamily: Fonts.extrabold, fontSize: FontSizes['7xl'], lineHeight: 52 },
  scoreDate: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: Colors.textTertiary, marginTop: 4 },
  scoreRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  scoreRingInner: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  scoreRingNum: { fontFamily: Fonts.extrabold, fontSize: FontSizes['2xl'] },
  scoreRingLabel: { fontFamily: Fonts.bold, fontSize: FontSizes.xs, textTransform: 'uppercase', letterSpacing: 0.3 },

  statsStrip: { flexDirection: 'row', marginHorizontal: Spacing['2xl'], backgroundColor: Colors.surface, borderRadius: Radius.xl, marginBottom: Spacing.lg },
  statGroup: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.lg, gap: 3 },
  statNum: { fontFamily: Fonts.extrabold, fontSize: FontSizes['2xl'] },
  statLabel: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.border },

  personalAlert: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing['2xl'], backgroundColor: Colors.personalLight, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.md },
  personalAlertIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: `${Colors.personal}20`, alignItems: 'center', justifyContent: 'center' },
  personalAlertText: { flex: 1 },
  personalAlertTitle: { fontFamily: Fonts.semibold, fontSize: FontSizes.sm, color: Colors.personal },
  personalAlertSub: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: `${Colors.personal}80`, marginTop: 2 },

  banAlert: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing['2xl'], backgroundColor: Colors.dangerLight, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.xl },
  banAlertText: { fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: Colors.danger, flex: 1 },

  processingAlert: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginHorizontal: Spacing['2xl'], backgroundColor: Colors.primaryLight, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.md },
  processingAlertText: { fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: Colors.primary, flex: 1 },
  skeletonLine: { height: 14, backgroundColor: Colors.border, borderRadius: 4 },

  section: { paddingHorizontal: Spacing['2xl'] },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: FontSizes.xl, color: Colors.textPrimary, marginBottom: Spacing.lg },

  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, marginBottom: Spacing.md, gap: Spacing.md },
  cardFlagged: { borderWidth: 1, borderColor: `${Colors.personal}30`, backgroundColor: `${Colors.personal}05` },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardLeft: { flex: 1, gap: 3 },
  cardName: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.textPrimary },
  cardCategory: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: Colors.textTertiary },
  safetyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  safetyBadgeText: { fontFamily: Fonts.bold, fontSize: FontSizes.xs },
  cardDesc: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textSecondary, lineHeight: 20 },

  personalFlagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.personalLight, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  personalFlagText: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.personal, flex: 1 },

  concernRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  concernText: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: Colors.caution, flex: 1 },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  viewDetails: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs, color: Colors.primary },
  cardFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannedChip: { backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  bannedChipText: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.danger },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing['2xl'] },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.xl },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xl },
  modalTitle: { fontFamily: Fonts.bold, fontSize: FontSizes['2xl'], color: Colors.textPrimary },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  modalLabel: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  modalInput: { backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.xl, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textPrimary, marginBottom: Spacing.xl },
  modalErrorText: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.danger, marginBottom: Spacing.lg, marginTop: -Spacing.sm },
  modalBtn: { borderRadius: Radius.xl, overflow: 'hidden' },
  modalBtnGradient: { paddingVertical: Spacing.xl, alignItems: 'center' },
  modalBtnText: { fontFamily: Fonts.bold, fontSize: FontSizes.lg, color: '#fff' },
})