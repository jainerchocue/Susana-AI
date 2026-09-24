const STORAGE_KEY = 'hospital_intelligence.access_token'

export function getStoredAccessToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeAccessToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {
    // storage no disponible (SSR, modo privado bloqueado) — la sesión queda solo en memoria.
  }
}

export function clearStoredAccessToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // sin acción posible
  }
}