import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE,
  PERMISSIONS,
  PERMISSION_LIST,
  SYSTEM_ROLES,
  WILDCARD_PERMISSION,
} from '../../src/core/rbac/permissions';
import { alcancesPorPermiso, tienePermiso } from '../../src/core/rbac/alcance';
import { ALERT_SCOPES, ALERT_SCOPE_PERMISSION } from '../../src/modules/alerts/alerts.constants';
import { bloquearRegistroPublico } from '../../src/core/auth/auth';

/**
 * Unitarios de las piezas compartidas de T1: el catalogo de permisos y roles,
 * el filtrado por ambito y la puerta de registro publico. Nada de red ni BD:
 * si algo aqui falla, la fundacion esta mal antes de tocar ningun modulo.
 */

function ordenado(lista: readonly string[]): string[] {
  return [...lista].sort();
}

describe('SYSTEM_ROLES · matriz de T1', () => {
  // Copia literal de la tabla de la especificacion: si el catalogo cambia sin
  // avisar aqui, este test debe fallar antes que cualquier otro.
  const tabla: Record<string, readonly string[]> = {
    SUPER_ADMIN: [WILDCARD_PERMISSION],
    ADMIN: PERMISSION_LIST.map((p) => p.action),
    DIRECTOR: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.analytics.export,
      PERMISSIONS.assistant.use,
      PERMISSIONS.assistant.advanced,
      PERMISSIONS.alerts.read,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
      PERMISSIONS.medications.read,
    ],
    JEFE_SERVICIO: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.assistant.use,
      PERMISSIONS.alerts.read,
      PERMISSIONS.alerts.manage,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
    ],
    FARMACIA: [
      PERMISSIONS.medications.read,
      PERMISSIONS.medications.manage,
      PERMISSIONS.alerts.read,
      PERMISSIONS.alerts.manage,
      PERMISSIONS.assistant.use,
    ],
    ANALISTA: [
      PERMISSIONS.dashboard.read,
      PERMISSIONS.analytics.read,
      PERMISSIONS.assistant.use,
      PERMISSIONS.services.read,
      PERMISSIONS.surgeries.read,
      PERMISSIONS.medications.read,
    ],
    CONSULTA: [PERMISSIONS.dashboard.read],
  };

  it('los nombres de rol coinciden exactamente (ni de mas ni de menos)', () => {
    expect(ordenado(Object.keys(SYSTEM_ROLES))).toEqual(ordenado(Object.keys(tabla)));
  });

  it.each(Object.entries(tabla))('%s tiene exactamente los permisos de la tabla', (nombre, permisos) => {
    const rol = Object.values(SYSTEM_ROLES).find((r) => r.name === nombre);
    if (!rol) throw new Error(`rol ausente en SYSTEM_ROLES: ${nombre}`);
    expect(ordenado(rol.permissions)).toEqual(ordenado(permisos));
  });

  it('DEFAULT_ROLE es CONSULTA', () => {
    expect(DEFAULT_ROLE).toBe('CONSULTA');
  });

  it('todo permiso de un rol de sistema existe en PERMISSION_LIST (o es el comodin)', () => {
    const catalogo = new Set(PERMISSION_LIST.map((p) => p.action));
    for (const rol of Object.values(SYSTEM_ROLES)) {
      for (const permiso of rol.permissions) {
        expect(permiso === WILDCARD_PERMISSION || catalogo.has(permiso)).toBe(true);
      }
    }
  });
});

describe('ALERT_SCOPE_PERMISSION', () => {
  it('solo usa permisos que existen en el catalogo', () => {
    const catalogo = new Set(PERMISSION_LIST.map((p) => p.action));
    for (const ambito of ALERT_SCOPES) {
      expect(catalogo.has(ALERT_SCOPE_PERMISSION[ambito])).toBe(true);
    }
  });
});

describe('alcance.ts · tienePermiso', () => {
  it('el comodin pasa cualquier chequeo', () => {
    expect(tienePermiso(new Set([WILDCARD_PERMISSION]), PERMISSIONS.alerts.manage)).toBe(true);
  });

  it('exige el permiso exacto sin comodin', () => {
    expect(tienePermiso(new Set([PERMISSIONS.alerts.read]), PERMISSIONS.alerts.read)).toBe(true);
    expect(tienePermiso(new Set([PERMISSIONS.alerts.read]), PERMISSIONS.alerts.manage)).toBe(false);
  });

  it('un conjunto vacio nunca pasa', () => {
    expect(tienePermiso(new Set(), PERMISSIONS.dashboard.read)).toBe(false);
  });
});

describe('alcance.ts · alcancesPorPermiso', () => {
  it('devuelve solo las claves cuyo permiso se posee (subconjunto)', () => {
    const permisos = new Set([PERMISSIONS.medications.read]);
    expect(alcancesPorPermiso(permisos, ALERT_SCOPE_PERMISSION)).toEqual(['medication']);
  });

  it('el comodin da todos los ambitos', () => {
    const permisos = new Set([WILDCARD_PERMISSION]);
    expect(ordenado(alcancesPorPermiso(permisos, ALERT_SCOPE_PERMISSION))).toEqual(ordenado([...ALERT_SCOPES]));
  });

  it('sin permisos, ningun ambito', () => {
    expect(alcancesPorPermiso(new Set(), ALERT_SCOPE_PERMISSION)).toEqual([]);
  });
});

describe('bloquearRegistroPublico · tabla de verdad', () => {
  const casos: Array<[string, boolean, boolean, boolean]> = [
    // path, esHttp, permitido, esperado (bloquear)
    ['/sign-up/email', true, false, true],
    ['/sign-up/email', true, true, false],
    ['/sign-up/email', false, false, false], // llamada de servidor: nunca se bloquea
    ['/sign-up/email', false, true, false],
    ['/sign-in/email', true, false, false], // otra ruta: nunca se bloquea
    ['/sign-out', true, false, false],
  ];

  it.each(casos)('path=%s esHttp=%s permitido=%s => bloquear=%s', (path, esHttp, permitido, esperado) => {
    expect(bloquearRegistroPublico(path, esHttp, permitido)).toBe(esperado);
  });
});
