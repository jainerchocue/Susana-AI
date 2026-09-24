import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants'

export default function NotFoundPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface-0 px-4 text-center">
      <p className="text-4xl font-bold text-ink-300">404</p>
      <h1 className="text-lg font-semibold text-ink-950">Página no encontrada</h1>
      <p className="max-w-sm text-sm text-ink-500">La página que busca no existe o fue movida.</p>
      <Link
        to={ROUTES.DASHBOARD}
        className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
      >
        Volver al inicio
      </Link>
    </div>
  )
}
