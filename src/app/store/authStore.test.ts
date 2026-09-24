import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './authStore'

const TOKEN_KEY = 'hospital_intelligence.access_token'

const baseUser = {
  id: 'u1',
  name: 'Ana Directora',
  email: 'ana@hospital.gov.co',
  image: null,
  status: 'ACTIVE' as const,
  emailVerified: true,
  twoFactorEnabled: false,
  roles: ['DIRECTOR'],
  createdAt: new Date(0).toISOString(),
}

beforeEach(() => {
  useAuthStore.getState().clearSession()
})

describe('authStore', () => {
  it('starts with no session', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.status).not.toBe('authenticated')
  })

  it('exposes permissions and role after setSession', () => {
    useAuthStore.getState().setSession({
      user: baseUser,
      permissions: ['dashboard:read', 'analytics:read'],
      accessToken: 'test-token',
    })

    const state = useAuthStore.getState()
    expect(state.status).toBe('authenticated')
    expect(state.hasPermission('dashboard:read')).toBe(true)
    expect(state.hasPermission('users:manage')).toBe(false)
    expect(state.hasRole('DIRECTOR', 'ADMIN')).toBe(true)
    expect(state.hasRole('FARMACIA')).toBe(false)
  })

  it('clears everything on clearSession', () => {
    useAuthStore.getState().setSession({
      user: baseUser,
      permissions: ['dashboard:read'],
      accessToken: 'test-token',
    })
    useAuthStore.getState().clearSession()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.status).toBe('unauthenticated')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('persists the token in sessionStorage on setSession', () => {
    useAuthStore.getState().setSession({
      user: baseUser,
      permissions: ['dashboard:read'],
      accessToken: 'test-token',
    })

    expect(useAuthStore.getState().accessToken).toBe('test-token')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('test-token')
  })

  it('persists the token before user/permissions are available', () => {
    useAuthStore.getState().setAccessToken('early-token')

    expect(useAuthStore.getState().accessToken).toBe('early-token')
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('early-token')
  })
})
