import { Badge } from '@/components/ui'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { IMPORT_STATUS_LABELS, IMPORT_STATUS_TONE } from '../tableMeta'
import type { ImportJob } from '@/types'

const COUNTER_LABELS = ['Procesados', 'Insertados', 'Duplicados', 'Omitidos', 'Inválidos', 'Avisos'] as const

export function ImportJobDetailView({ job }: { job: ImportJob | null }) {
  const counters = [
    job?.processed ?? 0,
    job?.inserted ?? 0,
    job?.duplicates ?? 0,
    job?.skipped ?? 0,
    job?.invalid ?? 0,
    job?.warnings ?? 0,
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Badge tone={job ? IMPORT_STATUS_TONE[job.status] : 'neutral'} pulse={job?.status === 'RUNNING'}>
          {job ? IMPORT_STATUS_LABELS[job.status] : 'Cargando…'}
        </Badge>
        {job?.fileName && <span className="text-xs text-ink-500">{job.fileName}</span>}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {COUNTER_LABELS.map((label, index) => (
          <div key={label} className="rounded-lg bg-surface-0 px-2 py-2.5 text-center">
            <AnimatedNumber value={counters[index]} className="block text-lg font-semibold text-ink-950" />
            <span className="text-[11px] text-ink-500">{label}</span>
          </div>
        ))}
      </div>

      {job?.status === 'FAILED' && job.message && <p className="text-sm text-status-critical">{job.message}</p>}

      {job?.errors && job.errors.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-status-critical-bg">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-status-critical-bg text-status-critical">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Línea</th>
                <th className="px-3 py-1.5 text-left font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {job.errors.map((err) => (
                <tr key={err.linea}>
                  <td className="px-3 py-1.5 text-ink-700">{err.linea}</td>
                  <td className="px-3 py-1.5 text-ink-700">{err.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
