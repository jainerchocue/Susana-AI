import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { authApi } from '@/services/api'

/**
 * Al recargar la página el token en memoria se pierde, pero el bearer
 * persistido en sessionStorage (ver tokenStorage.ts) se hidrata en el store
 * al arrancar, así que el interceptor vuelve a adjuntar Authorization y
 * /users/me restaurará la sesión. En un despliegue same-site la cookie
 * httpOnly de Better Auth basta para responder sin bearer; en un cross-origin
 * como este dev/tunnel el token guardado es lo que mantiene la sesión viva.
 */
export function useSessionBootstrap() {
  const status = useAuthStore((state) => state.status)
  const setStatus = useAuthStore((state) => state.setStatus)
  const setSession = useAuthStore((state) => state.setSession)
  const clearSession = useAuthStore((state) => state.clearSession)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    // Ya hay una sesión en memoria (p. ej. justo tras iniciar sesión) — no repetir la llamada.
    if (useAuthStore.getState().status === 'authenticated') return

    // Sin bandera "cancelled": las acciones de zustand son seguras de llamar
    // aunque el componente ya no esté montado, y combinar ese patrón con el
    // guard de ranRef bajo StrictMode (que duplica el efecto en dev) dejaba
    // el estado colgado en 'authenticating' para siempre — la limpieza del
    // primer disparo marcaba cancelled=true antes de que la petición real
    // terminara, y el guard de ranRef impedía que el segundo disparo lo arreglara.
    setStatus('authenticating')
    authApi.me().then(
      (me) => {
        const { permissions, ...user } = me
        // Si la sesión vino por cookie (same-site) el token es null y no se toca el almacenamiento.
        setSession({ user, permissions, accessToken: useAuthStore.getState().accessToken })
      },
      () => {
        clearSession()
      },
    )
  }, [setStatus, setSession, clearSession])

  return { isBootstrapping: status === 'idle' || status === 'authenticating' }
}
