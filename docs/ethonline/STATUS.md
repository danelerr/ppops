# PPOps para agentes — estado de entrega

**La integración de consulta está implementada y publicada en Bazantic.**
Un agente puede consultar cinco estados de cobro de demo mediante un gateway MCP
y una Recipe, con una credencial independiente de solo lectura. El comercio
conserva el control de su API administrativa y sus claves de gasto.

## Qué incluye la entrega

| Componente | Resultado |
|---|---|
| API para agentes | Una operación de consulta; respuesta limitada al alias y al estado |
| Gateway MCP | Activo en Bazantic, en sandbox |
| Recipe | Publicada; prueba alojada con cinco consultas y cinco estados correctos |
| Aislamiento | Credencial independiente, alias autorizados y rutas administrativas cerradas |
| Pruebas del adaptador | 29 pruebas aprobadas |
| Suite completa del comercio | 124 pruebas en 28 archivos; cobertura exigida satisfecha |
| Documentación y paquete | Enlaces y prueba del paquete aprobados tras la limpieza |

La demo usa pagos simulados procesados por las primitivas existentes de PPOps.
La conexión HTTPS y el gateway son reales. El túnel depende de que este equipo
permanezca conectado. El último control de cierre devolvió HTTP 200 para OpenAPI
y PAID/200 para la consulta autenticada.

## Recorrido de la documentación

- [Presentación y guion de demo](HANDOFF.md).
- [Integración publicada, enlaces y reinicio](bazantic/DELIVERY.md).
- [Ejecutar y probar el ejemplo](bazantic/README.md).
- [Conexión con Bazantic](bazantic/CONNECTION.md).
- [Evaluación sin Recipe / con Recipe](bazantic/evaluation/README.md).

## Preparación para el envío

El texto del proyecto está guardado en el formulario y el guion está preparado.
La publicación del código y los materiales de la submission están en curso,
autorizados por Daniel. Quedan el video con voz humana y el envío final.
Confirmar la modalidad Continuity registrada y el corte preevento.

Ledger se omitió por instrucción de Daniel. Uniswap no se implementó. La entrega
actual se centra en la consulta para agentes mediante Bazantic.

## Atribución y verificaciones técnicas

Base de trabajo: `cfc3d408175236a56410cbfe6ef7e4e4f95018f1`, del 7 de septiembre.
El checkout inicial estaba en main y sólo tenía el plan final sin seguimiento.
El reconciliador, dominio de pagos, PayIn, payer y webhooks ya existían en esa
base y se conservaron. El candidato de corte preevento es
`f0f4a350ad82f66347a9b7b20d47b22d22bd0111`, del 30 de agosto; requiere confirmación.
Los cambios del 5–7 de septiembre se atribuyen separadamente. Detalle en
CONTINUITY.md y AI_USAGE.md, en la raíz del repositorio fuente.

Entorno de implementación: Node 24.13.0 y npm 11.6.2, con dependencias existentes.
Se leyó CONTRIBUTING.md y no se encontraron AGENTS.md aplicables. El plan final
se conserva en la raíz del checkout como especificación de esta entrega.

| Verificación ejecutada | Resultado |
|---|---|
| Baseline focalizado: config, private-files, user-journeys, cli y backup | 20 pruebas aprobadas |
| Baseline API/webhook y core | 13 pruebas aprobadas |
| Adaptador más API/webhook y core | 42 pruebas aprobadas |
| Typecheck y build | Aprobados |
| Suite completa con cobertura | 124 pruebas aprobadas |
| Privacidad, pruebas de privacidad y separación daemon/payer | Aprobadas |
| Smoke aislado tras limpieza | Cinco estados correctos; sin credencial 401, rutas prohibidas 404, cierre limpio |
| Documentación y package smoke tras limpieza | Aprobados con dependencias existentes |
| Integridad de evidencias | Hashes verificados; credencial de demo ausente de los archivos de entrega |

El comando integral `npm run verify` se detuvo en el audit de dependencias:
53 avisos del árbol existente (29 low, 14 moderate, 10 high). No se cambiaron
package.json ni los lockfiles, ni se omitió ese control. No se ejecutaron una
instalación limpia o verify:all del payer, cuyo código no cambió.

La evaluación comparativa terminó con dos pares de sesiones. Tres respuestas
completaron correctamente los cinco casos; una sesión quedó sin respuesta final
tras un problema de acceso y timeout. Las tres completas superaron el presupuesto
de tokens. No se estableció una mejora repetible; el requisito comparativo del
premio Bazantic sigue sin acreditarse. La [evaluación completa](bazantic/evaluation/README.md)
conserva resultados, límites del entorno y todas las trazas.

## Limpieza y conservación

El 13 de septiembre, al cierre local de las 10:27 Bolivia, se eliminaron 131
archivos temporales (22,258,076 bytes): cobertura regenerable, cachés de Vitest,
instalador de cloudflared, payloads de edición y copias ignoradas de la evaluación.
Se verificaron los hashes de origen y exportación antes de retirar las copias.
La evidencia completa se conserva con nombres descriptivos y contenido original.
Bases de datos, secretos, respaldos y recursos que mantienen la demo siguen
excluidos de Git y se conservaron. La revisión editorial posterior unifica los
nombres y la presentación; no modifica la funcionalidad ni los resultados.
