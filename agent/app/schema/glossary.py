"""Hospital terminology mapping based on Glosario_Terminos_Salud_HIS."""

from __future__ import annotations

from functools import lru_cache


# Core domain terms → meaning (for prompts / entity resolution)
GLOSSARY_TERMS: dict[str, str] = {
    "HIS": "Sistema de Información Hospitalaria",
    "IPS": "Institución Prestadora de Servicios de Salud",
    "EPS": "Entidad Promotora de Salud (aseguradora)",
    "ARL": "Administradora de Riesgos Laborales",
    "RIPS": "Registro Individual de Prestación de Servicios de Salud",
    "CUPS": "Clasificación Única de Procedimientos en Salud (CodigoServicio en Servicios)",
    "CIE-10": "Clasificación Internacional de Enfermedades (CodigoDiagnostico en Ingresos)",
    "Ingreso": "Episodio de atención desde llegada hasta alta (tabla Ingresos)",
    "ClaseIngreso": "Ambulatorio u Hospitalario",
    "ViaIngreso": "Urgencias, Hospitalización, Remitido, Cirugía Ambulatoria",
    "Triage": "Clasificación de urgencia (I más urgente … V menos urgente)",
    "Oid": "Identificador interno numérico del HIS (no OID ISO)",
    "AreaServicio": "Unidad funcional (Farmacia, Laboratorio, Hospitalización, etc.)",
    "Especialidad": "Rama médica del profesional",
    "ProgramacionCirugia": "Agendamiento quirúrgico (puede no coincidir con ejecución)",
    "UCI": "Unidad de Cuidados Intensivos — buscar en NombreGrupoCama / NombreSubgrupoCama / NombreCama",
    "Inventario": "En datos reales no hay stock físico; se estima consumo vía MedicamentoInsumo",
}

# Synonyms / NL phrases → canonical field or concept
ENTITY_ALIASES: dict[str, list[str]] = {
    "paciente": ["Paciente", "IdPaciente"],
    "ingreso": ["Ingresos", "OidIngreso", "admisión", "admision"],
    "urgencia": ["Urgencias", "ViaIngreso"],
    "triage": ["Triage", "ClasificacionTriage", "CodigoTriage"],
    "cama": ["CodigoCama", "NombreCama", "NombreGrupoCama", "NombreSubgrupoCama"],
    "uci": ["UCI", "UCINT", "CUIDADOS INTENSIVOS"],
    "medicamento": ["MedicamentoInsumo", "farmacia", "insumo"],
    "servicio": ["Servicios", "NombreServicio", "AreaServicio"],
    "cirugia": ["ProgramacionCirugia", "cirugía", "quirúrgico"],
    "diagnostico": ["CodigoDiagnostico", "NombreDiagnostico", "CIE-10"],
    "espera": ["tiempo de espera", "FechaTriage", "FechaAtencion", "FechaIngreso"],
}

PII_COLUMNS: frozenset[str] = frozenset(
    {
        "NombrePaciente",
        "TipoDocumento",
        "IdPaciente",
        "FechaNacimiento",
        "MotivoConsulta",
    }
)


class Glossary:
    """Maps hospital terminology for prompts and entity resolution."""

    def __init__(self) -> None:
        self.terms = dict(GLOSSARY_TERMS)
        self.aliases = {k: list(v) for k, v in ENTITY_ALIASES.items()}
        self.pii_columns = set(PII_COLUMNS)

    def resolve_entities(self, question: str) -> list[str]:
        q = question.lower()
        found: list[str] = []
        for key, aliases in self.aliases.items():
            tokens = [key, *aliases]
            if any(t.lower() in q for t in tokens):
                found.append(key)
        return found

    def prompt_block(self) -> str:
        lines = ["Terminología hospitalaria relevante:"]
        for term, meaning in self.terms.items():
            lines.append(f"- {term}: {meaning}")
        return "\n".join(lines)

    def is_pii_column(self, column: str) -> bool:
        return column in self.pii_columns


@lru_cache
def get_glossary() -> Glossary:
    return Glossary()
