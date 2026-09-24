"""Load real HIS schema from diccionario / known table definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.config.settings import settings
from app.schema.glossary import get_glossary


@dataclass
class ColumnDef:
    name: str
    data_type: str
    nullable: bool = False
    is_pk: bool = False
    is_fk: bool = False
    fk_ref: str | None = None
    description: str = ""
    is_pii: bool = False


@dataclass
class TableDef:
    name: str
    description: str
    columns: list[ColumnDef] = field(default_factory=list)
    row_estimate: int | None = None

    def column_names(self) -> list[str]:
        return [c.name for c in self.columns]


# Canonical schema aligned with Diccionario_Datos_HIS + real .txt headers
CANONICAL_TABLES: dict[str, TableDef] = {
    "Paciente": TableDef(
        name="Paciente",
        description="Pacientes anonimizados (14.502 filas aprox.)",
        row_estimate=14502,
        columns=[
            ColumnDef("TipoDocumento", "texto", description="CC, TI, CE, RC, PA, etc.", is_pii=True),
            ColumnDef("IdPaciente", "entero", is_pk=True, description="Identificador único", is_pii=True),
            ColumnDef("NombrePaciente", "texto", description="Iniciales anonimizadas", is_pii=True),
            ColumnDef("FechaNacimiento", "fecha", description="Fecha de nacimiento", is_pii=True),
            ColumnDef("Sexo", "texto", description="Masculino / Femenino"),
            ColumnDef("Asegurador", "texto", description="EPS/ARL"),
            ColumnDef("Regimen", "texto", description="Régimen de afiliación"),
            ColumnDef("Departamento", "texto"),
            ColumnDef("Municipio", "texto"),
            ColumnDef("Zona", "texto", description="Urbana / Rural"),
        ],
    ),
    "Ingresos": TableDef(
        name="Ingresos",
        description="Admisiones / episodios de atención (17.781 filas aprox.)",
        row_estimate=17781,
        columns=[
            ColumnDef("OidIngreso", "entero", is_pk=True, description="ID de admisión"),
            ColumnDef("ConsecutivoIngreso", "entero"),
            ColumnDef("IdPaciente", "entero", is_fk=True, fk_ref="Paciente.IdPaciente", is_pii=True),
            ColumnDef("ClaseIngreso", "texto", description="Ambulatorio / Hospitalario"),
            ColumnDef("ViaIngreso", "texto", description="Urgencias, Hospitalización, etc."),
            ColumnDef("TipoRiesgo", "texto"),
            ColumnDef("FechaIngreso", "fecha/hora"),
            ColumnDef("FechaHospitalizacion", "fecha/hora", nullable=True),
            ColumnDef("OidTriageA", "entero", nullable=True, is_fk=True, fk_ref="Triage.OidTriage"),
            ColumnDef("CodigoCama", "texto"),
            ColumnDef("NombreCama", "texto"),
            ColumnDef("NombreGrupoCama", "texto", description="Grupo de camas (ej. UCI)"),
            ColumnDef("NombreSubgrupoCama", "texto"),
            ColumnDef("CodigoDiagnostico", "texto", nullable=True, description="CIE-10"),
            ColumnDef("NombreDiagnostico", "texto", nullable=True),
        ],
    ),
    "Triage": TableDef(
        name="Triage",
        description="Eventos de triage en urgencias (17.781 filas aprox.)",
        row_estimate=17781,
        columns=[
            ColumnDef("OidTriage", "entero", is_pk=True, nullable=True),
            ColumnDef("FechaTriage", "fecha/hora", nullable=True),
            ColumnDef("MotivoConsulta", "texto", nullable=True, is_pii=True),
            ColumnDef("TensionArterial", "texto", nullable=True),
            ColumnDef("FrecuenciaCardiaca", "texto", nullable=True),
            ColumnDef("FrecuenciaRespiratoria", "texto", nullable=True),
            ColumnDef("Temperatura", "texto", nullable=True),
            ColumnDef("IdPaciente2", "entero", nullable=True, is_fk=True, fk_ref="Paciente.IdPaciente", is_pii=True),
            ColumnDef("CodigoTriage", "texto", nullable=True),
            ColumnDef("ClasificacionTriage", "texto", nullable=True),
        ],
    ),
    "Atencion": TableDef(
        name="Atencion",
        description="Primera atención médica asociada al ingreso (17.375 filas aprox.)",
        row_estimate=17375,
        columns=[
            ColumnDef("OidIngreso", "entero", is_pk=True, is_fk=True, fk_ref="Ingresos.OidIngreso"),
            ColumnDef("FechaAtencion", "fecha/hora"),
        ],
    ),
    "Servicios": TableDef(
        name="Servicios",
        description="Líneas de servicio/procedimiento CUPS (582.357 filas aprox.)",
        row_estimate=582357,
        columns=[
            ColumnDef("OidS", "entero", is_pk=True),
            ColumnDef("OidIngreso", "entero", is_fk=True, fk_ref="Ingresos.OidIngreso"),
            ColumnDef("CodigoServicio", "texto", description="Código CUPS"),
            ColumnDef("NombreServicio", "texto"),
            ColumnDef("Cantidad", "entero"),
            ColumnDef("FechaPrestacion", "fecha/hora"),
            ColumnDef("CodigoAreaServicio", "texto"),
            ColumnDef("AreaServicio", "texto"),
            ColumnDef("Especialidad", "texto"),
        ],
    ),
    "MedicamentoInsumo": TableDef(
        name="MedicamentoInsumo",
        description="Medicamentos/insumos dispensados (579.465 filas aprox.)",
        row_estimate=579465,
        columns=[
            ColumnDef("OidMI", "entero", is_pk=True),
            ColumnDef("OidIngreso", "entero", is_fk=True, fk_ref="Ingresos.OidIngreso"),
            ColumnDef("CodigoServicio", "texto"),
            ColumnDef("NombreServicio", "texto", description="Nombre del medicamento/insumo"),
            ColumnDef("Cantidad", "entero"),
            ColumnDef("FechaPrestacion", "fecha/hora"),
            ColumnDef("AreaServicio", "texto"),
            ColumnDef("Especialidad", "texto"),
        ],
    ),
    "ProgramacionCirugia": TableDef(
        name="ProgramacionCirugia",
        description="Programaciones quirúrgicas (13.046 filas aprox.)",
        row_estimate=13046,
        columns=[
            ColumnDef("ConsecutivoProgramacion", "texto", description="Agrupa servicios de una cirugía"),
            ColumnDef("IdPaciente", "entero", is_fk=True, fk_ref="Paciente.IdPaciente", is_pii=True),
            ColumnDef("OidIngreso", "entero", nullable=True, is_fk=True, fk_ref="Ingresos.OidIngreso"),
            ColumnDef("CodigoServicio", "texto"),
        ],
    ),
}

RELATIONSHIPS: list[str] = [
    "Ingresos.IdPaciente → Paciente.IdPaciente",
    "Ingresos.OidTriageA → Triage.OidTriage",
    "Atencion.OidIngreso → Ingresos.OidIngreso",
    "Servicios.OidIngreso → Ingresos.OidIngreso",
    "MedicamentoInsumo.OidIngreso → Ingresos.OidIngreso",
    "ProgramacionCirugia.IdPaciente → Paciente.IdPaciente",
    "ProgramacionCirugia.OidIngreso → Ingresos.OidIngreso",
    "Triage.IdPaciente2 → Paciente.IdPaciente",
]


class SchemaLoader:
    """Exposes schema slices for NL2SQL (only needed tables)."""

    def __init__(self, diccionario_path: Path | None = None) -> None:
        self.diccionario_path = diccionario_path or settings.diccionario_path
        self.tables = {k: v for k, v in CANONICAL_TABLES.items()}
        self.relationships = list(RELATIONSHIPS)
        self.glossary = get_glossary()
        self._enrich_pii_from_glossary()

    def _enrich_pii_from_glossary(self) -> None:
        for table in self.tables.values():
            for col in table.columns:
                if self.glossary.is_pii_column(col.name):
                    col.is_pii = True

    def table_names(self) -> list[str]:
        return list(self.tables.keys())

    def get_table(self, name: str) -> TableDef | None:
        return self.tables.get(name)

    def all_columns(self) -> set[str]:
        cols: set[str] = set()
        for t in self.tables.values():
            cols.update(t.column_names())
        return cols

    def columns_for_tables(self, table_names: list[str]) -> set[str]:
        cols: set[str] = set()
        for name in table_names:
            table = self.tables.get(name)
            if table:
                cols.update(table.column_names())
        return cols

    def select_relevant_tables(self, intent: str, entities: list[str]) -> list[str]:
        intent_map: dict[str, list[str]] = {
            "OCCUPANCY": ["Ingresos"],
            "WAIT_TIME": ["Ingresos", "Triage", "Atencion"],
            "MEDICATION_STOCK": ["MedicamentoInsumo"],
            "MEDICATION_CONSUMPTION": ["MedicamentoInsumo"],
            "DEMAND": ["Ingresos", "Servicios"],
            "SURGERY": ["ProgramacionCirugia", "Ingresos"],
            "TRIAGE": ["Triage", "Ingresos"],
            "SERVICE_ANALYSIS": ["Servicios", "Ingresos"],
            "GENERAL_ANALYTICS": ["Ingresos", "Servicios"],
            "ROOT_CAUSE": ["Ingresos", "Triage", "Atencion", "Servicios"],
            "RECOMMENDATION": ["MedicamentoInsumo", "Ingresos"],
        }
        tables = list(intent_map.get(intent, ["Ingresos"]))

        entity_table_map = {
            "medicamento": "MedicamentoInsumo",
            "servicio": "Servicios",
            "triage": "Triage",
            "cirugia": "ProgramacionCirugia",
            "uci": "Ingresos",
            "cama": "Ingresos",
            "espera": "Atencion",
            "paciente": "Paciente",
            "ingreso": "Ingresos",
            "urgencia": "Ingresos",
        }
        for ent in entities:
            t = entity_table_map.get(ent)
            if t and t not in tables:
                tables.append(t)
        return tables

    def schema_prompt_fragment(self, table_names: list[str] | None = None) -> str:
        names = table_names or self.table_names()
        lines: list[str] = ["Esquema HIS disponible (solo tablas relevantes):", ""]
        for name in names:
            table = self.tables.get(name)
            if not table:
                continue
            lines.append(f"TABLA {table.name} — {table.description}")
            for col in table.columns:
                flags = []
                if col.is_pk:
                    flags.append("PK")
                if col.is_fk:
                    flags.append(f"FK→{col.fk_ref}")
                if col.is_pii:
                    flags.append("PII-evitar")
                flag_str = f" [{', '.join(flags)}]" if flags else ""
                desc = f" — {col.description}" if col.description else ""
                lines.append(f"  - {col.name} ({col.data_type}){flag_str}{desc}")
            lines.append("")
        lines.append("RELACIONES:")
        for rel in self.relationships:
            if any(n in rel for n in names):
                lines.append(f"  - {rel}")
        lines.append("")
        lines.append(self.glossary.prompt_block())
        return "\n".join(lines)


@lru_cache
def get_schema_loader() -> SchemaLoader:
    return SchemaLoader()
