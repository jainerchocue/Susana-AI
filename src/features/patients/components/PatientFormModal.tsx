import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button, Input, Modal } from '@/components/ui'
import {
  patientCreateSchema,
  patientUpdateSchema,
  type PatientCreateFormValues,
  type PatientUpdateFormValues,
} from '@/schemas/patient.schema'
import type { Patient } from '@/types'

interface PatientFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patient: Patient | null
  onCreate: (values: PatientCreateFormValues) => Promise<unknown>
  onUpdate: (id: number, values: PatientUpdateFormValues) => Promise<unknown>
  isSaving: boolean
}

export function PatientFormModal({ open, onOpenChange, patient, onCreate, onUpdate, isSaving }: PatientFormModalProps) {
  const isEdit = patient !== null

  const createForm = useForm<PatientCreateFormValues>({ resolver: zodResolver(patientCreateSchema) })
  const editForm = useForm<PatientUpdateFormValues>({
    resolver: zodResolver(patientUpdateSchema),
    values: patient
      ? {
          documentType: patient.documentType,
          sex: patient.sex,
          insurer: patient.insurer,
          regime: patient.regime,
          department: patient.department,
          municipality: patient.municipality,
          zone: patient.zone,
        }
      : undefined,
  })

  async function handleCreateSubmit(values: PatientCreateFormValues) {
    await onCreate(values)
    createForm.reset()
    onOpenChange(false)
  }

  async function handleEditSubmit(values: PatientUpdateFormValues) {
    if (!patient) return
    await onUpdate(patient.id, values)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) createForm.reset()
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar paciente' : 'Nuevo paciente'}
      description="Datos demográficos y de identificación del HIS."
      size="lg"
    >
      {isEdit ? (
        <form className="flex flex-col gap-4" onSubmit={editForm.handleSubmit(handleEditSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="ID de paciente" value={patient.id} disabled hint="Clave natural del HIS, no editable." />
            <Input
              label="Tipo de documento"
              {...editForm.register('documentType')}
              error={editForm.formState.errors.documentType?.message}
            />
            <Input label="Sexo" {...editForm.register('sex')} error={editForm.formState.errors.sex?.message} />
            <Input
              label="Aseguradora"
              {...editForm.register('insurer')}
              error={editForm.formState.errors.insurer?.message}
            />
            <Input label="Régimen" {...editForm.register('regime')} error={editForm.formState.errors.regime?.message} />
            <Input
              label="Departamento"
              {...editForm.register('department')}
              error={editForm.formState.errors.department?.message}
            />
            <Input
              label="Municipio"
              {...editForm.register('municipality')}
              error={editForm.formState.errors.municipality?.message}
            />
            <Input label="Zona" {...editForm.register('zone')} error={editForm.formState.errors.zone?.message} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Guardar
            </Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={createForm.handleSubmit(handleCreateSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="ID de paciente"
              type="number"
              {...createForm.register('id', { valueAsNumber: true })}
              error={createForm.formState.errors.id?.message}
            />
            <Input
              label="Tipo de documento"
              {...createForm.register('documentType')}
              error={createForm.formState.errors.documentType?.message}
            />
            <Input
              label="Fecha de nacimiento"
              type="date"
              {...createForm.register('birthDate')}
              error={createForm.formState.errors.birthDate?.message}
            />
            <Input label="Sexo" {...createForm.register('sex')} error={createForm.formState.errors.sex?.message} />
            <Input
              label="Aseguradora"
              {...createForm.register('insurer')}
              error={createForm.formState.errors.insurer?.message}
            />
            <Input
              label="Régimen"
              {...createForm.register('regime')}
              error={createForm.formState.errors.regime?.message}
            />
            <Input
              label="Departamento"
              {...createForm.register('department')}
              error={createForm.formState.errors.department?.message}
            />
            <Input
              label="Municipio"
              {...createForm.register('municipality')}
              error={createForm.formState.errors.municipality?.message}
            />
            <Input label="Zona" {...createForm.register('zone')} error={createForm.formState.errors.zone?.message} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Crear
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
