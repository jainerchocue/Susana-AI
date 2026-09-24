import { useState } from 'react'
import { Button, Dropzone } from '@/components/ui'
import { IconCheck } from '@/components/ui/icons'
import { useImportJobDetail } from '../hooks/useImportJobDetail'
import { useDownloadImportTemplate, useUploadImport } from '../hooks/useUploadImport'
import { IMPORT_TABLE_META, IMPORT_TABLE_ORDER } from '../tableMeta'
import { ImportJobDetailView } from './ImportJobDetailView'
import type { ImportTable } from '@/types'
import { cn } from '@/utils/cn'

type WizardStep = 'table' | 'upload' | 'tracking'

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'table', label: 'Tabla' },
  { key: 'upload', label: 'Archivo' },
  { key: 'tracking', label: 'Resultado' },
]

function WizardStepper({ step }: { step: WizardStep }) {
  const currentIndex = STEPS.findIndex((item) => item.key === step)

  return (
    <div className="mb-6 flex items-center" aria-hidden="true">
      {STEPS.map((item, index) => {
        const isDone = index < currentIndex
        const isActive = index === currentIndex
        return (
          <div key={item.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors duration-(--duration-base)',
                  isDone && 'border-accent-400 bg-accent-400 text-white',
                  isActive && !isDone && 'border-brand-600 text-brand-600',
                  !isDone && !isActive && 'border-surface-100 text-ink-300',
                )}
              >
                {isDone ? <IconCheck className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className={cn('text-[11px] font-medium', isActive ? 'text-ink-950' : 'text-ink-500')}>
                {item.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                className={cn(
                  'mx-2 h-0.5 flex-1 rounded-full transition-colors duration-(--duration-base)',
                  isDone ? 'bg-accent-400' : 'bg-surface-100',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ImportWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<WizardStep>('table')
  const [selectedTable, setSelectedTable] = useState<ImportTable | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const { upload, isUploading } = useUploadImport()
  const { download, isDownloading } = useDownloadImportTemplate()
  const { job } = useImportJobDetail(jobId)

  async function handleUpload() {
    if (!selectedTable || !selectedFile) return
    try {
      const created = await upload(selectedTable, selectedFile)
      setJobId(created.id)
      setStep('tracking')
    } catch {
      // el hook ya mostró el toast de error
    }
  }

  return (
    <div>
      <WizardStepper step={step} />

      {step === 'table' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {IMPORT_TABLE_ORDER.map((table) => {
              const meta = IMPORT_TABLE_META[table]
              const isSelected = selectedTable === table
              return (
                <button
                  key={table}
                  type="button"
                  onClick={() => setSelectedTable(table)}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors duration-(--duration-fast)',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                    isSelected ? 'border-brand-600 bg-brand-50' : 'border-surface-100 hover:border-brand-200',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      isSelected ? 'bg-brand-600 text-white' : 'bg-surface-100 text-ink-500',
                    )}
                  >
                    <meta.icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-950">{meta.label}</span>
                    <span className="block text-xs text-ink-500">{meta.description}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!selectedTable || isDownloading}
              onClick={() => selectedTable && download(selectedTable)}
            >
              Descargar plantilla CSV
            </Button>
            <Button type="button" disabled={!selectedTable} onClick={() => setStep('upload')}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {step === 'upload' && selectedTable && (
        <div className="flex flex-col gap-4">
          <Dropzone file={selectedFile} onFileSelect={setSelectedFile} hint={`Se importará como ${IMPORT_TABLE_META[selectedTable].label}`} />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep('table')}>
              Atrás
            </Button>
            <Button type="button" isLoading={isUploading} disabled={!selectedFile} onClick={handleUpload}>
              Subir
            </Button>
          </div>
        </div>
      )}

      {step === 'tracking' && (
        <div className="flex flex-col gap-4">
          <ImportJobDetailView job={job} />
          <div className="flex justify-end">
            <Button type="button" onClick={onDone}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
