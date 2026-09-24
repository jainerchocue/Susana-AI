"""SQL validation with sqlglot — SELECT-only, known tables/columns, limits."""

from __future__ import annotations

from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

from app.config.settings import settings
from app.schema.loader import SchemaLoader, get_schema_loader


FORBIDDEN_KEYWORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "REPLACE",
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "VACUUM",
    "GRANT",
    "REVOKE",
    "EXEC",
    "EXECUTE",
    "INTO OUTFILE",
    "LOAD_FILE",
)


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)
    columns: list[str] = field(default_factory=list)
    has_limit: bool = False
    normalized_sql: str | None = None


class QueryAnalyzer:
    def __init__(self, schema: SchemaLoader | None = None) -> None:
        self.schema = schema or get_schema_loader()

    def validate(self, sql: str) -> ValidationResult:
        result = ValidationResult(valid=True)
        if not sql or not sql.strip():
            result.valid = False
            result.errors.append("SQL vacío")
            return result

        cleaned = sql.strip().rstrip(";")
        upper = cleaned.upper()

        for kw in FORBIDDEN_KEYWORDS:
            if kw in upper:
                result.valid = False
                result.errors.append(f"Operación no permitida: {kw}")

        if ";" in cleaned:
            result.valid = False
            result.errors.append("Múltiples statements no permitidos")

        try:
            parsed = sqlglot.parse_one(cleaned, read="sqlite")
        except Exception as exc:  # noqa: BLE001
            result.valid = False
            result.errors.append(f"SQL no parseable: {exc}")
            return result

        if not isinstance(parsed, exp.Select) and not parsed.find(exp.Select):
            result.valid = False
            result.errors.append("Solo se permiten consultas SELECT")

        if parsed.find(exp.Insert) or parsed.find(exp.Update) or parsed.find(exp.Delete) or parsed.find(exp.Drop):
            result.valid = False
            result.errors.append("DDL/DML detectado")

        tables = [
            t.name
            for t in parsed.find_all(exp.Table)
            if t.name
        ]
        # Preserve case against known schema names
        known = {n.lower(): n for n in self.schema.table_names()}
        normalized_tables: list[str] = []
        for t in tables:
            canon = known.get(t.lower())
            if not canon:
                result.valid = False
                result.errors.append(f"Tabla desconocida: {t}")
            else:
                normalized_tables.append(canon)
        result.tables = list(dict.fromkeys(normalized_tables))

        columns: list[str] = []
        for col in parsed.find_all(exp.Column):
            if col.name and col.name != "*":
                columns.append(col.name)
        result.columns = list(dict.fromkeys(columns))

        allowed_cols = self.schema.columns_for_tables(result.tables) if result.tables else self.schema.all_columns()
        allowed_lower = {c.lower(): c for c in allowed_cols}
        for col in result.columns:
            if col.lower() not in allowed_lower and col.upper() not in {
                "COUNT",
                "SUM",
                "AVG",
                "MIN",
                "MAX",
                "DATE",
                "DATETIME",
                "JULIANDAY",
                "STRFTIME",
                "COALESCE",
                "CAST",
                "ROUND",
                "UPPER",
                "LOWER",
                "LENGTH",
            }:
                # Allow aliases / expressions — only warn if clearly unknown identifier style
                if col[0].isupper() or "_" in col:
                    if col.lower() not in allowed_lower:
                        result.warnings.append(f"Columna posiblemente desconocida: {col}")

        limit = parsed.find(exp.Limit)
        result.has_limit = limit is not None
        if not result.has_limit:
            result.warnings.append("Se recomienda LIMIT")
            # Auto-append limit for safety when returning to Node
            cleaned = f"{cleaned}\nLIMIT {settings.default_sql_limit}"
            result.has_limit = True
            result.warnings.append(f"LIMIT {settings.default_sql_limit} añadido automáticamente")

        if "SELECT *" in upper or "SELECT*" in upper.replace(" ", ""):
            result.warnings.append("Evitar SELECT *; preferir columnas explícitas")

        try:
            result.normalized_sql = parsed.sql(dialect="sqlite")
            if "LIMIT" not in result.normalized_sql.upper():
                result.normalized_sql = f"{result.normalized_sql} LIMIT {settings.default_sql_limit}"
        except Exception:  # noqa: BLE001
            result.normalized_sql = cleaned

        if result.errors:
            result.valid = False
        return result
