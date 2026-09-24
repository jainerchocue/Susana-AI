import { httpClient, requestData } from './apiClient'
import type { BetterAuthSignInResult, LoginCredentials, MeResult, ProfileUpdateInput } from '@/types'

export const authApi = {
  /** Better Auth (core/auth/auth.ts) — no usa el envelope {success,data,meta} del resto de la API. */
  signIn: async (credentials: LoginCredentials) => {
    const response = await httpClient.post<BetterAuthSignInResult>('/auth/sign-in/email', credentials)
    return response.data
  },

  signOut: async () => {
    await httpClient.post('/auth/sign-out')
  },

  /** GET /users/me — sesión + roles + permisos, ya en nuestro envelope. */
  me: () => requestData<MeResult>({ method: 'GET', url: '/users/me' }),

  /** PATCH /users/me — schema propio (sin `status`, evita mass assignment); devuelve el mismo shape que GET. */
  updateMe: (input: ProfileUpdateInput) => requestData<MeResult>({ method: 'PATCH', url: '/users/me', data: input }),

  /** POST /auth/change-password — Better Auth, no usa el envelope {success,data,meta}. */
  changePassword: async (input: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) => {
    await httpClient.post('/auth/change-password', input)
  },
}
