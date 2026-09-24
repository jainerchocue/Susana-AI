"""Demo end-to-end: analyze → execute SQL locally → interpret."""
import json
import sqlite3
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8000"
API_KEY = "change-me-internal-key"
DB = Path(__file__).resolve().parents[1] / "data" / "hospital.db"


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    question = "Cuantas camas de UCI estan ocupadas hoy?"

    print("=== PASO 1: ANALYZE (agente propone SQL) ===")
    analyze = post(
        "/internal/agent/analyze",
        {
            "question": question,
            "user_context": {"role": "ANALYST", "permissions": ["assistant:use"]},
            "conversation": [],
            "schema_version": "1.0",
        },
    )
    print(json.dumps(analyze, ensure_ascii=False, indent=2))

    sql = analyze["proposed_query"]["sql"]
    print("\n=== PASO 2: EJECUTAR SQL (esto lo haria Node.js) ===")
    print(sql)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(sql)]
    conn.close()
    print("Resultado:", json.dumps(rows, ensure_ascii=False, indent=2))

    print("\n=== PASO 3: INTERPRET (agente explica los numeros) ===")
    interpret = post(
        "/internal/agent/interpret",
        {
            "question": question,
            "intent": analyze["intent"],
            "sql": sql,
            "columns": list(rows[0].keys()) if rows else ["camas_ocupadas"],
            "rows": rows,
            "metadata": {},
        },
    )
    print(json.dumps(interpret, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
