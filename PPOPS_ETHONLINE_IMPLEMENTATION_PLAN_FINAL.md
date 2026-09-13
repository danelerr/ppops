# PPOps · Plan final de implementación para ETHOnline 2026

**Versión:** 3, basada en revisión directa del código. Sustituye v1, v2 y cualquier adenda anterior.  
**Repositorio:** `danelerr/ppops`. **Proyecto:** PPOps. **Track:** Continuity, a confirmar en el dashboard.  
**Commit inspeccionado y HEAD de `main` al consultar:** `cfc3d408175236a56410cbfe6ef7e4e4f95018f1`.  
**Modalidad de revisión:** lectura estática de código, búsqueda de consumidores y contraste con documentación oficial. **No se instalaron dependencias ni se ejecutaron pruebas, hardware, transacciones o integraciones.**

> **O0 · Objetivo permanente:** PPOps es infraestructura abierta, autohospedable y view-only para aceptar y conciliar pagos privados de USDC nativo en Arbitrum. Las extensiones deben mejorar su operación o integración sin convertir el daemon en una wallet de gasto, cambiar sus reglas de conciliación o exigir un proveedor externo a todos sus usuarios. [C01]

**Resultado de esta entrega:** una mejora terminada y demostrable, no tres integraciones incompletas. Ledger es el candidato principal si su aprovisionamiento está resuelto. Bazantic es un candidato independiente condicionado a acceso real y evidencia A/B. Uniswap no se inicia automáticamente.

## 1. Decisiones cerradas para el agente

| ID | Resultado permitido | Fuera de alcance |
|---|---|---|
| O1 | Ledger como fuente opcional de **un único secreto: HMAC de webhooks** | Viewing key, spending keys, nuevo gestor universal de secretos, firmware o cambios a RAILGUN |
| O2 | Adapter Bazantic de **consulta de estado de solicitudes de demo** | Crear solicitudes, efectuar pagos, entregar pedidos, cambiar políticas o exponer la API administrativa |
| O3 | Solo con aprobación expresa: preparación pública acotada de USDC mediante Uniswap | Nuevo shield, wallet nueva, private-swap harness, cambios al journal o al daemon |
| O4 | Pruebas, evidencia, atribución y submission reproducibles | Nuevos sponsors, rebrand, nuevas redes, frontend adicional o refactorizaciones generales |

No añadir Arc, Privy, The Graph, 1inch u otro sponsor por iniciativa del agente. Mantener el mismo repositorio y producto. Una rama de entrega revisada es suficiente; no es obligatorio fusionar apresuradamente a `main`.

**Cada reporte de trabajo debe indicar:** objetivo O0–O4, tarea, archivos, fuente oficial, prueba ejecutada y limitación pendiente. Los nombres nuevos descritos aquí son propuestas de implementación, no capacidades que ya existan.

### Invariantes no negociables

- El daemon no recibe material de gasto ni ejecuta swaps, shields, retiros o transferencias privadas. El payer conserva proceso, dependencias y secretos separados. [C01, C14]
- No cambiar `IntentStatus`, `deriveProjection`, matching, memo, finality, PPOI, importes, deduplicación ni autenticación de webhooks para facilitar una demo. [C02–C04]
- Solo las proyecciones del reconciliador originan estados de pago. Un swap, un receipt x402, un HTTP 200 o una respuesta del modelo no son un pago PPOps.
- Apagar las extensiones conserva el backend de archivos y el uso de PPOps sin Ledger/Bazantic/Uniswap.
- No publicar secretos, bundles operativos, bases de datos, IDs comerciales o respuestas completas del daemon. Las pruebas usan datos desechables.
- Publicación, cuentas, aprovisionamiento, presupuesto económico, operaciones con fondos, merge y submit necesitan autorización de Daniel. El agente no pide seeds o contraseñas en el chat.
- Si una tarea exige romper estas invariantes, se bloquea; no se amplía el proyecto para salvar un bounty.

## 2. Qué confirma el código y cómo afecta al trabajo

**Objetivos:** O0 y O4. **Fuentes:** archivos fijados al commit en la sección 11.

| Hecho comprobado | Consecuencia vinculante |
|---|---|
| `src/security/secrets.ts::readSecret` ya es asíncrona, valida formato y lee archivos privados | No cambiar globalmente su firma ni sustituir todos sus usos. Añadir un resolver específico del HMAC. [C05] |
| `src/config.ts` trata todas las propiedades de `secrets` como rutas y reconstruye explícitamente sus campos | La nueva fuente debe tener una ruta declarada y resuelta. No introducir allí un objeto de providers o un nombre de backend que se interprete como ruta. [C06] |
| Runtime, doctor, replay, merchant example y pilot receiver cargan el HMAC | La integración no se acepta solamente porque `serve` arranque. [C07–C11] |
| Backup y restore copian directamente el archivo HMAC | Hay que definir la compatibilidad antes de implementar, no descubrirla después de migrar el secreto. [C12] |
| `doctor` tiene `ok: boolean` y la CLI devuelve código 1 si `result.ok` es falso | No crear un sistema global de estados de diagnóstico. El caso offline se expresa mediante un check no verificado y código explicativo. [C08, C09] |
| `src/demo.ts::createDemo` genera un HMAC aleatorio y no carga configuración ni secretos | Ejecutar la demo normal no prueba que Ledger esté integrado. [C13] |
| Existe `GET /v1/intents/:id/status`, con el mismo bearer administrativo de las otras rutas | Consumir ese endpoint desde un adapter aislado; no consultar la respuesta completa de creación ni cambiar el auth del daemon. [C15] |
| `PARTIAL` se devuelve antes de evaluar expiración; `PAID_LATE` es un estado reconocido | Proyección uno a uno de los cinco estados. No reducirlos a “pending” o “paid”. [C02–C04] |
| El payer actual no tiene comandos de swap o shield | No existe un onboarding automático que pueda reutilizarse como fallback Uniswap. [C16, C17] |
| Hay un verificador explícito de la separación merchant/payer | No mover código del payer a `src`, importar fuera de su paquete ni debilitar ese verificador. [C14] |

**Atribución:** `cfc3d40` tiene fecha de commit **7 de septiembre de 2026**. Es la base revisada para este trabajo, no el corte preevento. No etiquetar automáticamente todo su contenido como “Before ETHOnline”. Identificar `PRE_EVENT_SHA` con el inicio oficial y el historial real; el trabajo ya hecho durante el evento se atribuye por separado. [C00, E1]

## 3. Reloj y G0: comprobar el entorno, no volver a diseñar el producto

**Objetivo:** O4. **Fuente externa:** E1. Los límites de trabajo son decisiones internas.

```text
DEADLINE_AT      = 2026-09-13T12:00:00-04:00
FEATURE_FREEZE_AT = 2026-09-13T08:00:00-04:00
TARGET_SUBMIT_AT  = 2026-09-13T10:00:00-04:00
R = max(0, FEATURE_FREEZE_AT - hora_actual)
```

**Todo trabajo, incluidas pruebas y evidencia, debe caber antes de la congelación.** Reservar además los últimos 30 minutos de R para integrar. No contar las cuatro horas posteriores como capacidad disponible para features.

| Bloque | Límite total; no promesa de duración |
|---|---:|
| G0, checkout y baseline focalizado | 20 minutos |
| Ledger completo, incluidos gate, consumidores, pruebas y evidencia | 180 minutos |
| Bazantic completo, incluido acceso, publicación y A/B | 140 minutos |
| Uniswap: solo decisión de viabilidad, sin implementar | 20 minutos |
| Uniswap habilitado expresamente: implementación, pruebas y evidencia | Máximo 240 minutos incluyendo su gate; solo si cabe íntegramente |

El límite Ledger reemplaza los 105 minutos de v2 porque ahora están identificados los consumidores y el impacto de recuperación. No repartir el tiempo en tareas que dejen la integración a medias.

### G0 · Entregable: `docs/ethonline/STATUS.md`

1. Registrar `git status --short`, rama, SHA local y base de trabajo. No resetear, limpiar ni sobrescribir cambios ajenos. Si el SHA local difiere del revisado, comparar solo los archivos de este plan y señalar conflictos antes de editar.
2. Registrar `WORK_BASE_SHA` y el criterio para `PRE_EVENT_SHA`. Revisar instrucciones locales `AGENTS.md` si las hubiera. No fabricar un corte temporal.
3. Verificar Node 22 o posterior, instalación de dependencias y scripts reales. Ejecutar el baseline focalizado de la sección 8 dentro del presupuesto. Distinguir PASS, fallo preexistente y NOT_RUN; no atribuir resultados del README a esta ejecución.
4. Registrar hora, R, margen de integración y gates externos de los candidatos.
5. Elegir **una integración principal**. Solo admitir un segundo agente paralelo si su gate también pasa, hay tiempo y no comparte archivos de la principal.

**Ledger:** L0 requiere aprovisionamiento utilizable y una prueba real antes de construir. Sin ello: `SKIPPED`.

**Bazantic:** B0 requiere interfaz/documentación accesible y publicación realmente posible. La documentación técnica no pudo recuperarse en esta revisión; no inventar CLI, API o manifest.

**Uniswap:** `BLOCKED` por defecto. U0 decide si existe un alcance ejecutable, pero no autoriza a empezar un private-swap harness.

Si no hay un candidato habilitado, informar la causa concreta y detener desarrollo de integraciones. No consumir la noche generando stubs.

## 4. Ledger · Un secreto, todos sus consumidores

**Objetivos:** O1 y O0. **Fuentes:** L1–L2, C05–C13, C18–C20.  
**Entrega:** fuente Key Ring opcional para el HMAC de webhooks; reglas de firma, payload y entrega sin cambios.

### L0 · Aprovisionamiento, máximo 15 minutos dentro del bloque Ledger

Daniel demuestra un Key Ring utilizable y suministra únicamente referencias a material de demo, no valores secretos. Registrar versión instalada, salida de `--help` pertinente y procedimiento que devuelve los bytes descifrados por stdout sin mezclarlos con mensajes informativos.

Ledger documenta aprovisionamiento inicial con dispositivo y operaciones posteriores de cifrado/descifrado con red. La contraseña no se escribe en comandos ni la maneja el agente; se aporta desde el almacén del sistema al proceso. No usar modo sin contraseña. [L1]

Fijar una etiqueta para esta integración, **`ppops-webhook-hmac-v1`**, y comprobarla en L0. No confundirla con `webhook.keyId`, que identifica la clave en las cabeceras HMAC de PPOps. No construir compatibilidad con todas las versiones de wallet-cli.

**Gate:** cifrar/descifrar material desechable y validar su formato sin mostrarlo. Sin hardware/aprovisionamiento, acceso remoto o stdout utilizable: STOP.

### L1 · Configuración y lectura mínima

**Archivos existentes:** `src/config.ts`, `src/security/secrets.ts`, `src/security/failures.ts`.  
**Archivo nuevo propuesto:** `src/security/ledger-key-ring.ts`.

Añadir **solo un campo opcional nuevo de tipo string**:

```text
secrets.webhookHmacKeyRingBundleFile
```

Contrato:

- `webhookHmacKeyFile` mantiene el comportamiento previo.
- Ambas fuentes presentes: configuración inválida. No hay precedencia ni fallback.
- Webhook habilitado: exactamente una fuente es obligatoria.
- Webhook deshabilitado: puede no haber fuente; si se declara una, sigue sujeta a validación de configuración.
- Resolver la nueva ruta respecto del archivo de configuración en `resolveConfigPaths`; incluirla en el control existente de rutas no superpuestas.
- Añadir el nuevo nombre a `knownFields` de la sanitización de errores. No ampliar los errores para devolver valores o mensajes del proceso externo.
- `init` sigue creando la configuración tradicional. Migrar la configuración de demo es una acción explícita del operador, no un nuevo wizard.

Añadir en `secrets.ts` el helper **propuesto**:

```typescript
readWebhookHmacKey(source: {
  webhookHmacKeyFile?: string;
  webhookHmacKeyRingBundleFile?: string;
}): Promise<string>
```

No cambia la firma de `readSecret(path, kind)`. La ruta de archivos lo reutiliza. La ruta Ledger descifra y aplica la misma validación de 64 caracteres hexadecimales, sin prefijo `0x`. No copia el resultado a un archivo ni rota el secreto automáticamente.

**Proceso externo:** usar Node sin shell ni comando arbitrario proveniente de configuración. Ciphertext validado con `readOwnerOnlyFile`, transferido por stdin; secreto por stdout en memoria. Límites internos: bundle hasta 256 KiB, salida plaintext hasta 4 KiB, stderr acotado, timeout 20 segundos. Si el formato real comprobado no encaja, bloquear; no eliminar límites. No reenviar stderr, stdout o `cause` del proceso en errores o logs. Terminar el proceso ante timeout y no reintentar indefinidamente.

La forma concreta de argumentos se toma del `--help` comprobado en L0. No usar `--output json` a ciegas ni eliminar líneas arbitrarias hasta obtener algo parecido a una clave. Conservar únicamente las variables de entorno necesarias para la invocación comprobada; nunca inyectar el resto de secretos del daemon.

### L2 · Consumidores: lista de cambios obligatorios

| Archivo / punto | Cambio requerido |
|---|---|
| `src/runtime.ts::PPOpsRuntime.create` | Resolver HMAC mediante el helper cuando hay webhook. Hacerlo antes de iniciar el engine/escaneo para fallar temprano. `serve` y `scan-once` quedan cubiertos por esta ruta. |
| `src/operations/doctor.ts::diagnose` | Sacar la comprobación HMAC del bucle genérico y tratar la fuente elegida sin duplicar checks. Las otras cuatro lecturas permanecen iguales. Aplicar L3. |
| `src/cli.ts`, caso `mainnet-gate-replay` | Sustituir guard que exige exclusivamente `webhookHmacKeyFile`; leer mediante el helper. No alterar replay, payload o política de envío. |
| `examples/merchant-app.mjs::main` | Aceptar la fuente seleccionada y usar el mismo helper desde `dist`. Conservar el resto de comprobaciones del merchant example. |
| `scripts/pilot-webhook-receiver.ts` | Conservar `--key-file`. Añadir **`--key-ring-bundle-file`** como alternativa mutuamente excluyente y pasar esa selección al helper. Es un receptor independiente: no hereda mágicamente la configuración del daemon. `--key-id` no cambia. |
| `src/backup.ts::createBackup/restoreBackup` | Aplicar L4 antes de cualquier escritura destructiva. |

`status`, `config-validate`, `preflight` e `init` no deben adquirir una dependencia innecesaria de descifrado. No modificar formatos de eventos, `WebhookDeliveryService`, algoritmos HMAC ni secreto del payer.

### L3 · `doctor --offline`: resultado concreto

La estructura existente es `Check {check, ok, hint, code?}`. Mantenerla.

Con backend Ledger:

1. Comprobar localmente que el bundle sea un archivo privado regular y legible dentro del límite; no ejecutar procesos Ledger ni peticiones de red.
2. Si falla esa comprobación, usar la sanitización existente.
3. Si pasa, emitir el check del secreto con `ok: false`, **nuevo código diagnóstico `SECRET_CHECK_REQUIRES_NETWORK`**, e indicación fija de que el bundle local es accesible pero el secreto no se verificó porque hace falta red.
4. El resultado agregado queda `ok:false`; la CLI conserva su salida **1**, ya implementada para ese caso. `FAIL` significa que no se completó la comprobación, no que se haya demostrado una clave inválida. Explicarlo en el hint y runbook.
5. No leer la fuente plaintext alternativa, persistir plaintext o introducir caché para obtener un PASS.

En doctor online, descifrar mediante el helper y comprobar el formato. En `statusOnly`, conservar la omisión de todas las lecturas de secretos. Los usuarios del backend de archivos mantienen sus resultados anteriores, incluidos los tests existentes.

### L4 · Backup/restore: limitación explícita, no formato nuevo

El backup actual no modela proveedores de secretos. Para esta entrega:

- **Backend de archivos:** comportamiento anterior intacto.
- **Ledger + `backup --include-secrets`:** rechazar con mensaje propio sanitizado **antes de crear staging, salida o copiar datos**. No omitir silenciosamente el HMAC ni exportarlo descifrado.
- **Ledger + restore de backup con `containsSecrets: true`:** rechazar después de verificar/leer el manifest y **antes de mover o copiar cualquier estado o secreto**, incluso con `--force`.
- Backup/restore de **solo estado** conserva su implementación, requiere los secretos externos disponibles y no incorpora el bundle ni credenciales Key Ring. Documentar que la recuperación de esos elementos sigue a cargo del operador.

Usar un error seguro de la aplicación, por ejemplo `UsageError` con texto fijo. No cambiar el manifest, versiones de backup, recuperación RAILGUN o políticas de `--force`. No declarar recuperación completa Ledger hasta comprobarla.

### L5 · Pruebas y evidencia de cierre

**Tests nuevos propuestos:** `test/ledger-key-ring.test.ts` y `test/webhook-secret-consumers.test.ts`. Extender los tests existentes pertinentes; no rehacerlos.

| Aceptación | Evidencia mínima |
|---|---|
| Archivo como única fuente | Devuelve lo mismo y no invoca Ledger |
| Bundle como única fuente | Invoca la forma comprobada, valida 64 hex y no abre el plaintext antiguo |
| Ambas fuentes / ninguna con webhook | Rechazo de configuración |
| Rutas relativas, colisión con storage, permisos o symlinks | Conservan los controles de configuración y lectura privada |
| Ledger falla y el archivo antiguo existe | Fallo controlado; el antiguo no se lee |
| Timeout, salida excesiva, bundle inválido, contraseña incorrecta, CLI ausente | Error sanitizado y proceso cerrado, sin reintento automático |
| Runtime | Resuelve antes del engine; usa el resultado para el servicio de webhooks |
| Doctor online/offline/status | Respeta L3, incluyendo ausencia de red/descifrado offline y exit 1 |
| Replay, merchant example, pilot receiver | Respetan la selección; no exigen silenciosamente la fuente anterior |
| Backup/restore prohibidos | Fallan antes de crear/mover archivos; no degradan tests del backend anterior |
| Logs y errores | Sentinelas sintéticos de secreto, contraseña y stderr nunca aparecen |

**Evidencia real, adicional a mocks:** descifrado real con Key Ring y un webhook firmado/verificado con ese secreto utilizando las funciones existentes. La demo normal de PPOps no sirve para acreditarlo porque genera su propia clave. [C13]

Elegir una sola demostración: entorno del daemon ya operativo, o un pequeño runner aislado que use el helper real y las primitivas existentes de webhooks con eventos sintéticos. En el segundo caso rotular **“Key Ring real; pago/evento de demo simulado”**. Un runner no prueba haber arrancado el engine mainnet. No realizar un nuevo pago mainnet solo para este bounty. Replay envía webhooks: ejecutar únicamente contra un receptor autorizado de demo.

**Límite del claim:** protección/recuperación del HMAC mediante Key Ring; plaintext existe en memoria de los procesos que lo usan. No protege automáticamente claves de gasto, no requiere un toque por webhook y no garantiza que un host comprometido no pueda leerlo. La otra parte que verifica HMAC también necesita acceso a la misma clave.

**STOP:** un secreto, todos los consumidores cubiertos, compatibilidad/limitaciones documentadas y evidencia real. Si solo funciona el arranque, sigue `PARTIAL` y no se fusiona como integración terminada.

## 5. Bazantic · Adapter mínimo sobre un endpoint existente

**Objetivos:** O2 y O0. **Fuentes:** B1, C02–C04, C15, C21.  
**Archivos nuevos propuestos:** `src/examples/bazantic-status.ts`, `examples/bazantic-status.mjs`, `test/bazantic-status.test.ts` y documentos en `docs/ethonline/bazantic/`.

Es un ejemplo opcional no importado por el runtime. Usar Hono y utilidades ya presentes; no añadir un servidor MCP propio o un nuevo framework. El runner en `examples` puede importar el módulo compilado de `dist`, como el merchant example actual. No hace falta cambiar el build. [C10, C22]

### B0 · Gate de plataforma, máximo 20 minutos

Confirmar cuenta, creación de gateway x402/MPP, MCP generado por Bazantic y publicación de Recipe por un mecanismo documentado/accesible. Registrar versión o interfaz real y enlace. Si el servicio/interfaz necesario no puede utilizarse, bloquear antes de escribir el adapter.

Preparar un entorno de demo aislado y demostrar acceso autorizado a su endpoint de estado. No asumir que `npm run demo` entrega un token administrativo: genera credenciales internas y no las expone como configuración del operador. Si se usa esa demo en un harness, su carácter simulado se declara; cualquier acceso interno permanece privado. No cambiar `createDemo` para imprimir su token. [C13]

G0/B0 debe decidir una única conexión de prueba. No construir un sistema nuevo de provisioning. Toda publicación del adapter/gateway necesita aprobación de Daniel. La documentación técnica Bazantic sigue pendiente de comprobación operativa; no usar como funcional un manifest propuesto o comandos adivinados.

### B1 · Contrato de datos y acceso

```text
Agente → gateway/MCP Bazantic → adapter de demo → PPOps de demo
```

**Ruta nueva del adapter:** `GET /v1/demo/payment-status/:requestRef`.

**Única ruta upstream permitida:** `GET /v1/intents/<id-interno-validado>/status`. El response actual es un objeto sin envoltorio: contiene `id`, `status`, importes, expiración y revisión. Seleccionar los campos permitidos; no devolverlo entero. [C15]

Mantener una allowlist fija alias → ID interno. `requestRef` no es el ID ni una referencia comercial. Host upstream administrado localmente y fijo; el caller no puede elegir URL, ruta, cabeceras ni método.

**Respuesta satisfactoria: exactamente dos propiedades.**

```json
{"requestRef":"demo-check-01","status":"OPEN"}
```

```text
status = OPEN | PARTIAL | PAID | EXPIRED | PAID_LATE | UNKNOWN
additionalProperties = false
```

- Los cinco estados conocidos se conservan uno a uno.
- Un string desconocido en una respuesta válida produce `UNKNOWN`, únicamente en el adapter.
- Falta/tipo incorrecto de status, ID discordante con el solicitado, JSON inválido, HTTP fallido o timeout son errores de upstream, no `UNKNOWN` ni pagos confirmados.
- Nunca calcular el estado por reloj ni conservar un `PAID` cacheado. La salida describe una observación, no una promesa inmutable sobre el futuro.

**Errores cerrados:** `{"error":{"code":"..."}}`. Sin credencial: 401 `UNAUTHORIZED`. Alias inexistente/no autorizado o solicitud upstream inexistente: 404 `NOT_FOUND`. Fallo de upstream: 502/503 `UPSTREAM_UNAVAILABLE`. Límite local: 429 `RATE_LIMITED`. Sin volcar body, URL, stack o credencial upstream.

**Autorización:** token administrativo solo dentro del adapter, con otra credencial independiente entre gateway y adapter. No pasar ninguna al modelo. La credencial de gateway habilita solo la ruta de lectura y aliases de demo. No modificar el auth del daemon para inventar scopes. Si el adapter fuera comprometido, su token upstream seguiría siendo amplio: por eso no se conecta a producción.

**Límites internos:** timeout upstream 5 s, body hasta 16 KiB mediante lectura limitada existente, redirects rechazados, respuestas `no-store`, rate limit 30 consultas/minuto en el ejemplo. No imprimir headers de autenticación ni reenviarlos desde el caller. No CORS abierto ni polling infinito. No publicar creación, listados, settlements, outbox, configuración, `/demo/*` o proxies genéricos.

### B2 · Semántica igual en API y Recipe

| Estado | Lo que puede informar el agente |
|---|---|
| OPEN | Estado abierto observado; sin fechas no puede garantizar cuánto plazo queda |
| PARTIAL | Pago parcial; puede persistir tras vencer el plazo. No implica que deba enviarse más dinero |
| PAID | Pago confirmado en ese estado por el reconciliador; no autoriza acciones del adapter |
| EXPIRED | Solicitud expirada; no asegura imposibilidad de un pago tardío posterior |
| PAID_LATE | Pago confirmado tardío; aplicar política comercial, sin aceptación o entrega automáticas |
| UNKNOWN | Estado recibido no interpretable; no asumir pago ni impago |

No exponer fechas para “arreglar” la decisión del modelo. Sin esa información y la política comercial, su capacidad es deliberadamente limitada a consultar e informar. La API documentada del brazo A debe contener esta misma semántica; no ocultársela para beneficiar a B.

### B3 · Pruebas y comparación honesta

Tests: cinco correspondencias exactas; PARTIAL con expiración pasada sin exponerla; PAID_LATE sin colapsar; string desconocido frente a respuesta malformada; ID discordante; errores upstream; alias/auth; verbos/rutas no permitidos; campos adicionales o sentinelas que nunca salen; timeout/body cap/no redirect/no caché. Cubrir el upstream real con sus fixtures pertinentes, no una respuesta inventada presentada como onchain.

Para el bounty: gateway y MCP reales, Recipe publicada, usuario de cuenta para atribuirla, video y resultados A/B. Mismo prompt/modelo/settings/API/datos equivalentes; la Recipe es la única diferencia material. Conservar dos pares independientes y todos los resultados, sin proclamar significación estadística. Fijar previamente tarea, métrica y presupuesto. [B1]

Tarea: consultar aliases y explicar correctamente sus estados y límites comerciales, no decidir ni ejecutar pagos. Métrica principal: respuestas correctas sin falsa confirmación, promesa de plazo o entrega indebida. No confundir menos texto o una llamada menos con una mejora significativa.

Separar llamada real gateway→API de simulación de estados/pagos. Una transacción x402 por usar la API no paga la factura PPOps. Si los dos brazos ya resuelven correctamente la tarea, registrar el empate: integración funcional, requisito de mejora no demostrado. No empeorar la API ni ampliar el producto para fabricar diferencia.

**STOP:** lectura funcionando, pruebas y comparación registrada. No añadir creación de facturas, otra API o agente financiero.

## 6. Uniswap · Sin una tarea oculta de construir una wallet

**Objetivos:** O3 y O0. **Fuentes:** U1–U3, C14, C16–C17.  
**Decisión por defecto:** no modificar archivos para esta integración.

En el commit revisado, el payer consume saldo privado gastable y tiene controles específicos de identidad, fees y recuperación. `deriveShieldPrivateKey` mencionado en la documentación no constituye un comando de funding/shield. La posibilidad general de Relay Adapt no demuestra un camino Uniswap ya implementado.

### U0 · Decisión sin escribir código

- **Ruta privada:** no construirla desde cero en esta entrega. Solo reconsiderar si Daniel aporta un prototipo ya funcional, reproducible y compatible, cuyo diff pueda probarse sin cambiar los límites del payer. Su existencia fuera del commit no se presupone.
- **Conversión pública + handoff externo:** requiere documentar antes quién realiza shield, herramienta/versión concreta, destino compatible, fee budget, prueba de saldo `Spendable` y comando real de reanudación. Sin cualquiera de esos elementos, bloqueada. El agente no implementa el shield faltante.
- **Solo preparación pública:** requiere aprobación expresa de Daniel como resultado menor. No se vende como “Swap & Pay Privately”.

### U1 · Solo si se autoriza preparación pública

Ubicar el helper dentro de `tools/ppops-payer/`, con su propio entrypoint y pruebas. No añadir comando de gasto al daemon ni importar módulos de `src` desde el payer. Reutilizar internamente su verificación de requests en `src/request.ts`, comprobando las firmas reales antes de llamar; no asumir que `PPOpsClient` verifica solicitudes. No alterar los comandos de pago existentes.

**Entregables acotados:** un par autorizado en Arbitrum, una solicitud verificada, cotización y transacción Uniswap mediante versión/API documentada, topes explícitos, aprobación humana y evidencia. API key o firmante públicos bajo control del pagador, nunca del daemon. Si solo se obtiene quote, el entregable sigue parcial.

Fijar asset exacto, caller/receptor, token USDC nativo, cantidad y fee/gas ceilings. Usar enteros para importes, no flotantes. Una cotización no autoriza approvals ilimitados, Permit2, RFQ o routers no verificados; si la ruta disponible obliga a implementar esas variantes fuera del alcance, bloquear. No elegir otro proveedor y llamarlo Uniswap.

Una operación real se prepara y se aprueba por separado, con red y presupuesto de Daniel. Después de un resultado ambiguo no repetir ni generar otra transacción automáticamente. No reutilizar el journal de pagos para operaciones de funding distintas.

**Salida funcional del helper, nueva y no perteneciente al dominio PPOps:** `PUBLIC_USDC_READY / PRIVATE_PAYMENT_NOT_STARTED`. Sin funds/receipt comprobables: parcial. Solo un pago privado posterior conciliado permite demostrar el flujo completo, sin cambiar el claim del swap público.

Tests: request/red/token/receptor incorrectos, importe fuera del tope, quote expirada, falta de autorización, fallos y duplicación de envíos, sanitización. Evidencia de swap real autorizada o simulación identificada; no llamar mainnet a un fork. Para solicitar Uniswap: repo público, integración demostrada, `FEEDBACK.md` y formulario oficial completado. [U1]

**STOP:** si no hay una ruta ya concreta que quepa con pruebas/evidencia, no codificar. No producir un helper incompleto solo por ocupar el tercer partner.

## 7. Trabajo paralelo y archivos protegidos

**Objetivos:** O0 y O4. **Fuentes:** C14, E1.

Un agente principal para Ledger y, únicamente tras B0, otro para Bazantic. Usar worktrees independientes creados desde `WORK_BASE_SHA`; no sucesivos `git switch` en un mismo directorio compartido.

El coordinador controla config común, README, documentos de entrega y cualquier cambio al lockfile. Ledger no necesita instalar el Wallet CLI como dependencia obligatoria del daemon: es requisito externo de la función opt-in. No actualizar versiones por rutina.

No editar en esta entrega: `src/reconciliation/*`, estados de `src/domain.ts`, esquema de eventos, algoritmos de `src/events/webhook.ts`, journal/submit/recovery del payer, control de finality/PPOI, scripts de trust-boundary o umbrales de privacidad para hacer pasar la suite.

Si un test de políticas falla por la nueva integración, investigar el motivo real. No borrar el test, debilitarlo o desactivar la comprobación. Entregar cambios pequeños y legibles; no reescribir historia ni auto-publicar releases.

## 8. Verificación: comandos que sí existen en este checkout

**Objetivos:** O0 y O4. **Fuentes:** C18, C19, C23.

Desde la raíz, con dependencias ya instaladas:

```bash
npm run typecheck
npm test -- test/config.test.ts test/private-files.test.ts test/user-journeys.test.ts test/cli.test.ts test/backup.test.ts
```

Ese es el baseline focalizado. `npm test` y typecheck tienen hooks de construcción del checkout. Si dependencias/artefactos faltan, registrar el bloqueo; la instalación autorizada y compilación consumen R, no un presupuesto invisible.

Después de Ledger, agregar los tests nuevos y los existentes de webhook/merchant:

```bash
npm test -- test/ledger-key-ring.test.ts test/webhook-secret-consumers.test.ts test/config.test.ts test/private-files.test.ts test/user-journeys.test.ts test/cli.test.ts test/backup.test.ts test/api-webhook.test.ts test/merchant-example.test.ts test/mainnet-gate.test.ts
```

Los dos primeros nombres son **nuevos entregables propuestos**, no tests preexistentes. No ejecutar una lista esperando que existan antes de crearlos.

Después de Bazantic:

```bash
npm test -- test/bazantic-status.test.ts test/api-webhook.test.ts test/core.test.ts
```

Cierre de una integración candidata:

```bash
npm run typecheck
npm run build
npm run docs:check
npm run trust-boundary:check
npm run privacy:check
```

Ejecutar suite completa/cobertura si cabe antes de congelar; reportar lo no ejecutado. No presentar solo los tests filtrados como verificación integral. Los scripts `verify` y `verify:all` también ejecutan auditoría de dependencias/red y, en el segundo caso, verificación del payer. No usar `npm audit fix --force` para resolver un fallo preexistente de dependencias. [C18–C19]

Si se cambió el payer, sus controles son separados:

```bash
npm --prefix tools/ppops-payer run typecheck
npm --prefix tools/ppops-payer test
npm --prefix tools/ppops-payer run build
npm --prefix tools/ppops-payer run privacy:check
```

No ejecutar comandos de runtime sobre secretos o redes reales porque parezcan tests. Hardware/Key Ring, red, pago, replay y publicación se documentan como evidencias operativas separadas.

## 9. Aceptación, evidencia y definición de terminado

**Objetivo:** O4. **Fuentes:** E1, L2, B1, U1.

Registrar por integración:

```text
implementation: NOT_STARTED | PASS | PARTIAL | BLOCKED | SKIPPED
bounty_evidence: NOT_READY | READY | UNVERIFIED
scope: capacidad exacta comprobada
commit:
files_and_symbols:
official_requirement:
commands_and_results:
environment: unit | simulation | fork | testnet | mainnet | real-key-ring
limits_and_missing_evidence:
time_consumed_and_R:
```

`PASS` acredita el alcance implementado, no ganar un premio. `READY` es una comprobación interna de evidencia de requisitos publicados, no certificación del sponsor. Ejemplos:

- Key Ring mockeado en tests, sin uso real: evidencia Ledger no lista.
- Demo normal con clave aleatoria: no demuestra Ledger.
- Adapter con A/B empatado: puede ser `PASS / NOT_READY` para el track elegido.
- Swap público completado: no prueba shield ni pago privado.
- Una función sin todos sus consumidores cubiertos: `PARTIAL`, no integración terminada.

Documentos mínimos, actualizados solo para trabajo realizado:

- `docs/ethonline/STATUS.md`: gates, reloj, pruebas, limitaciones y mapa requisito→código→evidencia.
- `CONTINUITY.md`: preevento, trabajo anterior de este evento y trabajo de esta entrega separados; SHAs y diff reales.
- `FEEDBACK.md`: versiones, fricciones y mejoras observadas de sponsors efectivamente usados.
- `AI_USAGE.md`: herramientas, archivos asistidos, prompts/spec y aportación humana. Incluir este plan como especificación.
- Un runbook por integración activa, sin documentos ceremoniales para candidatos descartados.

**Antes de congelar:** baseline compatible, tests relevantes ejecutados, ausencia de filtraciones en evidencia, revisión humana del diff y capacidad para repetir la demo. Si no se cumple, mantener rama sin merge y describir la limitación honestamente.

## 10. Submission y orden final al agente

**Objetivo:** O4. **Fuentes:** E1 y anuncio oficial aportado por Daniel.

Después de congelar: solo correcciones bloqueantes, documentación, video y envío. Daniel confirma equipo/stake/Continuity y selecciona hasta tres partners, sin obligación de completar tres. Video 2–4 minutos, mínimo 720p, voz humana, mejora nueva visible y archivo subido según el dashboard/anuncio. No sustituirlo por un enlace externo ni afirmar pagos no ejecutados.

Para Ledger, mostrar fuente seleccionada y operación con Key Ring real; para Bazantic, funcionamiento y comparación completa; para Uniswap, solo el alcance realmente completado. No enseñar secretos, calldata privada, IDs de producción ni respuestas administrativas completas.

**Orden ejecutable:**

> Lee este plan y ejecuta G0. Devuelve como máximo diez líneas con SHA local, baseline ejecutado, R, gates y una integración principal. No vuelvas a diseñar el producto ni a redactar otra versión. Si Ledger pasa L0, implementa L1–L5 completos; si no, no escribas stubs. Bazantic solo después de B0. Uniswap permanece bloqueado sin decisión expresa. Cita objetivo y fuente en cada entrega. Detente al cumplir la aceptación o al agotar el presupuesto. No gastes, publiques o hagas merge sin autorización.

## 11. Fuentes verificadas y trazabilidad

Los enlaces al código se fijan al SHA revisado. Las decisiones de diseño, límites, tiempos y nombres nuevos son de este plan; no se atribuyen a los sponsors.

### Código y documentación propios inspeccionados

- **C00 · SHA y fecha:** https://github.com/danelerr/ppops/commit/cfc3d408175236a56410cbfe6ef7e4e4f95018f1
- **C01 · Objetivo y responsabilidades:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/docs/PRODUCT-MODEL.md
- **C02 · Estados:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/domain.ts
- **C03 · Proyección y expiración:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/reconciliation/projection.ts
- **C04 · Conciliación y eventos:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/reconciliation/service.ts
- **C05 · Lectura/validación de secretos:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/security/secrets.ts
- **C06 · Esquema y rutas:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/config.ts
- **C07 · Arranque:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/runtime.ts
- **C08 · Diagnóstico:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/operations/doctor.ts
- **C09 · CLI, rangos de init/runtime/replay/backup/doctor:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/cli.ts
- **C10 · Ejemplo del comercio:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/examples/merchant-app.mjs
- **C11 · Receptor del piloto:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/scripts/pilot-webhook-receiver.ts
- **C12 · Recuperación:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/backup.ts
- **C13 · Demo aislada y credenciales aleatorias:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/demo.ts
- **C14 · Separación merchant/payer:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/scripts/trust-boundary-check.ts
- **C15 · API, auth y endpoint de estado:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/api/app.ts
- **C16 · Alcance del payer:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/tools/ppops-payer/README.md
- **C17 · CLI del payer, imports y comandos:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/tools/ppops-payer/src/cli.ts
- **C18 · Scripts y dependencias del daemon:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/package.json
- **C19 · Scripts y dependencias del payer:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/tools/ppops-payer/package.json
- **C20 · Errores y archivos privados:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/security/failures.ts y https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/security/private-file.ts
- **C21 · Cliente HTTP y verificación de webhook:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/src/client.ts
- **C22 · Build:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/tsconfig.build.json
- **C23 · Tests de diagnóstico inspeccionados:** https://github.com/danelerr/ppops/blob/cfc3d408175236a56410cbfe6ef7e4e4f95018f1/test/user-journeys.test.ts . También se verificó el inventario de los nombres de tests mencionados, sin ejecutar sus suites.

### Documentación oficial externa

- **E1 · ETHGlobal, deadline, Continuity, partners, video y uso de IA:** https://ethglobal.com/events/ethonline2026/info/details
- **L1 · Wallet CLI / Key Ring, red, stdin/stdout y contraseñas:** https://developers.ledger.com/docs/ai-tools/ledger-cli
- **L2 · Ledger × ETHOnline, Continuity y feedback obligatorio:** https://developers.ledger.com/ethonline
- **B1 · Bazantic, requisitos del track Continuity:** https://ethglobal.com/events/ethonline2026/prizes — sección “Help an Agent Use Your Hackathon Project”.
- **U1 · Uniswap Continuity y requisitos:** https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation
- **U2 · Referencia oficial de swaps, comprobar versión durante U0:** https://developers.uniswap.org/docs/trading/swapping-api/getting-started
- **U3 · RAILGUN cross-contract calls, patrón general, no prueba de compatibilidad de PPOps:** https://docs.railgun.org/developer-guide/wallet/transactions/cross-contract-calls

**Pendiente de acceso técnico, no sustituir por suposiciones:** https://bazantic.com/docs/recipes y https://bazantic.com/docs/deploy-a-gateway . Los intentos de lectura fallaron; esto no prueba que la plataforma esté caída. B0 exige comprobar el mecanismo realmente disponible antes de invertir en esa integración.
