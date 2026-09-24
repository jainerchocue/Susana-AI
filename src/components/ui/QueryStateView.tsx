import type { ReactNode } from 'react'
import { getDisplayErrorMessage, isForbiddenError } from '@/utils/errors'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Skeleton } from './Skeleton'

interface QueryStateViewProps<T> {
  isLoading: boolean
  isError: boolean
  error?: unknown
  data: T | undefined
  onRetry?: () => void
  isEmpty?: (data: T) => boolean
  loadingFallback?: ReactNode
  children: (data: T) => ReactNode
}

/** Standardizes loading / empty / error / forbidden rendering for any TanStack Query result. */
export function QueryStateView<T>({
  isLoading,
  isError,
  error,
  data,
  onRetry,
  isEmpty,
  loadingFallback,
  children,
}: QueryStateViewProps<T>) {
  if (isLoading) {
    return (
      loadingFallback ?? (
        <div className="flex flex-col gap-2 p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )
    )
  }

  if (isError) {
    if (isForbiddenError(error)) {
      return (
        <EmptyState title="Acceso restringido" description="No tiene permisos para ver esta información." />
      )
    }
    return <ErrorState description={getDisplayErrorMessage(error)} onRetry={onRetry} />
  }

  if (data === undefined || (isEmpty ? isEmpty(data) : false)) {
    return <EmptyState />
  }

  return <>{children(data)}</>
}
