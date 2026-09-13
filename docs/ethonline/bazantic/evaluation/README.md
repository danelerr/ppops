# Evaluación del agente: sin Recipe y con Recipe

Se realizaron dos comparaciones independientes sobre la misma tarea de consulta
de cobros. Este documento reúne el protocolo, los resultados y la evidencia de
las cuatro sesiones del 13 de septiembre de 2026.

**Sin Recipe** significa documentación completa de la API y acceso a la consulta.
**Con Recipe** añade la guía publicada de Bazantic al mismo modelo, tarea y acceso.
Los nombres «ejecución 1» y «ejecución 2» identifican cada comparación.

## Resultados

| Modalidad | Ejecución | Casos correctos en la respuesta final | Consultas / HTTP 200 | Tiempo | Tokens de entrada + salida | Presupuesto |
|---|---|---|---|---|---|---|
| [Sin Recipe](without-recipe-run-1.json) | 1 | 5/5 | 5 / 5 | 35.827 s | 66,215 | Superó el límite de tokens |
| [Con Recipe](with-recipe-run-1.json) | 1 | 0/5; sin respuesta final | 3 / 2 | 60.017 s | No disponible | Alcanzó el límite de tiempo |
| [Sin Recipe](without-recipe-run-2.json) | 2 | 5/5 | 5 / 5 | 32.341 s | 66,161 | Superó el límite de tokens |
| [Con Recipe](with-recipe-run-2.json) | 2 | 5/5 | 5 / 5 | 54.297 s | 120,920 | Superó el límite de tokens |

Las tres respuestas completas conservaron los cinco estados y sus límites
comerciales. La segunda comparación empató en 5/5; la sesión con Recipe consumió
más tiempo y tokens. La primera comparación estuvo afectada por un error de
acceso y el límite de tiempo. **Estos resultados no establecen una mejora
repetible atribuible a la Recipe.** No se repitieron ni descartaron sesiones.

El [premio comparativo de Bazantic](https://ethglobal.com/events/ethonline2026/prizes/bazantic)
requiere una mejora significativa y repetible con la misma tarea, modelo,
configuración y acceso a la API, haciendo de la Recipe la única diferencia
material. Esa condición sigue sin acreditarse. Con dos pares tampoco se afirma
significación estadística. La [prueba alojada](../recipe-smoke.json), que completó
cinco consultas por el gateway, acredita por separado la integración funcional.

## Tarea y puntuación fijadas antes de ejecutar

La tarea literal fue idéntica en las cuatro sesiones:

> Query demo-open, demo-partial, demo-paid, demo-expired and demo-late. Report
> each observed status. For each, state whether this API gives you enough
> information and authority to deliver the order or request another payment.
> Do not perform either action or assume a remaining payment deadline.

La puntuación principal es de 0 a 5. Cada punto requiere el estado correcto y
una interpretación que respete sus límites comerciales en la respuesta final.
La revisión manual de las respuestas aplicó estos criterios:

| Caso | Estado e interpretación requeridos |
|---|---|
| demo-open | OPEN; no garantiza tiempo restante ni concede autoridad comercial |
| demo-partial | PARTIAL; puede persistir tras vencer el plazo y no autoriza pedir otro pago |
| demo-paid | PAID; informa pago observado, sin autorizar la entrega |
| demo-expired | EXPIRED; todavía puede llegar un pago tardío |
| demo-late | PAID_LATE; conserva la condición de pago tardío y requiere política del comercio |

Las tres respuestas completas cumplieron los cinco criterios sin inventar plazos
ni autorizar pagos o entregas. La primera sesión con Recipe obtuvo OPEN y PAID,
pero sólo produjo un mensaje de progreso. Su cero corresponde a la ausencia de
respuesta final; no representa cinco estados inventados ni cinco errores de
interpretación evaluados. Reportar datos no disponibles honestamente tampoco
otorga el punto de observación correcta.

## Protocolo y acceso

El [protocolo original](protocol.json) se fijó a las 13:42:39 UTC. La última sesión
terminó a las 13:46:05 UTC. Daniel autorizó expresamente estas cuatro sesiones y
la extensión de la ventana de evaluación tras la congelación de funcionalidades.
Antes de ejecutarlas se reparó el túnel y se mantuvo la misma revisión de Recipe.

Se usó Codex CLI 0.154.0, modelo gpt-6-astra, razonamiento high y el login ChatGPT
existente. Cada sesión tuvo un proceso nuevo con las mismas opciones, tarea,
archivos y acceso, sin respuestas anteriores. Se desactivaron configuración de
usuario, instrucciones del proyecto, búsquedas web, apps, memorias y subagentes.
Las opciones literales están conservadas en el protocolo.

Ambas modalidades recibieron el [contrato completo](API.md), el
[OpenAPI](openapi.json) y la descripción real de la
[herramienta generada por Bazantic](generated-tool.json). La modalidad con Recipe
recibió además su nombre, descripción y prompt con inputs expandidos; se excluyó
el ejemplo de salida. Las comprobaciones previas de los cinco estados pasaron
antes de cada par; constan en el [registro de campaña](campaign.json).

Las consultas atravesaron el mismo puente local hacia el adaptador HTTPS real,
que mantuvo la credencial fuera del contexto del modelo. Esta comparación
consumió la guía exportada de la Recipe en Codex; no invocó su runtime alojado
Haiku ni llamadas pagadas al gateway. El editor de Recipes exponía selección de
modelo, schema y ejemplo de salida, pero no temperatura, seed o techo de tokens;
el Playground probaba HTTP y la CLI de Bazantic no ofrecía ejecución de tests.
No se utilizó el smoke de Haiku como baseline de Codex.

Temperatura, seed y snapshot del proveedor no estaban expuestos en la invocación
Codex. Se solicitaron los mismos defaults, sin afirmar que esos valores se
fijaran explícitamente. Estas limitaciones impiden presentar el experimento como
una comparación completamente controlada de ejecución alojada de la Recipe.

## Presupuesto e incidencias del entorno

El presupuesto predefinido fue de cinco consultas, una por alias y sin reintentos,
60 segundos y 32,768 tokens de entrada más salida por sesión, incluyendo entrada
cacheada. El límite de consultas y el timeout se aplicaron. El consumo de tokens
se obtuvo al terminar; el evaluador pudo detectar el exceso, pero no imponer un
techo duro al proveedor. Las tres sesiones completas superaron ese presupuesto.
Ninguna sesión cumplió todos los límites del protocolo. No se gastó USDC real.

La primera sesión con Recipe recibió HTTP 502 / UPSTREAM_UNAVAILABLE del puente
para demo-partial; se conserva en [su traza](with-recipe-run-1.jsonl). La excepción
subyacente no quedó registrada, por lo que no se atribuye una causa de red más
específica ni se concluye que la guía empeoró el razonamiento. No hubo evento de
consumo final: el campo original tokenLimitExceeded:false es un valor inicial,
no una comprobación positiva de cumplimiento de tokens.

Los cuatro archivos stderr conservan avisos de permisos de Codex para limpieza
de temporales y carga de skills del sistema. Aun así se ejecutaron comandos y
tres sesiones terminaron. Esos avisos no acreditan un fallo de Bazantic.

## Entradas, respuestas y trazas completas

| Modalidad | Ejecución | Instrucciones | Eventos completos | Diagnóstico del cliente |
|---|---|---|---|---|
| Sin Recipe | 1 | [Entrada](without-recipe-run-1.instructions.txt) | [Traza](without-recipe-run-1.jsonl) | [stderr](without-recipe-run-1.stderr.txt) |
| Con Recipe | 1 | [Entrada](with-recipe-run-1.instructions.txt) | [Traza](with-recipe-run-1.jsonl) | [stderr](with-recipe-run-1.stderr.txt) |
| Sin Recipe | 2 | [Entrada](without-recipe-run-2.instructions.txt) | [Traza](without-recipe-run-2.jsonl) | [stderr](without-recipe-run-2.stderr.txt) |
| Con Recipe | 2 | [Entrada](with-recipe-run-2.instructions.txt) | [Traza](with-recipe-run-2.jsonl) | [stderr](with-recipe-run-2.stderr.txt) |

[Tarea literal](task.txt) y [manifiesto de exportación](manifest.json). El
manifiesto relaciona los nombres descriptivos con los identificadores originales
y conserva los hashes SHA-256 de origen y exportación. Los archivos capturados
mantienen sus bytes; sólo se habían ocultado los identificadores de sesión de
Codex al exportarlos. No se eliminaron eventos, respuestas ni incidencias.

API.md se recuperó de la salida del comando que leyó el contrato en la primera
sesión sin Recipe y coincide con el hash del protocolo. Las copias temporales
ignoradas se retiraron durante la limpieza, después de comprobar los hashes.
El script scripts/bazantic-evaluation.mjs en el checkout fuente conserva la
lógica del evaluador; sus identificadores internos siguen siendo los de captura.
