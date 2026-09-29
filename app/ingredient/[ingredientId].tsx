import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Platform
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts, FontSizes, Spacing, Radius, Shadows } from '@/constants/theme'
import { fetchCountryRules } from '@/lib/countryRules'
import { LinearGradient } from 'expo-linear-gradient'
import {
  ArrowLeft, CheckCircle, Warning, ShieldWarning,
  Question, Globe, Tag, BookOpen, Info
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
  country_raw_status?: Record<string, string>
}

const COUNTRIES: Record<string, { flag: string; label: string }> = {
  US:        { flag: '🇺🇸', label: 'United States' },
  EU:        { flag: '🇪🇺', label: 'European Union' },
  UK:        { flag: '🇬🇧', label: 'United Kingdom' },
  India:     { flag: '🇮🇳', label: 'India' },
  Australia: { flag: '🇦🇺', label: 'Australia' },
  Canada:    { flag: '🇨🇦', label: 'Canada' },
  Japan:     { flag: '🇯🇵', label: 'Japan' },
  China:     { flag: '🇨🇳', label: 'China' },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  permitted:             { label: 'Permitted',    color: Colors.safe,          bg: Colors.safeLight },
  permitted_with_limits: { label: 'Limited use',  color: Colors.caution,       bg: Colors.cautionLight },
  banned:                { label: 'Banned',       color: Colors.harmful,       bg: Colors.harmfulLight },
  under_review:          { label: 'Under review', color: Colors.personal,      bg: Colors.personalLight },
  no_data:               { label: 'No data',      color: Colors.textTertiary,  bg: Colors.surfaceSecondary },
  other:                 { label: 'Source-specific', color: Colors.caution, bg: Colors.cautionLight },
}

const SAFETY_CONFIG: Record<string, {
  label: string; color: string; bg: string
  gradientColors: [string, string]; icon: any; desc: string
}> = {
  safe: {
    label: 'Safe', color: Colors.safe, bg: Colors.safeLight,
    gradientColors: [Colors.safe, Colors.primaryDark],
    icon: CheckCircle,
    desc: 'Generally recognised as safe by major health authorities.',
  },
  caution: {
    label: 'Caution', color: Colors.caution, bg: Colors.cautionLight,
    gradientColors: ['#F59E0B', '#D97706'],
    icon: Warning,
    desc: 'May cause issues for some people. Use in moderation.',
  },
  harmful: {
    label: 'Harmful', color: Colors.harmful, bg: Colors.harmfulLight,
    gradientColors: [Colors.harmful, '#DC2626'],
    icon: ShieldWarning,
    desc: 'Linked to health concerns. Avoid where possible.',
  },
  unknown: {
    label: 'Unknown', color: Colors.unknown, bg: Colors.unknownLight,
    gradientColors: [Colors.textTertiary, Colors.textSecondary],
    icon: Question,
    desc: 'Insufficient data to determine safety level.',
  },
}

export default function IngredientDetailScreen() {
  const { ingredientId } = useLocalSearchParams<{ ingredientId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [ingredient, setIngredient] = useState<Ingredient | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchIngredient() {
      try {
        const [ingredientResult, countryRules] = await Promise.all([
          supabase
            .from('ingredients')
            .select('id, name, aliases, category, description, safety_level, health_concerns')
            .eq('id', ingredientId)
            .single(),
          fetchCountryRules([ingredientId]),
        ])

        if (ingredientResult.error) throw ingredientResult.error

        const rules = countryRules.get(ingredientId)

        if (!cancelled) {
          setIngredient({
            ...ingredientResult.data,
            country_status: rules?.status || {},
            country_raw_status: rules?.rawStatus || {},
          })
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e.message || 'Could not load ingredient details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchIngredient()
    return () => { cancelled = true }
  }, [ingredientId])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    )
  }

  if (errorMsg || !ingredient) {
    return (
      <View style={[styles.centered, { gap: 16 }]}>
        <StatusBar style="dark" />
        <Warning size={40} color={Colors.danger} weight="fill" />
        <Text style={styles.errorText}>{errorMsg || 'Ingredient not found'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.errorBtn}>
          <Text style={styles.errorBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const safety = SAFETY_CONFIG[ingredient.safety_level] || SAFETY_CONFIG.unknown
  const SafetyIcon = safety.icon
  const bannedIn = Object.entries(ingredient.country_status || {}).filter(([, v]) => v === 'banned')
  const restrictedIn = Object.entries(ingredient.country_status || {}).filter(([, v]) => v === 'permitted_with_limits')

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, Shadows.sm]}>
            <ArrowLeft size={22} color={Colors.textPrimary} weight="bold" />
          </TouchableOpacity>
          <View style={[styles.categoryChip, { backgroundColor: Colors.primaryLight }]}>
            <Tag size={12} color={Colors.primary} weight="fill" />
            <Text style={styles.categoryChipText}>{ingredient.category}</Text>
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.ingredientName}>
            {ingredient.name.charAt(0).toUpperCase() + ingredient.name.slice(1)}
          </Text>
          {ingredient.aliases?.length > 0 && (
            <Text style={styles.aliases}>
              Also known as: {ingredient.aliases.slice(0, 4).join(', ')}
            </Text>
          )}
        </View>

        {/* Safety card */}
        <View style={styles.safetyCardWrapper}>
          <LinearGradient
            colors={safety.gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.safetyCard}
          >
            <View style={styles.safetyCardLeft}>
              <View style={styles.safetyIconBox}>
                <SafetyIcon size={28} color="#fff" weight="fill" />
              </View>
              <View style={styles.safetyTextBox}>
                <Text style={styles.safetyLabel}>{safety.label}</Text>
                <Text style={styles.safetyDesc}>{safety.desc}</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* Quick stats — banned/restricted count */}
        {(bannedIn.length > 0 || restrictedIn.length > 0) && (
          <View style={[styles.quickStats, Shadows.sm]}>
            {bannedIn.length > 0 && (
              <View style={styles.quickStatItem}>
                <Text style={[styles.quickStatNum, { color: Colors.harmful }]}>{bannedIn.length}</Text>
                <Text style={styles.quickStatLabel}>
                  {bannedIn.length === 1 ? 'Country' : 'Countries'} banned
                </Text>
              </View>
            )}
            {bannedIn.length > 0 && restrictedIn.length > 0 && (
              <View style={styles.quickStatDivider} />
            )}
            {restrictedIn.length > 0 && (
              <View style={styles.quickStatItem}>
                <Text style={[styles.quickStatNum, { color: Colors.caution }]}>{restrictedIn.length}</Text>
                <Text style={styles.quickStatLabel}>
                  {restrictedIn.length === 1 ? 'Country' : 'Countries'} restricted
                </Text>
              </View>
            )}
          </View>
        )}

        {/* About */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <BookOpen size={16} color={Colors.primary} weight="fill" />
            <Text style={styles.sectionTitle}>About</Text>
          </View>
          <View style={[styles.sectionCard, Shadows.sm]}>
            <Text style={styles.description}>{ingredient.description}</Text>
          </View>
        </View>

        {/* Health concerns */}
        {ingredient.health_concerns?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Warning size={16} color={Colors.caution} weight="fill" />
              <Text style={styles.sectionTitle}>Health concerns</Text>
            </View>
            <View style={[styles.sectionCard, Shadows.sm]}>
              {ingredient.health_concerns.map((concern, i) => (
                <View key={i} style={[styles.concernRow, i > 0 && styles.concernBorder]}>
                  <View style={[styles.concernDot, { backgroundColor: Colors.caution }]} />
                  <Text style={styles.concernText}>{concern}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Country status */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Globe size={16} color={Colors.info} weight="fill" />
            <Text style={styles.sectionTitle}>Regulatory status</Text>
          </View>
          <View style={[styles.sectionCard, Shadows.sm]}>
            {Object.entries(COUNTRIES).map(([code, { flag, label }], i) => {
              const status = ingredient.country_status?.[code] || 'no_data'
              const rawStatus = ingredient.country_raw_status?.[code]
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.no_data
              const statusLabel = status === 'other' && rawStatus ? rawStatus : config.label
              return (
                <View key={code}>
                  {i > 0 && <View style={styles.countryDivider} />}
                  <View style={styles.countryRow}>
                    <Text style={styles.countryFlag}>{flag}</Text>
                    <Text style={styles.countryLabel}>{label}</Text>
                    <View style={[styles.statusChip, { backgroundColor: config.bg }]}>
                      <Text style={[styles.statusChipText, { color: config.color }]}>
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* Aliases */}
        {ingredient.aliases?.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Info size={16} color={Colors.textTertiary} weight="fill" />
              <Text style={styles.sectionTitle}>All names & codes</Text>
            </View>
            <View style={styles.aliasGrid}>
              {ingredient.aliases.map((alias, i) => (
                <View key={i} style={[styles.aliasChip, Shadows.sm]}>
                  <Text style={styles.aliasChipText}>{alias}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.disclaimer}>
          Information provided for educational purposes only. Not medical advice.
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.danger, textAlign: 'center', paddingHorizontal: 32 },
  errorBtn: { backgroundColor: Colors.primaryLight, borderRadius: Radius.xl, paddingHorizontal: 24, paddingVertical: 12, marginTop: Spacing.md },
  errorBtnText: { fontFamily: Fonts.semibold, fontSize: FontSizes.base, color: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 80 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 0, paddingHorizontal: Spacing['2xl'], marginBottom: Spacing.xl,
  },
  backBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full },
  categoryChipText: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.4 },

  titleSection: { paddingHorizontal: Spacing['2xl'], marginBottom: Spacing.xl, gap: 8 },
  ingredientName: { fontFamily: Fonts.extrabold, fontSize: FontSizes['5xl'], color: Colors.textPrimary, letterSpacing: -0.5, lineHeight: 40 },
  aliases: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textTertiary, lineHeight: 20 },

  safetyCardWrapper: { marginHorizontal: Spacing['2xl'], marginBottom: Spacing.lg, borderRadius: Radius['2xl'], overflow: 'hidden', ...Shadows.lg },
  safetyCard: { borderRadius: Radius['2xl'], padding: Spacing['2xl'] },
  safetyCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  safetyIconBox: { width: 60, height: 60, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  safetyTextBox: { flex: 1, gap: 6 },
  safetyLabel: { fontFamily: Fonts.extrabold, fontSize: FontSizes['2xl'], color: '#fff' },
  safetyDesc: { fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },

  quickStats: { flexDirection: 'row', marginHorizontal: Spacing['2xl'], backgroundColor: Colors.surface, borderRadius: Radius.xl, paddingVertical: Spacing.xl, marginBottom: Spacing.xl },
  quickStatItem: { flex: 1, alignItems: 'center', gap: 4 },
  quickStatNum: { fontFamily: Fonts.extrabold, fontSize: FontSizes['4xl'] },
  quickStatLabel: { fontFamily: Fonts.medium, fontSize: FontSizes.xs, color: Colors.textTertiary, textAlign: 'center', lineHeight: 16 },
  quickStatDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },

  section: { paddingHorizontal: Spacing['2xl'], marginBottom: Spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Spacing.md },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: FontSizes.lg, color: Colors.textPrimary },
  sectionCard: { backgroundColor: Colors.surface, borderRadius: Radius.xl, overflow: 'hidden' },
  description: { fontFamily: Fonts.regular, fontSize: FontSizes.base, color: Colors.textSecondary, lineHeight: 26, padding: Spacing.xl },

  concernRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  concernBorder: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  concernDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  concernText: { flex: 1, fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textSecondary, lineHeight: 22 },

  countryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: 12 },
  countryDivider: { height: 1, backgroundColor: Colors.borderSubtle, marginLeft: 54 },
  countryFlag: { fontSize: 22, width: 30 },
  countryLabel: { flex: 1, fontFamily: Fonts.regular, fontSize: FontSizes.sm, color: Colors.textPrimary },
  statusChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.md },
  statusChipText: { fontFamily: Fonts.semibold, fontSize: FontSizes.xs },

  aliasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  aliasChip: { backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.lg },
  aliasChipText: { fontFamily: Fonts.medium, fontSize: FontSizes.sm, color: Colors.textSecondary },

  disclaimer: { fontFamily: Fonts.regular, fontSize: FontSizes.xs, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: Spacing['2xl'], lineHeight: 18, marginBottom: 8 },
})
