# Presentación Susana-AI — Guión para el jurado

## Cómo presentar (recomendado)

Abre en el navegador (pantalla completa con **F**):

```text
Susana-AI/docs/presentacion/index.html
```

Controles: **→** siguiente · **←** anterior · **F** pantalla completa · **N** nota del orador · clic derecha/izquierda.

Deck Figma (borrador anterior): https://www.figma.com/slides/LGmnaAJJBUuVWaMGgDXoA7  
FigJam arquitectura: https://www.figma.com/board/5XE6rZuQFlOQedlwHzcYEK/Agente-Hospital-Intelligence---secuencia

**Duración:** 7–9 min + demo  
**Frase ancla:** *El agente propone. Node autoriza. El hospital decide.*

---

## Diccionario (léelo antes)

| Palabra | Di esto al jurado |
|---------|-------------------|
| Agente de IA | Programa que entiende preguntas en español y busca en los datos del hospital |
| Dashboard | Pantalla con números y gráficas importantes |
| KPI | Indicador clave (ej. % de camas ocupadas) |
| HIS | Sistema de Información Hospitalaria |
| Node / BFF | El “portero”: login, permisos y consultas seguras |
| DSL | Pedido seguro de datos; Node lo revisa antes de consultar |
| SQL | Lenguaje técnico de bases; el usuario no tiene que saberlo |
| RBAC | Roles: farmacia no ve lo mismo que el director |
| Random Forest | Predicción mirando el patrón de días pasados |
| Ticket | Pase temporal con límites para el agente |
| PII | Datos personales; no los devolvemos en el chat |

---

## Las 4 preguntas oficiales del documento del reto

Debes demostrarlas en vivo (o en video de respaldo):

1. **¿Cuántas camas de UCI están ocupadas hoy?**  
2. **¿Cuáles son los medicamentos con menos de 5 días de inventario?**  
3. **¿Cuál es el tiempo de espera promedio en urgencias en la última semana?**  
4. **¿Qué servicio tiene más pacientes ingresados este mes?**

### Extra (nuestro valor — díselo al jurado)

5. **¿Cómo se ve la demanda / ocupación la próxima semana?** → predicción (Random Forest o tendencia) + tip operativo  

También: profundizar desde una **alerta** del briefing.

---

## Orden de las 18 diapositivas

| # | Título | Qué decir |
|---|--------|-----------|
| 1 | Portada | Nombre del producto; demo al final |
| 2 | Agenda | Recorrido en 15 s |
| 3 | Problema | Datos dispersos → decisiones tarde |
| 4 | Objetivos | 4 metas del prototipo |
| 5–6 | Conceptos | Diccionario; frase ancla |
| 7 | Solución | Panel + alertas + asistente |
| 8 | Flujo 5 pasos | Pregunta → respuesta útil |
| 9 | Arquitectura | Diagrama Cliente · Servicios · Datos |
| 10 | Secuencia | Flechas del FigJam |
| 11 | Agente | Planner → Predictor → Recommender |
| 12 | Entrega | Funciona hoy |
| 13 | Tecnologías | Para qué sirve cada una |
| 14 | Seguridad | La IA no manda sobre los datos |
| 15 | **Demo documento** | Las **4 preguntas exactas** |
| 16 | Demo extra | Predicción + tip |
| 17 | Límites / futuro | Honestidad |
| 18 | Cierre | Frase ancla + preguntas |

---

## Checklist 5 min antes

- [ ] Abrir `docs/presentacion/index.html` en Chrome  
- [ ] Backend + agente + frontend arriba  
- [ ] Login de prueba listo  
- [ ] Las 4 preguntas del documento ensayadas  
- [ ] Pregunta de predicción “calentada”  
- [ ] Plan B: capturas/video  

## Tiempo

| Bloque | Min |
|--------|-----|
| 1–6 Contexto y conceptos | 2 |
| 7–14 Solución y seguridad | 2.5 |
| 15–16 Demo | 3–4 |
| 17–18 Cierre | 1 |
