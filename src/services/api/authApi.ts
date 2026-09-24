import { httpClient, requestData } from './apiClient'
import type { BetterAuthSignInResult, LoginCredentials, MeResult } from '@/types'

export const authApi = {
  /** Better Auth (core/auth/auth.ts) — no usa el envelope {success,data,meta} del resto de la API. */
  signIn: async (credentials: LoginCredentials) => {
    const response = await httpClient.post<BetterAuthSignInResult>('/auth/sign-in/email', credentials)
    console.log(response.data)
    return response.data
  },

  signOut: async () => {
    await httpClient.post('/auth/sign-out')
  },

  /** GET /users/me — sesión + roles + permisos, ya en nuestro envelope. */
  me: () => requestData<MeResult>({ method: 'GET', url: '/users/me' }),
}
