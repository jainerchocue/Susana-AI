import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { loginSchema, type LoginFormValues } from '@/schemas/auth.schema'
import { Button, Input } from '@/components/ui'
import { IconEye, IconEyeOff, IconSparkles } from '@/components/ui/icons'
import { getDisplayErrorMessage } from '@/utils/errors'

export default function LoginPage() {
  const { login, isLoggingIn, loginError } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values)
    } catch {
      // surfaced via loginError below
    }
  })

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 px-4">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="aurora-layer absolute -left-32 top-[-10%] h-128 w-lg rounded-full bg-brand-500/30 blur-3xl" />
        <div
          className="aurora-layer absolute -right-24 bottom-[-15%] h-112 w-md rounded-full bg-accent-400/15 blur-3xl"
          style={{ animationDelay: '-8s' }}
        />
        <div
          className="aurora-layer absolute left-1/3 top-1/4 h-64 w-64 rounded-full bg-brand-300/10 blur-3xl"
          style={{ animationDelay: '-14s' }}
        />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-brand-500 to-accent-500 shadow-glow-brand">
            <IconSparkles className="h-6 w-6 text-white" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">Hospital Intelligence</h1>
            <p className="text-sm text-ink-300">Centro de Inteligencia Operativa Hospitalaria</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="animate-fade-up flex flex-col gap-4 rounded-2xl border border-white/10 bg-white p-6 shadow-floating"
        >
          <Input
            label="Correo electrónico"
            type="email"
            autoComplete="username"
            placeholder="usuario@hospital.gov.co"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Contraseña"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            error={errors.password?.message}
            endAdornment={
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="rounded-md p-1.5 text-ink-300 hover:text-ink-700"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                tabIndex={-1}
              >
                {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            }
            {...register('password')}
          />

          {loginError && (
            <p role="alert" className="animate-fade-in text-sm text-status-critical">
              {getDisplayErrorMessage(loginError)}
            </p>
          )}

          <Button type="submit" isLoading={isLoggingIn} className="mt-2 w-full">
            Ingresar
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-300">
          Hospital Susana López de Valencia · Acceso restringido a personal autorizado
        </p>
      </div>
    </div>
  )
}
