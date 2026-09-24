import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/app/store/authStore'
import { toast } from '@/app/store/toastStore'
import { authApi } from '@/services/api'
import type { ProfileUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

export function useUpdateProfile() {
  const updateUser = useAuthStore((state) => state.updateUser)

  const mutation = useMutation({
    mutationFn: (input: ProfileUpdateInput) => authApi.updateMe(input),
    onSuccess: (me) => {
      const { permissions, ...user } = me
      updateUser({ user, permissions })
      toast.success('Perfil actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el perfil', getDisplayErrorMessage(error)),
  })

  return { updateProfile: mutation.mutateAsync, isUpdatingProfile: mutation.isPending }
}

export function useChangePassword() {
  const mutation = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => authApi.changePassword(input),
    onSuccess: () => toast.success('Contraseña actualizada'),
    onError: (error) => toast.error('No se pudo cambiar la contraseña', getDisplayErrorMessage(error)),
  })

  return { changePassword: mutation.mutateAsync, isChangingPassword: mutation.isPending }
}
