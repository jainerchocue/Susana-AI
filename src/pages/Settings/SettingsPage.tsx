import { useMemo, useState, type ComponentType, type SVGProps } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { toast } from '@/app/store/toastStore'
import { Badge, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Tooltip, type BadgeTone } from '@/components/ui'
import {
  IconBell,
  IconBuilding,
  IconCalendar,
  IconCapsule,
  IconChartLine,
  IconChat,
  IconClock,
  IconCopy,
  IconGrid,
  IconListChecks,
  IconLock,
  IconMail,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconUser,
} from '@/components/ui/icons'
import { roleLabel } from '@/constants'
import { formatDate, formatRelativeTime } from '@/utils/format'

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: 'Activo', tone: 'good' },
  SUSPENDED: { label: 'Suspendido', tone: 'critical' },
  DELETED: { label: 'Eliminado', tone: 'critical' },
}

const GROUP_LABELS: Record<string, string> = {
  alerts: 'Alertas',
  analytics: 'Analítica',
  assistant: 'Asistente IA',
  dashboard: 'Dashboard',
  medications: 'Medicamentos',
  services: 'Servicios',
  surgeries: 'Cirugías',
  users: 'Usuarios',
  roles: 'Roles',
  permissions: 'Permisos',
  audit: 'Auditoría',
}

const GROUP_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  alerts: IconBell,
  analytics: IconChartLine,
  assistant: IconChat,
  dashboard: IconGrid,
  medications: IconCapsule,
  services: IconBuilding,
  surgeries: IconListChecks,
  users: IconUser,
  roles: IconShieldCheck,
  permissions: IconLock,
  audit: IconListChecks,
}

const ACTION_LABELS: Record<string, string> = {
  read: 'Ver',
  manage: 'Gestionar',
  create: 'Crear',
  update: 'Actualizar',
  delete: 'Eliminar',
  export: 'Exportar',
  use: 'Usar',
  advanced: 'Avanzado',
  'assign-roles': 'Asignar roles',
  'assign-permissions': 'Asignar permisos',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function permissionModule(permission: string): string {
  const [module] = permission.split(':')
  return module ?? permission
}

function permissionAction(permission: string): string {
  const [, action] = permission.split(':')
  return action ?? permission
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function groupLabel(module: string): string {
  return GROUP_LABELS[module] ?? module
}

function groupPermissions(permissions: string[]): { module: string; label: string; actions: string[] }[] {
  const map = new Map<string, string[]>()
  for (const permission of permissions) {
    const module = permissionModule(permission)
    map.set(module, [...(map.get(module) ?? []), permissionAction(permission)])
  }
  return [...map.entries()]
    .map(([module, actions]) => ({ module, label: groupLabel(module), actions: actions.sort() }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-surface-100 py-3 last:border-0">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-50 text-brand-600">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-900">{label}</p>
          <p className="text-xs text-ink-500">{value}</p>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user)
  const permissions = useAuthStore((state) => state.permissions)
  const [search, setSearch] = useState('')

  const groups = useMemo(() => groupPermissions(permissions), [permissions])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return groups
    return groups
      .map((group) => ({
        ...group,
        actions: group.actions.filter(
          (action) =>
            action.toLowerCase().includes(query) ||
            actionLabel(action).toLowerCase().includes(query) ||
            group.label.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.actions.length > 0)
  }, [groups, search])

  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Configuración"
          description="Información de perfil y permisos asignados."
        />

        <Card>
          <CardBody>
            <EmptyState
              icon={<IconSettings className="h-8 w-8" />}
              title="No hay información de usuario disponible"
              description="No fue posible cargar los datos de la sesión actual."
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  const status = STATUS_META[user.status] ?? { label: user.status, tone: 'neutral' as BadgeTone }
  const totalPermissions = permissions.includes('*') ? 'Todos' : String(permissions.length)

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.email)
      toast.success('Correo copiado al portapapeles')
    } catch {
      toast.error('No se pudo copiar el correo')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configuración"
        description="Su perfil, seguridad y los permisos asignados a su cuenta."
      />

      <Card className="overflow-hidden">
        <div className="relative bg-brand-900 px-6 py-8 sm:px-8">
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow-glow-brand">
              {initials(user.name)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-white">{user.name}</h2>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <p className="truncate text-sm text-ink-300">{user.email}</p>
                <Tooltip label="Copiar correo electrónico">
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="shrink-0 rounded-md p-1 text-ink-300 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Copiar correo electrónico"
                  >
                    <IconCopy className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {user.roles.length === 0 && (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-ink-300">
                    Sin rol asignado
                  </span>
                )}
                {user.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white ring-1 ring-white/20"
                  >
                    {roleLabel(role)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <CardBody className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="text-xs text-ink-500">Roles asignados</p>
            <p className="mt-0.5 text-lg font-semibold text-ink-950">{user.roles.length}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Permisos activos</p>
            <p className="mt-0.5 text-lg font-semibold text-ink-950">{totalPermissions}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Verificación de correo</p>
            <p className="mt-0.5 text-lg font-semibold text-ink-950">{user.emailVerified ? 'Sí' : 'Pendiente'}</p>
          </div>
          <div>
            <p className="text-xs text-ink-500">Miembro desde</p>
            <p className="mt-0.5 text-base font-semibold text-ink-950">{formatDate(user.createdAt)}</p>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Información de la cuenta" subtitle="Datos básicos de su usuario en el sistema" />
          <CardBody className="flex flex-col divide-y divide-surface-100">
            <InfoRow icon={IconUser} label={user.name} value="Nombre completo" />
            <InfoRow icon={IconMail} label={user.email} value="Correo electrónico" />
            <InfoRow icon={IconShieldCheck} label={status.label} value="Estado de la cuenta" />
            <InfoRow icon={IconCalendar} label={formatDate(user.createdAt)} value="Cuenta creada" />
            <InfoRow icon={IconClock} label={formatRelativeTime(user.createdAt)} value="Antigüedad de la cuenta" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Seguridad" subtitle="Estado de la verificación de su cuenta" />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-100 bg-surface-0 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-good-bg text-status-good">
                  <IconMail className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink-900">Correo verificado</p>
                  <p className="text-xs text-ink-500">
                    {user.emailVerified
                      ? 'Su correo electrónico fue confirmado.'
                      : 'Verifique su correo para asegurar la cuenta.'}
                  </p>
                </div>
              </div>
              <Badge tone={user.emailVerified ? 'good' : 'medium'}>
                {user.emailVerified ? 'Verificado' : 'Sin verificar'}
              </Badge>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-100 bg-surface-0 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-50 text-brand-600">
                  <IconShieldCheck className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink-900">Doble factor de autenticación</p>
                  <p className="text-xs text-ink-500">
                    {user.twoFactorEnabled
                      ? 'Su cuenta usa una segunda verificación al iniciar sesión.'
                      : 'Su cuenta no requiere una segunda verificación.'}
                  </p>
                </div>
              </div>
              <Badge tone={user.twoFactorEnabled ? 'good' : 'neutral'}>
                {user.twoFactorEnabled ? 'Activada' : 'Desactivada'}
              </Badge>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Permisos asignados"
          subtitle={
            permissions.length === 0
              ? 'Su cuenta no tiene permisos asociados.'
              : `${permissions.length} permiso${permissions.length === 1 ? '' : 's'} agrupado${permissions.length === 1 ? '' : 's'} por módulo`
          }
          action={
            permissions.length > 0 &&
            !permissions.includes('*') && (
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar permiso…"
                aria-label="Buscar permiso"
                className="h-9 w-48 text-xs sm:w-64"
                endAdornment={
                  <span className="pr-1 text-ink-300">
                    <IconSearch className="h-4 w-4" aria-hidden="true" />
                  </span>
                }
              />
            )
          }
        />
        <CardBody className="flex flex-col gap-6">
          {permissions.length === 0 ? (
            <EmptyState
              icon={<IconLock className="h-8 w-8" />}
              title="Sin permisos asignados"
              description="Este usuario no tiene permisos asociados en el sistema."
            />
          ) : permissions.includes('*') ? (
            <div className="flex items-center gap-3 rounded-xl border border-accent-300/40 bg-accent-50 px-4 py-3">
              <IconShieldCheck className="h-5 w-5 shrink-0 text-accent-700" aria-hidden="true" />
              <p className="text-sm text-ink-900">
                <span className="font-semibold">Acceso total.</span> Este usuario tiene todos los permisos del
                sistema (super administrador).
              </p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState
              icon={<IconSearch className="h-8 w-8" />}
              title="Sin resultados"
              description={`No se encontraron permisos que coincidan con “${search.trim()}”.`}
            />
          ) : (
            filteredGroups.map((group) => {
              const GroupIcon = GROUP_ICONS[group.module] ?? IconSparkles
              return (
                <section key={group.module} aria-label={group.label} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3 border-b border-surface-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-50 text-brand-600">
                        <GroupIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <h3 className="text-sm font-semibold text-ink-950">{group.label}</h3>
                    </div>
                    <Badge tone="neutral">
                      {group.actions.length} accion{group.actions.length === 1 ? '' : 'es'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2" role="list" aria-label={`Permisos de ${group.label}`}>
                    {group.actions.map((action) => (
                      <Badge key={action} tone="neutral" role="listitem" title={`${group.module}:${action}`} className="capitalize">
                        {actionLabel(action)}
                      </Badge>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </CardBody>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <IconLock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Los roles y permisos son gestionados por el administrador del sistema desde el backend. Este módulo es de
        solo lectura.
      </p>
    </div>
  )
}