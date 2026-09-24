"""Prueba en vivo del chat: React -> Node :3000 -> agente :8000 -> Node :3001 -> Postgres.

Inicia sesión con el SEED_ADMIN del .env de Node, hace las preguntas y, para cada
respuesta, separa las cifras en:
  - trazables: aparecen tal cual en las filas que Node ejecutó (o en la pregunta);
  - derivadas: totales, porcentajes, equivalencias o proyecciones calculadas por el
    narrador (se listan para revisarlas; no son un fallo).
Falla (exit 1) si alguna pregunta no devuelve HTTP 200.

Uso (con `npm run dev` y el agente arriba):
    agent/.venv/bin/python agent/scripts/prueba_en_vivo.py [preguntas.txt]
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import httpx

RAIZ = Path(__file__).resolve().parents[2]
PREGUNTAS = [
    "¿Cuántas camas de UCI están ocupadas hoy?",
    "¿Cuáles son los medicamentos con menos de 5 días de inventario?",
    "¿Cuál es el tiempo de espera promedio en urgencias en la última semana?",
    "¿Qué servicio tiene más pacientes ingresados este mes?",
    "¿Cómo se ve la demanda la próxima semana?",
    "Hola",
    "¿Qué dosis de acetaminofén le doy a un niño?",
    "¿Cuántas cirugías no se realizaron?",
]
_FECHAS = re.compile(
    r"\d{1,2} de [a-z]+ de \d{4}( a las \d{2}:\d{2})?|del \d{1,2}( de [a-z]+)? al \d{1,2} de [a-z]+ de \d{4}"
    r"|\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*( \d{4})?|[a-z]+ de \d{4}|\b20\d{2}\b"
)


def _env() -> dict[str, str]:
    out = {}
    for linea in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in linea and not linea.lstrip().startswith("#"):
            k, v = linea.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def _formas(v: float) -> set[str]:
    formas = set()
    for d in (0, 1, 2):
        n = round(v, d)
        entero, _, frac = f"{n:.{d}f}".partition(".")
        base = f"{int(entero):,}".replace(",", ".")
        formas.add(f"{base},{frac.rstrip('0')}" if frac.rstrip("0") else base)
    return formas


def main() -> int:
    preguntas = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if len(sys.argv) > 1 else PREGUNTAS
    env = _env()
    base = f"http://localhost:{env.get('PORT', '3000')}{env.get('API_PREFIX', '/api/v1')}"
    login = httpx.post(
        f"{base}/auth/sign-in/email",
        json={"email": env["SEED_ADMIN_EMAIL"], "password": env["SEED_ADMIN_PASSWORD"]},
        headers={"Origin": "http://localhost:5173"},
        timeout=20,
    )
    token = login.headers.get("set-auth-token")
    if login.status_code != 200 or not token:
        print(f"Login fallido: HTTP {login.status_code}")
        return 1
    cliente = httpx.Client(timeout=40, headers={"Authorization": f"Bearer {token}"})  # Bearer puro, sin cookie

    fallos = 0
    for pregunta in [p.strip() for p in preguntas if p.strip()]:
        for _ in range(5):
            t0 = time.time()
            r = cliente.post(f"{base}/assistant/query", json={"question": pregunta})
            if r.status_code != 429:
                break
            time.sleep(int(r.headers.get("retry-after") or 15))
        dt = time.time() - t0
        datos = (r.json() or {}).get("data") or {}
        print(f"\n### {pregunta}\n[HTTP {r.status_code} · {datos.get('status')} · {dt:.1f}s]\n{datos.get('answer') or r.text[:300]}")
        if r.status_code != 200:
            fallos += 1
            continue
        trazables = {c for c in re.findall(r"\d+", pregunta)}
        for q in datos.get("queries") or []:
            for fila in q["rows"]:
                for v in fila.values():
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        trazables |= _formas(float(v))
        texto = _FECHAS.sub(" ", datos.get("answer") or "")
        derivadas = sorted({c for c in re.findall(r"\d+(?:[.,]\d+)*", texto) if c not in trazables})
        if derivadas:
            print(f"   derivadas (revisar): {', '.join(derivadas)}")
        time.sleep(6.1)  # ASSISTANT_RATE_LIMIT_MAX=10/min por usuario
    print(f"\n{len(preguntas)} preguntas · {fallos} con HTTP distinto de 200")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
