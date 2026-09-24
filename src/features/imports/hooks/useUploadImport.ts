import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { importsApi } from '@/services/api'
import type { ImportTable } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

export function useUploadImport() {
  const queryClient = useQueryClient()

  const uploadMutation = useMutation({
    mutationFn: ({ table, file }: { table: ImportTable; file: File }) => importsApi.upload(table, file),
    onSuccess: () => {
      toast.info('Importación iniciada', 'Puede seguir su progreso en el historial.')
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.all })
    },
    onError: (error) => {
      toast.error('No se pudo iniciar la importación', getDisplayErrorMessage(error))
    },
  })

  return {
    upload: (table: ImportTable, file: File) => uploadMutation.mutateAsync({ table, file }),
    isUploading: uploadMutation.isPending,
  }
}

export function useDownloadImportTemplate() {
  const downloadMutation = useMutation({
    mutationFn: (table: ImportTable) => importsApi.downloadTemplate(table),
    onError: (error) => {
      toast.error('No se pudo descargar la plantilla', getDisplayErrorMessage(error))
    },
  })

  return {
    download: (table: ImportTable) => downloadMutation.mutate(table),
    isDownloading: downloadMutation.isPending,
  }
}

export function useDeleteImportJob() {
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: (id: string) => importsApi.remove(id),
    onSuccess: () => {
      toast.success('Registro de importación eliminado')
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.all })
    },
    onError: (error) => {
      toast.error('No se pudo eliminar el registro', getDisplayErrorMessage(error))
    },
  })

  return {
    remove: (id: string) => deleteMutation.mutate(id),
    isDeleting: deleteMutation.isPending,
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
