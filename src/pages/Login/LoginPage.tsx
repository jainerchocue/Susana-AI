import { useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { loginSchema, type LoginFormValues } from '@/schemas/auth.schema'
import { IconEye, IconEyeOff, IconMail, IconLock } from '@/components/ui/icons'
import { getDisplayErrorMessage } from '@/utils/errors'
import hospitalLogoWhite from '@/assets/branding/hospital-logo-white.png'
import hospitalStaff from '@/assets/branding/hospital-staff.jpg'

/**
 * Paleta oficial (Manual de Identidad Visual HSLV 2026)
 *  Lima   #76B82A  (Pantone 368 C)
 *  Bosque #327531  (Pantone 364 C)
 *  Añil   #29235C  (Pantone 2758 C)
 *  Blanco #FFFFFF
 */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&display=swap');
.hslv-display{font-family:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;letter-spacing:-0.025em}

@keyframes hslv-bloom{from{transform:scale(.15);opacity:0}to{transform:scale(1);opacity:1}}
.hslv-petal{transform-box:fill-box;transform-origin:50% 100%;animation:hslv-bloom 1.5s cubic-bezier(.2,.8,.2,1) both}

@keyframes hslv-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.hslv-ecg{stroke-dasharray:1;stroke-dashoffset:0;animation:hslv-draw 2.2s 1s ease-out both}
@keyframes hslv-beat{0%{stroke-dashoffset:1}70%,100%{stroke-dashoffset:0}}
.hslv-ecg-busy{animation:hslv-beat 1.3s linear infinite}

@keyframes hslv-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.hslv-in{animation:hslv-in .8s cubic-bezier(.2,.7,.2,1) both}

@keyframes hslv-spin{to{transform:rotate(360deg)}}

@media (prefers-reduced-motion:reduce){
  .hslv-petal,.hslv-ecg,.hslv-ecg-busy,.hslv-in{animation:none!important}
}
`

/** Flor de loto: el símbolo del hospital, abriéndose una sola vez al cargar. */
function Lotus({ className }: { className?: string }) {
  const back = [-72, -36, 0, 36, 72]
  const front = [-54, -18, 18, 54]
  const d = 'M0 0C34 -50 34 -120 0 -180C-34 -120 -34 -50 0 0Z'
  return (
    <svg viewBox="-200 -200 400 210" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="hslv-petal" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#327531" stopOpacity="0.85" />
          <stop offset="1" stopColor="#76B82A" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <g transform="translate(0 0)">
        {back.map((a, i) => (
          <g key={`b${a}`} transform={`rotate(${a})`}>
            <path
              d={d}
              className="hslv-petal"
              style={{ animationDelay: `${i * 110}ms` }}
              fill="url(#hslv-petal)"
              stroke="rgba(255,255,255,.22)"
              strokeWidth="1"
            />
          </g>
        ))}
        {front.map((a, i) => (
          <g key={`f${a}`} transform={`rotate(${a}) scale(.72)`}>
            <path
              d={d}
              className="hslv-petal"
              style={{ animationDelay: `${450 + i * 110}ms` }}
              fill="url(#hslv-petal)"
              stroke="rgba(255,255,255,.3)"
              strokeWidth="1.2"
            />
          </g>
        ))}
      </g>
    </svg>
  )
}

type FieldProps = {
  id: string
  label: string
  type?: string
  autoComplete?: string
  icon: ReactNode
  error?: string
  end?: ReactNode
  registration: UseFormRegisterReturn
}

/** Campo con etiqueta flotante. Recibe el `register()` de react-hook-form. */
function Field({ id, label, type = 'text', autoComplete, icon, error, end, registration }: FieldProps) {
  return (
    <div>
      <div className="group relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#29235C]/40 transition-colors group-focus-within:text-[#327531]">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          placeholder=" "
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="peer h-14 w-full rounded-xl border border-[#29235C]/15 bg-[#29235C]/[0.03] pb-0 pl-11 pr-12 pt-4 text-[15px] text-[#29235C] outline-none transition placeholder:text-transparent focus:border-[#327531] focus:bg-white focus:ring-4 focus:ring-[#76B82A]/25 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/15"
          {...registration}
        />
        <label
          htmlFor={id}
          className="pointer-events-none absolute left-11 top-1/2 -translate-y-1/2 text-sm text-[#29235C]/55 transition-all duration-200 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:font-medium peer-focus:text-[#327531] peer-[:not(:placeholder-shown)]:top-3 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px]"
        >
          {label}
        </label>
        {end && <div className="absolute right-2 top-1/2 -translate-y-1/2">{end}</div>}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 pl-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

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
    <div className="relative isolate min-h-screen overflow-hidden bg-[#29235C] px-4 py-8 sm:px-8">
      <style>{css}</style>

      {/* Atmósfera: dos luces de marca y la flor de loto bajo todo el contenido */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-[#76B82A]/20 blur-3xl" />
        <div className="absolute -bottom-52 -right-40 h-[34rem] w-[34rem] rounded-full bg-[#327531]/40 blur-3xl" />
        <Lotus className="absolute -bottom-6 left-1/2 w-[44rem] max-w-none -translate-x-1/2 opacity-70 sm:w-[60rem]" />
      </div>

      <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        {/* Foto en forma de pétalo */}
        <figure
          className="hslv-in relative h-64 overflow-hidden rounded-bl-2xl rounded-br-[4.5rem] rounded-tl-[4.5rem] rounded-tr-2xl shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)] ring-1 ring-white/15 sm:h-80 lg:h-[34rem]"
          style={{ animationDelay: '350ms' }}
        >
          <img
            src={hospitalStaff}
            alt="Equipo del Hospital Susana López de Valencia frente a la sede UMI Pediatría"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#29235C] via-[#29235C]/35 to-[#29235C]/25" />
          <div className="absolute inset-0 bg-[#327531]/10 mix-blend-multiply" />

          <img
            src={hospitalLogoWhite}
            alt="Hospital Susana López de Valencia"
            className="absolute left-6 top-6 h-8 w-auto sm:left-9 sm:top-9 sm:h-10"
          />

          <figcaption className="absolute inset-x-0 bottom-0 p-6 sm:p-9">
            <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="mb-4 h-10 w-full" aria-hidden="true">
              <path
                d="M0 30H118L134 30L146 8L162 52L174 16L184 30H400"
                pathLength={1}
                fill="none"
                stroke="#76B82A"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className={`hslv-ecg ${isLoggingIn ? 'hslv-ecg-busy' : ''}`}
                style={{ filter: 'drop-shadow(0 0 6px rgba(118,184,42,.9))' }}
              />
            </svg>
            <p className="hslv-display max-w-sm text-2xl font-semibold leading-tight text-white sm:text-3xl">
              Cuidar empieza por quienes cuidan.
            </p>
          </figcaption>
        </figure>

        {/* Formulario */}
        <section className="hslv-in relative" style={{ animationDelay: '550ms' }}>
          <form
            onSubmit={onSubmit}
            noValidate
            className="relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-white p-7 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.65)] sm:p-9"
          >
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#327531] via-[#76B82A] to-[#327531]" />

            <div className="mb-2">
              <h1 className="hslv-display text-3xl font-semibold text-[#29235C]">Iniciar sesión</h1>
              <p className="mt-1.5 text-sm text-[#29235C]/60">Usa tu correo institucional para entrar.</p>
            </div>

            <Field
              id="email"
              label="Correo electrónico"
              type="email"
              autoComplete="username"
              icon={<IconMail className="h-4 w-4" />}
              error={errors.email?.message}
              registration={register('email')}
            />

            <Field
              id="password"
              label="Contraseña"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              icon={<IconLock className="h-4 w-4" />}
              error={errors.password?.message}
              registration={register('password')}
              end={
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="rounded-lg p-2 text-[#29235C]/40 transition hover:text-[#327531] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B82A]"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
                </button>
              }
            />

            {loginError && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {getDisplayErrorMessage(loginError)}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="group relative mt-2 flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-[#29235C] text-[15px] font-semibold text-white transition hover:shadow-[0_16px_34px_-12px_rgba(41,35,92,0.85)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#76B82A]/45 disabled:cursor-not-allowed disabled:opacity-80"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-[#327531] to-[#4a9a2b] transition-transform duration-500 ease-out group-hover:translate-x-0 group-focus-visible:translate-x-0" />
              {isLoggingIn && (
                <svg
                  className="relative h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ animation: 'hslv-spin .8s linear infinite' }}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="#76B82A" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              <span className="relative">{isLoggingIn ? 'Verificando…' : 'Ingresar'}</span>
            </button>

            <p className="mt-2 flex items-center justify-center gap-2 text-xs text-[#29235C]/50">
              <IconLock className="h-3.5 w-3.5" />
              Acceso restringido a personal autorizado
            </p>
          </form>
        </section>
      </main>
    </div>
  )
}