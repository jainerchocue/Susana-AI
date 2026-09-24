import { useRef, useState, type DragEvent } from 'react'
import { cn } from '@/utils/cn'
import { formatBytes } from '@/utils/format'
import { IconCheck, IconUpload, IconX } from './icons'

export interface DropzoneProps {
  file: File | null
  onFileSelect: (file: File | null) => void
  accept?: string
  hint?: string
  disabled?: boolean
}

/** Zona de arrastrar-y-soltar para un único archivo. Sin dependencias — solo File API nativa. */
export function Dropzone({ file, onFileSelect, accept = '.csv,text/csv', hint, disabled }: DropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragActive(false)
    if (disabled) return
    const dropped = event.dataTransfer.files[0]
    if (dropped) onFileSelect(dropped)
  }

  if (file) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-400 text-white">
            <IconCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-950">{file.name}</p>
            <p className="text-xs text-ink-500">{formatBytes(file.size)}</p>
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onFileSelect(null)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500 hover:bg-white hover:text-ink-950"
            aria-label="Quitar archivo"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setIsDragActive(true)
      }}
      onDragLeave={() => setIsDragActive(false)}
      onDrop={handleDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center',
        'transition-[border-color,box-shadow,transform] duration-(--duration-base) ease-snappy',
        disabled && 'cursor-not-allowed opacity-50',
        isDragActive
          ? 'scale-[1.01] border-accent-400 bg-accent-50 shadow-glow-accent'
          : 'border-surface-100 bg-surface-0 hover:border-brand-200',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full transition-colors',
          isDragActive ? 'bg-accent-400 text-white' : 'bg-surface-100 text-ink-500',
        )}
      >
        <IconUpload className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-ink-900">Arrastre el archivo CSV aquí o haga clic para elegirlo</p>
      {hint && <p className="max-w-xs text-xs text-ink-500">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) onFileSelect(selected)
          event.target.value = ''
        }}
      />
    </div>
  )
}
