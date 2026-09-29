import React, { useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, TextInput, ActivityIndicator,
  Image
} from 'react-native'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { signOutGoogle, revokeGoogleAccess } from '@/lib/auth'
import { useAuthStore } from '@/store'
import { Colors, Fonts, FontSizes, Spacing, Radius, Shadows } from '@/constants/theme'
import { DietaryPreferencesModal } from '@/components/DietaryPreferencesModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import {
  User, PencilSimple, Lock, SignOut, Trash,
  ShieldCheck, FileText, Info, CaretRight,
  CheckCircle, X, Eye, EyeSlash
} from 'phosphor-react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Constants from 'expo-constants'

export default function SettingsScreen() {
  const router = useRouter()
  const { user, setUser } = useAuthStore()
  const insets = useSafeAreaInsets()

  const mounted = React.useRef(true)
  React.useEffect(() => {
    return () => { mounted.current = false }
  }, [])

  const [showDietaryModal, setShowDietaryModal] = useState(false)

  // Edit name
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(
    user?.user_metadata?.full_name || ''
  )
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameSuccess, setNameSuccess] = useState(false)

  // Change password
  const [editingPassword, setEditingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  const displayName = user?.user_metadata?.full_name || user?.email || 'User'
  const email = user?.email || ''
  const initial = displayName.charAt(0).toUpperCase()
  const appVersion = Constants.expoConfig?.version || '1.0.0'

  async function handleSaveName() {
    setNameError('')
    if (!nameValue.trim()) {
      setNameError('Name cannot be empty.')
      return
    }
    setNameSaving(true)
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { full_name: nameValue.trim() },
      })
      if (error) {
        setNameError(error.message)
      } else {
        if (data?.user) setUser(data.user)
        setNameSuccess(true)
        setEditingName(false)
        setTimeout(() => { if (mounted.current) setNameSuccess(false) }, 3000)
      }
    } catch (e: any) {
      setNameError(e.message || 'Failed to update name.')
    } finally {
      setNameSaving(false)
    }
  }

  async function handleChangePassword() {
    setPasswordError('')
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.')
      return
    }
    setPasswordSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setPasswordError(error.message)
      } else {
        setPasswordSuccess(true)
        setNewPassword('')
        setEditingPassword(false)
        setTimeout(() => { if (mounted.current) setPasswordSuccess(false) }, 3000)
      }
    } catch (e: any) {
      setPasswordError(e.message || 'Failed to change password.')
    } finally {
      setPasswordSaving(false)
    }
  }

  async function handleSignOut() {
    try {
      await signOutGoogle()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setUser(null)
      router.replace('/(auth)/welcome')
    } catch (e: any) {
      setSignOutError(e.message || 'Could not sign out. Please try again.')
    }
  }

  function confirmDeleteAccount() {
    setDeleteError('')
    setShowDeleteConfirm(true)
  }

  async function deleteAccount() {
    if (!user?.id) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account')
      if (error) throw error
      if (!data?.success) {
        throw new Error(data?.error || 'Could not delete account. Please try again.')
      }
      await revokeGoogleAccess()
      await supabase.auth.signOut()
      setUser(null)
      router.replace('/(auth)/welcome')
    } catch (e: any) {
      setDeleteError(e.message || 'Could not delete account. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* Avatar card */}
        <View style={[styles.profileCard, Shadows.md]}>
          <LinearGradient
            colors={[Colors.primary, Colors.primaryDark]}
            style={styles.avatar}
          >
            <Text style={styles.avatarInitial}>{initial}</Text>
          </LinearGradient>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text>
          </View>
          <View style={[styles.profileBadge]}>
            <Image source={require('@/assets/icon.png')} style={styles.profileBadgeIcon} />
            <Text style={styles.profileBadgeText}>Free</Text>
          </View>
        </View>

        {/* Success banners */}
        {nameSuccess && (
          <View style={styles.successBanner}>
            <CheckCircle size={16} color={Colors.success} weight="fill" />
            <Text style={styles.successText}>Name updated successfully</Text>
          </View>
        )}
        {passwordSuccess && (
          <View style={styles.successBanner}>
            <CheckCircle size={16} color={Colors.success} weight="fill" />
            <Text style={styles.successText}>Password changed successfully</Text>
          </View>
        )}
        {deleteError ? (
          <View style={styles.deleteErrorBanner}>
            <Trash size={16} color={Colors.danger} weight="fill" />
            <Text style={styles.deleteErrorText}>{deleteError}</Text>
          </View>
        ) : null}
        {signOutError ? (
          <View style={styles.deleteErrorBanner}>
            <SignOut size={16} color={Colors.danger} weight="fill" />
            <Text style={styles.deleteErrorText}>{signOutError}</Text>
          </View>
        ) : null}

        {/* ─── Account section ─── */}
        <SectionHeader title="Account" />

        {/* Edit name */}
        <View style={[styles.settingCard, Shadows.sm]}>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: Colors.infoLight }]}>
              <User size={18} color={Colors.info} weight="fill" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingLabel}>Display name</Text>
              {editingName ? (
                <TextInput
                  style={styles.settingInput}
                  value={nameValue}
                  onChangeText={t => { setNameValue(t); setNameError('') }}
                  autoFocus
                  placeholder="Your name"
                  placeholderTextColor={Colors.textTertiary}
                />
              ) : (
                <Text style={styles.settingValue}>{displayName}</Text>
              )}
              {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
            </View>
            {editingName ? (
              <View style={styles.editActions}>
                <TouchableOpacity
                  onPress={() => { setEditingName(false); setNameError('') }}
                  style={styles.cancelIconBtn}
                >
                  <X size={14} color={Colors.textTertiary} weight="bold" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveName}
                  disabled={nameSaving}
                >
                  {nameSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setEditingName(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <PencilSimple size={18} color={Colors.textTertiary} weight="regular" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Change password */}
        <View style={[styles.settingCard, Shadows.sm]}>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: Colors.warningLight }]}>
              <Lock size={18} color={Colors.warning} weight="fill" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingLabel}>Password</Text>
              {editingPassword ? (
                <View style={styles.passwordRow}>
                  <TextInput
                    style={[styles.settingInput, { flex: 1 }]}
                    value={newPassword}
                    onChangeText={t => { setNewPassword(t); setPasswordError('') }}
                    secureTextEntry={!showPassword}
                    autoFocus
                    placeholder="New password"
                    placeholderTextColor={Colors.textTertiary}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    {showPassword
                      ? <EyeSlash size={16} color={Colors.textTertiary} />
                      : <Eye size={16} color={Colors.textTertiary} />
                    }
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.settingValue}>••••••••</Text>
              )}
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
            </View>
            {editingPassword ? (
              <View style={styles.editActions}>
                <TouchableOpacity
                  onPress={() => { setEditingPassword(false); setPasswordError(''); setNewPassword('') }}
                  style={styles.cancelIconBtn}
                >
                  <X size={14} color={Colors.textTertiary} weight="bold" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleChangePassword}
                  disabled={passwordSaving}
                >
                  {passwordSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.saveBtnText}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setEditingPassword(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <PencilSimple size={18} color={Colors.textTertiary} weight="regular" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ─── Preferences section ─── */}
        <SectionHeader title="Preferences" />

        <SettingRow
          icon={<Image source={require('@/assets/icon.png')} style={styles.settingIconImage} />}
          iconBg="transparent"
          label="Dietary preferences"
          sublabel="Allergies, conditions, diet type"
          onPress={() => setShowDietaryModal(true)}
        />

        {/* ─── Legal section ─── */}
        <SectionHeader title="Legal" />

        <SettingRow
          icon={<ShieldCheck size={18} color={Colors.info} weight="fill" />}
          iconBg={Colors.infoLight}
          label="Privacy policy"
          onPress={() => router.push({ pathname: '/legal/[type]', params: { type: 'privacy' } })}
        />
        <SettingRow
          icon={<FileText size={18} color={Colors.info} weight="fill" />}
          iconBg={Colors.infoLight}
          label="Terms of service"
          onPress={() => router.push({ pathname: '/legal/[type]', params: { type: 'terms' } })}
        />

        {/* ─── About section ─── */}
        <SectionHeader title="About" />

        <View style={[styles.settingCard, Shadows.sm]}>
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: Colors.surfaceSecondary }]}>
              <Info size={18} color={Colors.textSecondary} weight="fill" />
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingLabel}>App version</Text>
              <Text style={styles.settingValue}>v{appVersion}</Text>
            </View>
          </View>
        </View>

        {/* ─── Sign out ─── */}
        <TouchableOpacity
          style={[styles.signOutBtn, Shadows.sm]}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <SignOut size={18} color={Colors.danger} weight="bold" />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* ─── Delete account ─── */}
        <TouchableOpacity
          style={styles.deleteAccountBtn}
          onPress={confirmDeleteAccount}
          disabled={deleting}
        >
          {deleting
            ? <ActivityIndicator size="small" color={Colors.textTertiary} />
            : <Trash size={14} color={Colors.textTertiary} weight="regular" />
          }
          <Text style={styles.deleteAccountText}>
            {deleting ? 'Deleting account…' : 'Delete account'}
          </Text>
        </TouchableOpacity>

      </ScrollView>

      <DietaryPreferencesModal
        visible={showDietaryModal}
        onClose={() => setShowDietaryModal(false)}
      />

      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete account"
        message="This will permanently delete your account and all scan history. This cannot be undone."
        confirmLabel="Delete account"
        destructive
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false)
          deleteAccount()
        }}
      />
    </View>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <Text style={styles.sectionHeader}>{title}</Text>
  )
}

function SettingRow({ icon, iconBg, label, sublabel, onPress }: {
  icon: React.ReactNode
  iconBg: string
  label: string
  sublabel?: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.settingCard, Shadows.sm]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.settingRow}>
        <View style={[styles.settingIcon, { backgroundColor: iconBg }]}>{icon}</View>
        <View style={styles.settingContent}>
          <Text style={styles.settingLabel}>{label}</Text>
          {sublabel && <Text style={styles.settingSubLabel}>{sublabel}</Text>}
        </View>
        <CaretRight size={16} color={Colors.textTertiary} weight="bold" />
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },

  header: {
    paddingTop: 0,
    paddingHorizontal: Spacing['2xl'],
    paddingBottom: Spacing.lg,
  },
  title: {
    fontFamily: Fonts.extrabold,
    fontSize: FontSizes['5xl'],
    color: Colors.textPrimary,
  },

  // Profile card
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius['2xl'],
    marginHorizontal: Spacing['2xl'],
    padding: Spacing.xl,
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes['2xl'],
    color: '#fff',
  },
  profileInfo: { flex: 1 },
  profileName: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.lg,
    color: Colors.textPrimary,
  },
  profileEmail: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  profileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  profileBadgeIcon: { width: 14, height: 14, borderRadius: 4 },
  profileBadgeText: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.xs,
    color: Colors.primary,
  },

  // Success banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing['2xl'],
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  successText: {
    fontFamily: Fonts.medium,
    fontSize: FontSizes.sm,
    color: Colors.success,
  },
  deleteErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dangerLight,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing['2xl'],
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  deleteErrorText: {
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: FontSizes.sm,
    color: Colors.danger,
    lineHeight: 18,
  },

  // Section header
  sectionHeader: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.sm,
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginHorizontal: Spacing['2xl'],
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },

  // Setting cards
  settingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    marginHorizontal: Spacing['2xl'],
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingIconImage: { width: 40, height: 40, borderRadius: Radius.md },
  settingContent: { flex: 1, gap: 2 },
  settingLabel: {
    fontFamily: Fonts.semibold,
    fontSize: FontSizes.base,
    color: Colors.textPrimary,
  },
  settingValue: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.sm,
    color: Colors.textSecondary,
  },
  settingSubLabel: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.xs,
    color: Colors.textTertiary,
  },
  settingInput: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.base,
    color: Colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.primary,
    paddingBottom: 4,
    marginTop: 2,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.full,
    minWidth: 52,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.sm,
    color: '#fff',
  },
  errorText: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.xs,
    color: Colors.danger,
    marginTop: 4,
  },

  // Sign out / delete
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: Spacing['2xl'],
    marginTop: Spacing['2xl'],
    backgroundColor: Colors.dangerLight,
    borderRadius: Radius.xl,
    paddingVertical: Spacing.lg,
  },
  signOutText: {
    fontFamily: Fonts.bold,
    fontSize: FontSizes.base,
    color: Colors.danger,
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  deleteAccountText: {
    fontFamily: Fonts.regular,
    fontSize: FontSizes.sm,
    color: Colors.textTertiary,
    textDecorationLine: 'underline',
  },
})