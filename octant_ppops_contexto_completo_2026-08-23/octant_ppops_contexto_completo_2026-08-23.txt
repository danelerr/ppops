# Contexto maestro: Octant Epoch 13 y PPOps

**Fecha de corte:** 23 de agosto de 2026  
**Propósito:** conservar en un solo documento todo el contexto estratégico, conceptual, técnico y operativo desarrollado en la conversación sobre Octant Epoch 13 y PPOps.  
**Estado del proyecto al momento del corte:** ideación avanzada; todavía sin una implementación pública de PPOps confirmada en esta conversación.

> Este archivo es un **context pack estructurado y exhaustivo**, pensado para continuar el proyecto en otra conversación, compartirlo con colaboradores o convertirlo en especificaciones, issues y entregables. No contiene razonamiento privado interno; conserva las conclusiones, argumentos, decisiones, alternativas, dudas y planes expresados de forma visible en la conversación.

---

## 1. Origen estratégico de la oportunidad

Daniel ha venido trabajando y conversando sobre:

- Grants y mecanismos de financiación de bienes públicos.
- Investigación técnica y criptoeconómica, especialmente en Avalanche.
- Cómo integrarse a comunidades y organizaciones como ETHLabs.
- Cómo construir una voz propia dentro de Ethereum.
- Cómo contribuir a CROPS: censorship resistance, open source, privacy y security.
- Desarrollo de infraestructura blockchain, investigación aplicada, escritura técnica y artículos.
- Cómo construir una autoría técnica identificable y no limitarse a participar en hackathons o aplicar a grants con productos genéricos.

La llegada de **Octant Epoch 13 — The Privacy Round** se percibió como una oportunidad especialmente adecuada para convertir ese trabajo acumulado en una contribución con autoría pública y verificable.

La intención no era únicamente “aplicar a un grant”, sino encontrar un problema de privacidad suficientemente importante para Ethereum, construir una solución abierta y dejar evidencia de autoría mediante:

- Especificaciones públicas.
- Código abierto.
- Historial de commits.
- Releases firmados.
- Test vectors.
- Integraciones externas.
- Adopción verificable.
- Artículos técnicos derivados del trabajo real.

La tesis de autoría que surgió fue:

> **La privacidad no termina en el settlement.**

Incluso cuando una transferencia utiliza una rail privada, una dirección stealth o un pool shielded, la privacidad puede romperse en la operación que la rodea: invoice, checkout, URL, logs, RPC, scanner, reconciliación, webhook, receipt, ERP, refund o consolidación posterior de fondos.

---

## 2. Octant Epoch 13 — información del round

### 2.1 Nombre

**Epoch 13 — The Privacy Round**

### 2.2 Organizador

**Octant**

### 2.3 Tema

Financiación de proyectos que impulsen la privacidad en:

1. **Ethereum**
   - Private transfers.
   - Shielded pools.
   - Wallet privacy.
   - RPC privacy.
   - Encrypted mempools.
   - Zero-knowledge tooling.

2. **Open Internet**
   - Secure messaging.
   - Metadata-protecting communication.
   - Private compute hardware.
   - Privacy libraries.

### 2.4 Matching pool

**100 ETH** bajo un mecanismo de Quadratic Funding.

### 2.5 Fechas

- **Application deadline:** 10 de septiembre de 2026.
- **Epoch Accelerator:** 6–10 de octubre de 2026.
- **Allocation Window:** 14–21 de octubre de 2026.

### 2.6 Perfil de proyecto buscado

Octant declara que busca principalmente:

- Software o hardware funcionando.
- Proyectos con tracción existente.
- Privacidad como propiedad central, no accesoria.
- Código crítico de privacidad open source.
- Código construible y verificable independientemente.
- Usuarios verificables.

La investigación aplicada puede calificar cuando un cliente, aplicación o red verificable ya adoptó o respaldó el trabajo.

### 2.7 Criterios de elegibilidad

- Contribuir al uso privado de Ethereum y/o Internet.
- Tener privacidad como propiedad fundamental.
- Mantener el código crítico bajo una licencia reconocida.
- Permitir build y verificación independiente del código crítico.
- Basarse en software o hardware funcional con usuarios verificables.

### 2.8 Criterios de exclusión

- Privacidad como feature secundaria.
- Estado pre-launch.
- Ausencia de tracción verificable.
- Foco principal en comunidad, eventos o contenido.
- Núcleo cerrado.
- Trabajo cripto que no sirva a Ethereum.
- Monetización basada en debilitar privacidad o crear lock-in.

### 2.9 Criterios de evaluación

1. Tracción verificable.
2. Camino creíble para convertir el funding del epoch en impacto.
3. Potencial de valor público amplio y de largo plazo.
4. Innovación técnica e importancia estratégica para el roadmap de Ethereum.

Se indicó que haber recaudado más de USD 1 millón equivalente en los últimos 12 meses no descalifica automáticamente, pero sí influye en la evaluación del impacto marginal del funding.

### 2.10 Requisitos para proyectos aceptados

- Completar KYC/KYB antes del inicio del round.
- Participar virtualmente en el Epoch Accelerator.
- Comunicar activamente el proyecto durante el round.
- Movilizar comunidad genuina, dado que la asignación depende de Quadratic Funding.

### 2.11 Enlaces originales proporcionados

- Formulario: https://octant.fillout.com/epoch-13
- Anuncio: https://octant.substack.com/p/epoch-13-the-privacy-round
- CROPS / EF mandate: https://blog.ethereum.org/2026/03/13/ef-mandate

---

## 3. Pregunta central que debía resolver el proyecto

No bastaba con construir “algo de privacidad”. La pregunta central fue:

> ¿Qué problema importante de privacidad dentro de Ethereum todavía no está suficientemente resuelto, puede convertirse en software real antes del deadline y permite construir una autoría técnica propia?

Se descartó depender únicamente de:

- Un artículo.
- Un proyecto de contenido.
- Una investigación sin adopción.
- Una feature privada añadida a otro producto.
- Un concepto pre-launch.

La solución debía mostrar:

- Utilidad concreta.
- Diferenciación real.
- Integrabilidad.
- Privacidad verificable.
- Software abierto.
- Tracción antes de postular.

---

## 4. Evolución de PPOps

## 4.1 Primera formulación

El nombre propuesto fue:

# PPOps — Private Payment Operations for Ethereum

Tagline conceptual:

> **An open, local-first operations layer for private Ethereum payments.**

La tesis inicial:

> Las rails privadas protegen el settlement, pero la privacidad suele romperse en el checkout, metadata, RPC, scanner, invoice, webhook, receipt y reconciliación.

PPOps se planteó como una capa operacional que evitaría que la privacidad desaparezca después de usar una rail privada.

La primera versión conceptual incluía:

- Private Payment Request Envelope.
- Adaptadores de rails privadas.
- Local-first reconciler.
- Sealed Payment Events.
- Receipts y recuperación.
- Privacy Conformance Suite.

En ese momento se planteó inicialmente **Arbitrum One** y se mencionó otro producto como primera implementación de referencia.

## 4.2 Cuestionamiento de Arbitrum y separación de otros proyectos

Daniel cuestionó correctamente:

- ¿Por qué Arbitrum One?
- ¿Qué es PPOps como producto en pocas palabras?
- ¿Por qué mencionar otro proyecto si PPOps debe ser independiente?
- ¿Ethereum realmente lo necesita?
- ¿Quién lo integraría?

La corrección fue:

- Arbitrum One no era esencial.
- La elección estaba heredada de infraestructura previa, no de una necesidad fundamental de PPOps.
- PPOps debe ser **Ethereum/EVM-native y chain-agnostic**.
- La primera red se decide según el primer integrador y la rail usada.
- PPOps debe presentarse como proyecto independiente.
- No debe depender narrativamente de Parmelia ni usarla como argumento de elegibilidad.

Decisión vigente:

> **PPOps es un proyecto independiente. Parmelia no debe ocupar un lugar central en su propuesta ni en la aplicación, salvo que en el futuro exista una integración explícita y relevante que se quiera declarar con total honestidad.**

## 4.3 Corrección de producto: no construir otro gateway completo

Se detectó que varios componentes de la idea original ya tienen cobertura parcial en el ecosistema:

- Facturas y payment requests.
- Links de pago.
- Reconciliación.
- Payment detection.
- Private payment requests.
- Stealth addresses.
- Shielded transfers.
- Receipts cifrados.
- Payment pages.

Por tanto, reconstruir un gateway completo sería demasiado amplio y duplicaría trabajo existente.

La formulación más defendible pasó a ser:

> **PPOps conecta rails privadas de Ethereum con invoices, reconciliación y software comercial.**

O aún más concreta:

> **PPOps es un adaptador y reconciliador autohospedable para aceptar y confirmar pagos privados de Ethereum.**

## 4.4 Formulación actual recomendada

PPOps no sería:

- Una wallet.
- Un mixer.
- Un nuevo privacy pool.
- Un procesador custodial.
- Un dashboard comercial completo.
- Un nuevo sistema de facturación.
- Un protocolo monolítico que reinvente todo el payment stack.

PPOps sería:

> **La capa de interoperabilidad entre las privacy rails y el software que necesita saber qué invoice, pedido o suscripción fue pagado.**

Flujo transversal:

```text
Invoice / order / payment request
              │
              ▼
     PPOps payment intent
              │
              ▼
  Private payment descriptor
              │
              ▼
   RAILGUN / otra privacy rail
              │
              ▼
    PPOps local reconciler
              │
              ▼
       payment.confirmed
              │
              ▼
 Merchant backend / ERP / app
```

---

## 5. Explicación sencilla del producto

### En una frase

> **PPOps hace que los pagos privados de Ethereum puedan utilizarse en aplicaciones y negocios reales.**

### Explicación breve

Hoy puede existir una transferencia privada, pero el sistema todavía necesita saber:

- Qué factura se pagó.
- Qué pedido debe completarse.
- Si llegó el monto correcto.
- Qué moneda se recibió.
- Si el pago expiró.
- Cuándo enviar una confirmación.

Normalmente, al resolver eso, se vuelve a exponer información sensible.

PPOps permite:

1. Crear una solicitud de pago.
2. Vincularla a una referencia privada.
3. Recibir el pago mediante una rail privada.
4. Detectarlo localmente.
5. Confirmar el pago al sistema del comercio.
6. Evitar publicar o entregar innecesariamente la relación:

```text
cliente ↔ comercio ↔ factura ↔ wallet ↔ settlement
```

### Comparación intuitiva

Una analogía utilizada fue:

> **“BTCPay Server para operaciones de pagos privados sobre Ethereum.”**

Sin embargo, la versión inicial no debería intentar reproducir todo BTCPay. Debe centrarse sólo en:

- Payment intent.
- Private settlement.
- Detection.
- Reconciliation.
- Confirmation event.

---

## 6. ¿Ethereum necesita PPOps?

La conclusión fue matizada:

### Sí existe el problema

Ethereum necesita que la privacidad sea end-to-end, no limitada al contrato o a la prueba ZK. Las filtraciones pueden ocurrir en:

- RPC.
- Sesiones del navegador.
- Logs.
- Analytics.
- Paymasters.
- Checkouts.
- Scanners alojados.
- Payment processors.
- Webhooks.
- Sistemas de conciliación.
- Movimientos posteriores de fondos.

### Pero no necesita necesariamente otro gateway monolítico

La necesidad real es:

> **Una capa interoperable que permita integrar privacidad en sistemas de pagos existentes sin obligarlos a reconstruir toda su infraestructura.**

Veredicto expresado:

- Gateway general completamente nuevo: necesidad dudosa y mucha duplicación.
- Private-settlement adapter estándar: tesis fuerte.
- Conformance suite sola: útil, pero quizá insuficiente como producto.
- Adaptador + detector local + reconciliación + pruebas de privacidad: mejor opción.

---

## 7. Integradores y usuarios potenciales

Ninguno de los siguientes es un partnership confirmado. Son candidatos naturales que deben validarse mediante conversaciones e integraciones reales.

## 7.1 Request Network

Se identificó como candidato principal porque ya tiene:

- Invoices/payment requests.
- Payment networks/extensions.
- Payment detection.
- Reconciliación.
- SDKs.
- Infraestructura extensible.

PPOps podría implementar un adaptador tipo:

```text
@ppops/request-network
```

Flujo deseado:

```text
Request invoice
      │
      ▼
PPOps private settlement descriptor
      │
      ▼
RAILGUN payment
      │
      ▼
PPOps detection + matching
      │
      ▼
Request marked paid
```

La ventaja estratégica es que PPOps no tendría que reinventar invoices, stakeholders ni estados comerciales; resolvería únicamente la liquidación privada y su detección.

## 7.2 Kohaku y wallets de privacidad

Kohaku y wallets orientadas a privacidad podrían usar PPOps como contraparte del lado receptor/comercio:

- La wallet interpreta la solicitud.
- El usuario elige una rail privada.
- El pago se ejecuta.
- PPOps confirma el settlement al comercio.

PPOps no debería competir creando otra wallet.

## 7.3 RAILGUN, Privacy Pools, ERC-5564, Fluidkey y otras rails

Estas tecnologías pueden ser:

- Rails integradas.
- Adaptadores.
- Adopters.
- Competidores parciales.

Una privacy rail suele resolver:

- Send privately.
- Receive privately.
- Shield/unshield.
- Private balances.

Pero no necesariamente resuelve:

- Qué pedido fue pagado.
- Si el monto coincide.
- Si la invoice expiró.
- Cómo manejar reorgs.
- Qué evento recibe un ERP.
- Cómo procesar refunds.
- Cómo generar evidence/receipt.

PPOps cubriría ese límite operacional.

## 7.4 DePay, WooCommerce y commerce plugins

Gateways o plugins comerciales podrían añadir un payment method privado sin reemplazar todo su checkout.

Ejemplo:

```text
Payment method
○ Standard onchain payment
● Private Ethereum payment via PPOps
```

## 7.5 Casos de usuario final

Los casos más fuertes identificados fueron:

### B2B

Ocultar públicamente:

- Proveedores.
- Clientes.
- Montos.
- Flujo de caja.
- Relaciones comerciales.

### Payroll y contributors

Evitar publicar:

- Salarios.
- Relación organización–trabajador.
- Todas las wallets de contributors.

### Donaciones

Proteger la relación entre donante y organización.

### Freelancers/profesionales

Evitar que todos los clientes queden vinculados a una sola wallet pública.

### SaaS y aplicaciones

Confirmar una suscripción o acceso sin entregar el grafo de clientes a un procesador externo.

---

## 8. Decisión sobre red

### Decisión original

Se propuso Arbitrum One por:

- Costos bajos.
- Compatibilidad EVM.
- Cercanía con infraestructura ya conocida.

### Corrección

No existe una razón fundamental para que PPOps dependa de Arbitrum.

### Decisión vigente

> **El protocolo y SDK deben ser chain-agnostic.**

La primera red debe elegirse según:

- Primera rail viable.
- Primer adopter.
- Costos de pruebas reales.
- Disponibilidad de stablecoins.
- Soporte técnico del SDK.
- Calidad del RPC/indexing.
- Facilidad para usuarios beta.

No debe usarse la red como parte central de la identidad del proyecto.

---

## 9. Stack técnico recomendado

La propuesta técnica final se hizo más concreta el 23 de agosto de 2026.

## 9.1 Resumen

| Capa | Tecnología | Función |
|---|---|---|
| Lenguaje | TypeScript | Lenguaje principal |
| Monorepo | pnpm workspaces + Turborepo | Organización de packages/apps |
| Runtime | Node.js LTS | PPOps Node/reconciler |
| API | Hono + Zod + OpenAPI | API local/autohospedada |
| Privacy rail v0.1 | RAILGUN Wallet SDK | Pago privado y scanning |
| Wallet | RAILGUN View-Only Wallet | Reconciliación sin spending key |
| Storage RAILGUN | LevelDB/LevelDOWN | Estado requerido por el engine |
| Storage PPOps | SQLite + Drizzle ORM | Intents, references, settlements, estados |
| EVM client | viem | Lecturas y tipos EVM propios |
| Integración inicial | Request Network SDK | Primer adapter comercial |
| Event encryption | HPKE | Webhooks/eventos cifrados |
| Tests unitarios | Vitest | Core, adapters, crypto, state machine |
| E2E | Playwright | Demo y flujos completos |
| Packaging | Docker + Docker Compose | Instalación reproducible |
| CI/CD | GitHub Actions + GHCR | Tests, images, releases |
| Demo | React + Vite | UI mínima de demostración |
| Solidity propio | Ninguno inicialmente | Evitar contratos y criptografía innecesarios |

## 9.2 Decisión clave: no crear contratos propios en v0.1

Razones:

- Reduce superficie de ataque.
- Evita auditoría de contratos nuevos.
- Evita crear criptografía apresurada.
- Permite llegar a beta antes del deadline.
- Reutiliza infraestructura privada existente.
- Centra la innovación en operaciones/reconciliación.

---

## 10. Arquitectura propuesta

```text
                    ┌─────────────────────────┐
                    │       PPOps Node        │
                    │                         │
Invoice/App ───────►│  Payment Intent Engine  │
                    │            │            │
                    │            ▼            │
                    │   Commitment/Intent DB  │
                    │            ▲            │
                    │            │            │
                    │   Privacy Rail Scanner  │
                    │            │            │
                    │            ▼            │
                    │    Settlement Matcher   │
                    │            │            │
                    │            ▼            │
                    │   Event/Webhook Engine  │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    Merchant backend / ERP

                       payment.confirmed
```

## 10.1 Componentes

### Payment Intent Engine

Crea una solicitud de pago local con:

- Amount.
- Token.
- Chain.
- Expiry.
- External reference local.
- Rail.
- Privacy reference/commitment.

### Commitment/Intent Database

Guarda la relación privada entre:

- Payment intent ID.
- Invoice/order/customer reference.
- Random salt.
- Commitment.
- Expected amount/token.
- Status.

La referencia comercial permanece local.

### Privacy Rail Adapter

Interfaz genérica para:

- Crear un descriptor de pago.
- Sincronizar una wallet/view key.
- Detectar incoming settlements.
- Leer/decryptar metadata privada.
- Normalizar settlement data.

### Settlement Matcher

Valida:

- Commitment/reference.
- Token.
- Amount.
- Chain.
- Expiry.
- Confirmations/finality.
- Replay/idempotency.

### Event Engine

Emite:

- `payment.detected`.
- `payment.confirmed`.
- `payment.failed`.
- `payment.expired`.
- `payment.reverted`.

Puede entregar eventos:

- Directamente al backend local.
- Mediante webhook firmado.
- Mediante webhook cifrado con HPKE.

---

## 11. Payment intent y commitment

Ejemplo conceptual:

```text
invoice_id = INV-9248
amount     = 500 USDC
salt       = randomBytes(32)
```

Se calcula:

```text
commitment = keccak256(
  "ppops:v1" ||
  invoice_id ||
  salt
)
```

La base local mantiene:

```text
0xabc123... → INV-9248
```

La blockchain o rail no recibe `INV-9248` en texto claro.

## 11.1 Requisitos del commitment

- Domain separation (`ppops:v1`).
- Salt criptográficamente aleatorio.
- Canonical encoding.
- Versioning.
- Prevención de dictionary attacks.
- No incluir información predecible sin salt.
- Test vectors públicos.

## 11.2 Referencia privada mediante memo

Para RAILGUN se propuso utilizar un memo cifrado:

```text
ppops:v1:<commitment>
```

El pago privado contendría:

```text
recipient: merchant 0zk address
amount:    expected token amount
memo:      ppops:v1:0xabc123...
```

PPOps descifra el memo localmente mediante la viewing capability del receptor y lo vincula al intent.

---

## 12. View-only architecture

Una decisión técnica central es que el PPOps Node no debe controlar spending keys.

Arquitectura:

```text
Merchant private wallet
    │
    ├── Spending key ─────► hardware/offline/merchant-controlled environment
    │
    └── Viewing key ──────► PPOps Node
```

El PPOps Node puede:

- Escanear incoming private notes.
- Ver balances/historial permitido por la viewing key.
- Descifrar memos y referencias.
- Reconciliar invoices.

No puede:

- Crear una transacción de gasto.
- Mover fondos.
- Firmar retiros.

Esto reduce el riesgo custodial y fortalece la narrativa de privacidad/seguridad.

---

## 13. Flujo de detección

```text
1. Privacy rail engine sincroniza estado
                     │
                     ▼
2. Encuentra incoming private note
                     │
                     ▼
3. Viewing key descifra note + memo
                     │
                     ▼
4. PPOps extrae ppops:v1:<commitment>
                     │
                     ▼
5. Busca commitment en SQLite
                     │
                     ▼
6. Verifica token, amount, expiry, chain, finality
                     │
                     ▼
7. pending → detected → confirmed
                     │
                     ▼
8. Emite payment.confirmed
```

## 13.1 State machine mínima

```text
created
  │
  ▼
pending
  │
  ├──► expired
  │
  ├──► cancelled
  │
  ▼
detected
  │
  ├──► invalid_amount
  │
  ├──► invalid_asset
  │
  ├──► reverted
  │
  ▼
confirmed
```

Debe existir idempotencia para evitar confirmar dos veces el mismo settlement.

---

## 14. API mínima

No se recomienda construir una API extensa antes de Octant.

### Endpoints propuestos

```http
POST /v1/intents
GET  /v1/intents/:id
GET  /v1/intents/:id/status

POST /v1/webhooks
GET  /v1/health
```

### Crear intent

```json
{
  "amount": "500000000",
  "token": "USDC",
  "rail": "railgun",
  "externalReference": "INV-9248"
}
```

### Respuesta

```json
{
  "id": "pi_01...",
  "amount": "500000000",
  "token": "USDC",
  "status": "pending",
  "payment": {
    "rail": "railgun",
    "recipient": "0zk...",
    "memo": "ppops:v1:0xabc123..."
  }
}
```

`externalReference` permanece en almacenamiento local y no debe aparecer en:

- Public calldata.
- Logs públicos.
- URLs.
- Analytics.
- RPC queries innecesarias.
- Relay de webhooks.

---

## 15. Interfaz genérica de rail

El core debe evitar dependencia directa de RAILGUN.

Ejemplo:

```ts
interface PaymentRail {
  createPayment(intent: PaymentIntent): Promise<PaymentDescriptor>
  sync(): Promise<void>
  getSettlements(): Promise<Settlement[]>
}
```

Implementación inicial:

```ts
class RailgunPaymentRail implements PaymentRail
```

Futuras implementaciones posibles:

```ts
class ERC5564PaymentRail implements PaymentRail
class PrivacyPoolsPaymentRail implements PaymentRail
class OtherShieldedRail implements PaymentRail
```

Esto constituye la transversalidad principal del proyecto.

---

## 16. Estructura del monorepo

```text
ppops/
│
├── apps/
│   ├── node/
│   └── demo/
│
├── packages/
│   ├── core/
│   ├── railgun/
│   ├── request-network/
│   ├── crypto/
│   ├── sdk/
│   └── cli/
│
├── specs/
│   ├── PPO-001-payment-intent.md
│   ├── PPO-002-settlement-reference.md
│   ├── PPO-003-threat-model.md
│   ├── PPO-004-private-events.md
│   └── PPO-005-conformance.md
│
├── docker/
├── examples/
├── tests/
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CITATION.cff
└── README.md
```

### Packages

#### `@ppops/core`

- `PaymentIntent`.
- `Settlement`.
- `PaymentRail`.
- `PaymentStatus`.
- `SettlementMatcher`.
- `Commitment`.
- State machine.

#### `@ppops/railgun`

- Engine bootstrap.
- View-only wallet loading.
- Sync.
- Incoming note normalization.
- Memo parsing.
- Settlement adapter.

#### `@ppops/request-network`

- Map Request invoice/payment request to PPOps intent.
- Map PPOps confirmed settlement back to Request state/detection.

#### `@ppops/crypto`

- Commitment encoding.
- HPKE utilities.
- Signatures.
- Key rotation.
- Replay protection.

#### `@ppops/sdk`

- Client for external apps.
- Typed API.
- Intent creation/status.

#### `@ppops/cli`

- `ppops init`.
- `ppops start`.
- `ppops doctor`.
- `ppops privacy:test`.
- `ppops export` / `ppops recover`.

---

## 17. Request Network adapter

Request Network se mantiene como candidato a primera integración seria, pero no como bloqueo para desarrollar el core.

Orden recomendado:

1. Hacer funcionar PPOps con intents propios.
2. Tener pago privado + detection + matching.
3. Añadir adapter de Request Network.
4. Abrir issue/PR/discusión pública.
5. Conseguir revisión o adopter externo.

El adapter debe demostrar:

```text
Request invoice
      ↓
PPOps intent
      ↓
Private settlement descriptor
      ↓
Private payment
      ↓
PPOps match
      ↓
Request invoice paid
```

No se debe afirmar partnership sin confirmación explícita.

---

## 18. Webhooks y eventos privados

La primera versión puede emitir webhooks firmados. La versión fuerte para Octant debe intentar evitar que un relay alojado lea la metadata.

## 18.1 Evento plaintext tradicional que se quiere evitar

```json
{
  "invoice": "INV-9248",
  "customer": "John",
  "amount": 500
}
```

## 18.2 Sealed event

Envelope conceptual:

```json
{
  "protocolVersion": "1",
  "eventId": "evt_01...",
  "sequence": 14,
  "timestamp": 178..., 
  "keyId": "merchant-key-2026-08",
  "paddedCiphertext": "...",
  "reconcilerSignature": "..."
}
```

Payload cifrado:

```json
{
  "type": "payment.confirmed",
  "intentId": "pi_01...",
  "externalReference": "INV-9248",
  "amount": "500000000",
  "token": "USDC",
  "settlement": "..."
}
```

### Requisitos

- HPKE mediante librería madura.
- Version pinning.
- Nonce safety.
- Additional authenticated data.
- Replay protection.
- Event ID único.
- Sequence monotónica.
- Padding.
- At-least-once delivery.
- Dedupe.
- Key rotation.
- Camino self-hosted sin relay obligatorio.

Se mencionó específicamente no usar versiones vulnerables antiguas de implementaciones HPKE y fijar una versión corregida en lockfile.

---

## 19. Privacy guarantees y threat model

El archivo `docs/THREAT-MODEL.md` se considera obligatorio.

## 19.1 Invariantes propuestas

### I. Key non-exportability

Las spending keys no entran al PPOps Node. Las viewing keys permanecen dentro del entorno controlado por el merchant.

### II. Commercial-reference confidentiality

No se publica en texto plano:

- Invoice ID.
- Order ID.
- Customer ID.
- Email.
- Internal reference.

### III. Processor blindness

Un servicio alojado no debe poder reconstruir fácilmente:

```text
payer ↔ merchant ↔ invoice ↔ settlement
```

### IV. Independent recovery

El merchant puede reconstruir estado desde software público, backups y viewing/recovery material sin depender de un proveedor.

### V. Honest privacy claims

Cada rail declara qué protege y qué sigue observable.

### VI. No mandatory intermediary

Debe existir un camino local/self-hosted.

### VII. Automated verifiability

Las propiedades de privacidad deben tener pruebas reproducibles.

## 19.2 Qué protege PPOps

- Invoice/order/customer references frente a exposición pública.
- Merchant payment graph frente a procesadores innecesarios.
- Metadata operacional.
- Reconciliación local.
- Separación entre viewing y spending capability.
- Webhook/event confidentiality cuando se usa HPKE.

## 19.3 Qué no promete resolver

- Máquina del merchant comprometida.
- Merchant que revela voluntariamente datos.
- Adversario global de timing.
- Vulnerabilidades heredadas de la rail.
- Privacidad absoluta de amount/asset si la rail no los oculta.
- Privacidad de red completa si se usa un RPC observador.
- Unlinkability después de cualquier comportamiento de gasto.
- Endpoint comprometido del pagador.

## 19.4 Actores que deben analizarse

- Payer.
- Merchant.
- PPOps Node.
- RPC provider.
- Privacy rail.
- Relay.
- Blockchain observer.
- Merchant backend.
- External processor.

El threat model debe explicar qué conoce cada actor.

---

## 20. Privacy Manifest

Cada adapter debería publicar una descripción legible por máquinas:

```json
{
  "recipientIdentity": "hidden",
  "senderIdentity": "rail-dependent",
  "amount": "rail-dependent",
  "asset": "rail-dependent",
  "timing": "observable",
  "rpcStrategy": "local-sync",
  "processorSeesMetadata": false,
  "spendingKeyInNode": false,
  "postSpendUnlinkability": "not-guaranteed"
}
```

Objetivo:

- Evitar marketing engañoso.
- Permitir comparar rails.
- Automatizar tests.
- Documentar límites.

---

## 21. Privacy Conformance Suite

Se propuso como posible contribución estratégica de alto valor público.

Comando:

```bash
pnpm privacy:test
```

Salida conceptual:

```text
PPOps Privacy Conformance v0.1

✓ invoice ID absent from calldata
✓ invoice ID absent from public logs
✓ customer ID absent from public logs
✓ settlement reference encrypted
✓ PPOps node contains no spending key
✓ webhook payload encrypted
✓ recovery succeeded
✓ replay rejected

8/8 PASS
```

### Pruebas posibles

- Canaries de invoice/customer IDs.
- Inspección de calldata/logs.
- Intercepción de requests de navegador.
- Proxy JSON-RPC.
- Verificación de terceros/analytics en checkout.
- Replay tests.
- Event padding.
- Recovery from clean environment.
- Confirmation idempotency.
- No spending key in process/environment.
- No plaintext metadata in relay.
- Reorg handling.

### Tooling sugerido

- Vitest.
- Playwright.
- Local proxy/recorder.
- JSON/SARIF report.
- GitHub Action.

---

## 22. Código abierto, licencias y verificabilidad

### Recomendación

- **Apache-2.0** o MIT para código.
- **CC0-1.0** para especificaciones/test vectors, si se separan.

### Archivos obligatorios

- `LICENSE`.
- `SECURITY.md`.
- `CONTRIBUTING.md`.
- `CITATION.cff`.
- `README.md`.
- Build instructions.
- Threat model.
- Privacy manifest.
- Test vectors.

### Verificabilidad

Otra persona debe poder ejecutar:

```bash
git clone ...
docker compose up
```

Y reproducir:

- Node running.
- Intent creation.
- Private payment detection.
- Matching.
- Confirmation event.

Idealmente se añaden:

- Signed release.
- Checksums.
- SBOM.
- GHCR image.
- Pinned dependencies.
- Reproducible build notes.

---

## 23. Producto mínimo para dejar de estar en ideación

El primer milestone debe ser muy concreto:

```text
Payer
  │
  │ private 1 USDC transfer
  ▼
Privacy rail
  │
  │ encrypted memo:
  │ ppops:v1:0xa84...
  ▼
PPOps Node
  │
  ├── decrypt
  ├── match
  ├── validate
  └── confirm
        │
        ▼
┌────────────────────────┐
│ pi_019a...              │
│ 1 USDC                  │
│ PAID ✓                  │
│ invoice: local only     │
└────────────────────────┘
```

Cuando ese flujo funciona end-to-end, PPOps deja de ser únicamente ideación.

---

## 24. Qué sí desarrollar antes de Octant

Orden recomendado:

1. Inicializar RAILGUN engine en Node.
2. Configurar una view-only wallet.
3. Sincronizar incoming private transfers.
4. Leer/decryptar memos.
5. Crear `PaymentIntent` y commitment.
6. Guardar/matchear en SQLite.
7. Implementar state machine.
8. API REST mínima.
9. Webhook firmado.
10. Docker y documentación.
11. Tests unitarios y E2E.
12. Request Network adapter.
13. HPKE sealed events.
14. Privacy conformance tests.
15. Demo real.
16. Primer adopter externo.

---

## 25. Qué no desarrollar antes de Octant

No gastar el tiempo inicial en:

- Nuevos circuitos ZK.
- Contratos Solidity propios.
- Nuevo privacy pool.
- Nuevo token.
- Governance.
- Dashboard SaaS complejo.
- Login/account system.
- Mobile app.
- Swaps privados.
- Cross-chain.
- Cinco redes.
- Cinco privacy rails.
- Account abstraction.
- Kubernetes.
- Diseño visual sofisticado.
- ERC formal prematuro.
- Infraestructura custodial.

Regla de alcance:

> **Un rail, una red piloto, un flujo, una integración y una prueba de privacidad.**

---

## 26. ¿Hasta dónde debe llegar PPOps para que Octant lo considere?

Octant no publica una cifra mínima de usuarios. Los siguientes thresholds son objetivos internos propuestos para reducir el riesgo de rechazo, no requisitos oficiales.

## 26.1 Definition of Done central

> **Una persona externa puede instalar PPOps, crear una solicitud de pago, recibir un pago privado real, ver cómo PPOps lo reconcilia automáticamente y recibir `payment.confirmed`, sin intervención manual del equipo.**

## 26.2 Requisitos no negociables

### Software

- Repo público.
- Licencia reconocida.
- Release `v0.1.0`.
- Docker funcional.
- Build reproducible.
- Flujo privado real end-to-end.
- Reconciliación automática.
- API utilizable.
- Threat model.
- Privacy tests.
- Documentación suficiente.

### Tracción

Mínimo razonable interno:

- 5 usuarios externos genuinos.
- 20+ operaciones privadas/reconciliaciones.
- 1 adopter/integrador independiente.

Objetivo fuerte:

- 10–20 usuarios externos.
- 30+ settlements.
- 2 integraciones independientes.
- Al menos una revisión o endorsement técnico externo.

### Reproducibilidad

Una persona que no participó en el desarrollo debe poder:

1. Instalar.
2. Configurar viewing credentials.
3. Crear un intent.
4. Recibir un pago.
5. Ver la conciliación.
6. Recibir el evento.

Sin necesitar scripts secretos, ayuda constante o acceso a una mnemonic del equipo.

## 26.3 Barra de postulación propuesta

| Estado | Evaluación interna |
|---|---|
| Código solamente | No postular |
| Demo local | No postular |
| Prototype usado sólo por el creador | No postular |
| GitHub + video | Insuficiente |
| Beta + 2 testers | Riesgo alto |
| Beta + 5–10 usuarios externos | Mínimo defendible |
| Beta + 10–20 usuarios + adopter | Aplicación fuerte |
| 2 adopters + integración de ecosistema | Muy fuerte |
| Lo anterior + review externo | Excelente |

### Clasificación recomendada

**Beta**, siempre que realmente exista software público usado por terceros.

No declarar Production si no corresponde.

---

## 27. Evidencia de tracción sin destruir privacidad

La tracción debe demostrarse sin publicar el grafo de pagos.

### Evidencia aceptable

- Integraciones open source.
- PRs.
- Issues públicos.
- Testimonios públicos voluntarios.
- Adopters nombrados con permiso.
- Releases.
- Package/container downloads con metodología clara.
- Instancias identificadas voluntariamente.
- Métricas agregadas.
- Review técnico.
- Reproducción independiente.

### Ejemplo de métricas

```text
PPOps v0.1 adoption

12 external testers
2 independent integrations
34 successfully reconciled settlements
3 independently operated PPOps nodes
100% conformance suite passing
```

Cada métrica debe explicar:

- Qué cuenta como usuario.
- Qué cuenta como settlement.
- Cómo se evita doble conteo.
- Qué parte se puede verificar.
- Qué datos no se recolectan.

### No hacer

- Self-transfers presentados como usuarios.
- Wallet sybil.
- Reembolsar contribuciones.
- Comprar apoyo.
- Inflar descargas.
- Exponer datos sensibles para probar tracción.

---

## 28. Calendario acordado

Fecha de corte: **23 de agosto de 2026**.

El deadline oficial es **10 de septiembre de 2026**.

Se propuso tratar el **31 de agosto** como deadline interno de ingeniería, porque terminar el software el 9 de septiembre dejaría cero tiempo para conseguir tracción.

## 28.1 23–31 de agosto: ingeniería

Objetivo:

- `v0.1.0` funcional.
- E2E real.
- Docker.
- Docs.
- Threat model.
- Tests.
- Example integration.

### Orden operativo

1. Engine y view-only wallet.
2. Incoming private transfer.
3. Memo de settlement.
4. Intent + commitment.
5. SQLite matcher.
6. API.
7. Webhook.
8. Docker.
9. Tests.
10. Request adapter.
11. HPKE y conformance si el core está estable.

## 28.2 1–6 de septiembre: adopción

Prioridad:

- Usuarios reales.
- Integradores.
- Reproducción independiente.
- Review técnico.
- Issues/PRs públicos.

## 28.3 7 de septiembre: feature freeze

Desde aquí sólo:

- Bugs.
- Seguridad.
- Documentación.
- Métricas.

## 28.4 7–8 de septiembre

- Demo.
- Evidencias.
- Review.
- Métricas.
- Privacy matrix.
- Application assets.

## 28.5 9 de septiembre

Enviar aplicación idealmente.

## 28.6 10 de septiembre

Usarlo únicamente como buffer.

---

## 29. Aplicación conceptual a Octant

La aplicación debe evitar presentar una idea aspiracional. Debe describir exactamente el software y la tracción existente al día de envío.

## 29.1 Nombre

**PPOps — Private Payment Operations**

## 29.2 Categoría conceptual

**Private payment interoperability infrastructure**

## 29.3 One-liner

> **PPOps connects private Ethereum payment rails to invoices, reconciliation and merchant software.**

## 29.4 Pitch expandido

> PPOps is an open-source, self-hostable adapter and reconciliation layer that lets applications connect invoices or payment intents to private Ethereum settlements. It detects and validates private payments locally, maps them to the correct commercial reference, and emits confirmation events without publishing invoice metadata or giving a payment processor access to spending keys or the merchant’s complete payment graph.

Este texto debe actualizarse con:

- Rail real.
- Red real.
- Release.
- Usuarios.
- Integradores.
- Métricas verificables.

## 29.5 Narrativa de impacto

Funding podría financiar:

- Security/privacy review.
- Hardening.
- Segundo adapter.
- Private reads.
- Recovery tooling.
- Conformance suite.
- Docs e integraciones.

### Funding goal discutido anteriormente

Se sugirió conceptualmente **USD 50,000**, distribuido entre:

- Review y remediación.
- Hardening y segundo rail adapter.
- Private reads/self-hosted reconciliation.
- Conformance, test vectors y docs.
- Operaciones/KYC.

Esa cifra no quedó aprobada como definitiva y debe revisarse según el estado real del proyecto.

---

## 30. Estrategia de Quadratic Funding

La campaña debe buscar muchos aportes genuinos y distribuidos, no una sola ballena.

Material recomendado:

- Demo de 90 segundos.
- Arquitectura pública.
- Threat model.
- Privacy matrix.
- Changelog.
- Artículo técnico.
- Testimonios.
- Recovery demo.
- Conformance suite ejecutable.
- Comparación honesta entre rails.
- Sesión técnica.

No hacer:

- Reembolsos de contribuciones.
- Donaciones circulares.
- Múltiples wallets coordinadas por una persona.
- Compra de votos.
- Claims de privacidad absoluta.

---

## 31. Autoría y posicionamiento dentro de Ethereum

La oportunidad de PPOps no se limita a funding.

La autoría debe registrarse mediante:

1. RFC fechado.
2. Especificaciones con Daniel como autor.
3. Historial público de commits.
4. `CITATION.cff`.
5. Releases firmados.
6. Prior-art analysis.
7. Reference implementation.
8. Test vectors.
9. Integración independiente.
10. Discusión pública con engineers.
11. Artículos derivados de software real.

Secuencia recomendada:

```text
specification
   ↓
reference implementation
   ↓
adopters
   ↓
feedback
   ↓
interoperability need
   ↓
possible ERC
```

No comenzar llamándolo ERC.

### Artículo propuesto

# Privacy Does Not End at Settlement

Subtítulo conceptual:

> The missing operational layer for private Ethereum payments.

El artículo debe explicar el problema y la arquitectura construida. No debe ser presentado como el proyecto financiable en sí mismo, porque Octant excluye proyectos centrados en contenido.

---

## 32. Prior art y mapa competitivo

Los siguientes proyectos/estándares fueron citados como referencias que PPOps debe reconocer y no reinventar. Antes de usar claims externos, se deben revalidar sus estados actuales.

### ERC-5564

- Stealth addresses.
- Announcement events.
- Metadata extensible.

Enlace: https://eips.ethereum.org/EIPS/eip-5564

### Umbra

- Stealth payments.
- Referencia relevante para recepción unlinkable.

### Fluidkey

- Direcciones de recepción privadas/rotativas.
- Payment pages.
- Labels/operations.

Enlace: https://docs.fluidkey.com/

### RAILGUN

- Shielded balances y transfers.
- Wallet SDK.
- View-only wallets.
- Private memos.

Enlaces:

- https://docs.railgun.org/developer-guide
- https://docs.railgun.org/developer-guide/wallet/private-wallets/view-only-wallets
- https://docs.railgun.org/developer-guide/wallet/transactions/private-transfers

### Privacy Pools

- Shielded pool / association-set privacy infrastructure.

### Kohaku

- Privacy-oriented wallet architecture.
- Private sends/receives/payment requests en roadmap.

Enlace: https://notes.ethereum.org/@niard/KohakuRoadmap

### Request Network

- Payment requests.
- Payment extensions/networks.
- Detection/reconciliation.

Enlaces:

- https://docs.request.network/
- https://github.com/RequestNetwork/requestNetwork

### DePay

- Commerce checkout.
- Tracking, validation, callbacks.
- WooCommerce integration.

Enlace: https://woocommerce.com/document/depay-payments/

### Mirage

- Private stablecoin payment infrastructure.

Enlace: https://github.com/MiragePrivacy

### RelAI

- Shielded payment requests/links/receipts como referencia competitiva.

### Verifiable Invoice Commitment

- Vinculación criptográfica de invoices con payments sin publicar toda la metadata.

### anon-rpc

- Private/read-oriented RPC execution and isolation concepts.

Enlace: https://github.com/privacy-ethereum/anon-rpc

### Ethereum privacy roadmap

- Private reads.
- Private writes.
- Private proving.

Enlace: https://ethereum.org/roadmap/privacy/

---

## 33. Diferenciación de PPOps

PPOps no debe reclamar haber inventado:

- Stealth addresses.
- Private transfers.
- Shielded pools.
- Private payment requests.
- Encrypted invoices.
- Payment detection.
- Private receipts.

La diferenciación defendible es:

> **PPOps estandariza y operacionaliza la conexión entre una referencia comercial privada y un settlement ejecutado por una privacy rail, mediante un reconciliador local, adapters, eventos privados, recuperación independiente y tests de conformidad.**

La combinación diferenciadora propuesta:

1. Rail-agnostic payment intent.
2. Local reconciliation.
3. View-only architecture.
4. No spending keys en el node.
5. Encrypted settlement reference.
6. Private confirmation events.
7. Privacy manifest.
8. Automated conformance.
9. Adapter a payment software existente.
10. Independent recovery.

---

## 34. Riesgos principales y mitigaciones

## 34.1 Riesgo: seguir siendo pre-launch

**Mitigación:** release pública, usuarios, settlements e integración antes de postular.

## 34.2 Riesgo: privacy como feature secundaria

**Mitigación:** PPOps independiente; privacidad es su razón de existir.

## 34.3 Riesgo: duplicar Request/Fluidkey/otros

**Mitigación:** no reconstruir invoice stack ni wallet; concentrarse en interoperability, local matching y conformance.

## 34.4 Riesgo: falta de integrador

**Mitigación:** construir adapter concreto y conseguir issue/PR/adopter/review público.

## 34.5 Riesgo criptográfico

**Mitigación:** no crear ZK ni contratos; usar primitives/libraries maduras; version pinning; external review.

## 34.6 Riesgo de overclaim

**Mitigación:** threat model, privacy manifest y non-goals.

## 34.7 Riesgo de RPC/network leakage

**Mitigación inicial:** documentar claramente; favorecer sync local/nodo propio; añadir private reads posteriormente.

## 34.8 Riesgo de comprometimiento del view-only node

Aunque no permite gastar, puede revelar metadata a un atacante local.

**Mitigación:** encrypted storage, minimal logs, hardening, key separation, OS/container guidance.

## 34.9 Riesgo de replay/double confirmation

**Mitigación:** settlement unique identifiers, idempotency, event IDs, sequence y dedupe.

## 34.10 Riesgo de reorg

**Mitigación:** estados `detected`, `confirmed`, `reverted`; configurable finality.

## 34.11 Riesgo de métricas artificiales

**Mitigación:** metodología pública y adopters independientes.

## 34.12 Riesgo de deadline

**Mitigación:** freeze de alcance; ingeniería hasta 31 de agosto; septiembre para adopción.

---

## 35. Decisiones vigentes

### Decidido

- PPOps debe ser independiente.
- No mencionar Parmelia como núcleo de la propuesta.
- Chain-agnostic a nivel de diseño.
- Primera implementación con un solo rail.
- RAILGUN es el rail técnico inicial propuesto.
- TypeScript/Node.
- View-only reconciliation.
- SQLite para intents/settlements.
- No contratos propios en v0.1.
- Request Network como primera integración ideal.
- Docker y build reproducible.
- Threat model obligatorio.
- Privacy tests/conformance altamente deseables.
- Beta real y usuarios antes del 10 de septiembre.
- Deadline interno de ingeniería: 31 de agosto.

### No decidido o pendiente de validar

- Red exacta del piloto.
- Stablecoin exacta y dirección de token.
- Primer adopter confirmado.
- Si Request Network aceptará/revisará la integración.
- Endpoint/API exactos del adapter.
- Biblioteca HPKE final.
- Método de recovery v0.1.
- Uso de hosted relay en la demo.
- Funding goal final.
- Nombre definitivo del repo/organización.
- Dominio del proyecto.
- Cantidad real de usuarios y settlements logrables.

---

## 36. North star

La demostración que debe poder hacerse en menos de dos minutos:

1. Merchant crea un payment intent con referencia local.
2. PPOps devuelve descriptor privado.
3. Payer realiza private payment.
4. PPOps Node, usando sólo viewing capability, detecta el settlement.
5. Descifra la referencia.
6. Verifica amount/token/expiry.
7. Marca el intent como `confirmed`.
8. Emite un evento al backend.
9. Se muestra que la invoice ID no está en datos públicos.
10. Se demuestra que el node no puede gastar fondos.

Mensaje final de la demo:

> **Private settlement, usable operations, no processor-owned payment graph.**

---

## 37. Checklist maestro de elegibilidad

### Producto

- [ ] El flujo end-to-end funciona.
- [ ] El pago es realmente privado según las garantías de la rail.
- [ ] La referencia comercial no aparece públicamente.
- [ ] La reconciliación es automática.
- [ ] El node no tiene spending key.
- [ ] Existe evento `payment.confirmed`.
- [ ] Existe recovery/export mínimo.

### Código

- [ ] Repo público.
- [ ] Licencia reconocida.
- [ ] Release `v0.1.0`.
- [ ] Docker/Compose.
- [ ] Instrucciones limpias.
- [ ] CI verde.
- [ ] Dependencies pinned.
- [ ] Threat model.
- [ ] Security policy.
- [ ] Test vectors.
- [ ] Conformance tests.

### Tracción

- [ ] 5+ usuarios externos genuinos.
- [ ] Idealmente 10–20.
- [ ] 20+ settlements.
- [ ] Idealmente 30+.
- [ ] 1 adopter externo.
- [ ] Idealmente 2.
- [ ] Instalación independiente reproducida.
- [ ] Evidencia pública.
- [ ] Review/endorsement técnico.

### Aplicación

- [ ] Claims comprobables.
- [ ] Métricas con metodología.
- [ ] No declarar partnership inexistente.
- [ ] No declarar Production sin serlo.
- [ ] Privacidad como propiedad central.
- [ ] Uso de fondos específico.
- [ ] Demo.
- [ ] Arquitectura.
- [ ] Privacy matrix.
- [ ] Links correctos.
- [ ] KYC/KYB posible.
- [ ] Disponibilidad para accelerator.

---

## 38. Primer backlog ejecutable

### Milestone 0 — Repository bootstrap

- [ ] Crear repo.
- [ ] pnpm + Turborepo.
- [ ] TypeScript strict.
- [ ] ESLint/format.
- [ ] Vitest.
- [ ] GitHub Actions.
- [ ] Apache-2.0.
- [ ] SECURITY/CONTRIBUTING/CITATION.

### Milestone 1 — Railgun spike

- [ ] Bootstrap engine.
- [ ] Persist LevelDB.
- [ ] Import/create view-only wallet.
- [ ] Sync.
- [ ] List incoming private notes.
- [ ] Read memo/reference.

### Milestone 2 — PPOps core

- [ ] `PaymentIntent`.
- [ ] Commitment encoder.
- [ ] SQLite schema.
- [ ] State machine.
- [ ] Settlement normalization.
- [ ] Matcher.

### Milestone 3 — API

- [ ] Create intent.
- [ ] Get intent.
- [ ] Status.
- [ ] Health.
- [ ] OpenAPI.

### Milestone 4 — Events

- [ ] Event schema.
- [ ] Signed webhook.
- [ ] Idempotency.
- [ ] Retry queue.
- [ ] HPKE encryption.

### Milestone 5 — Packaging

- [ ] Dockerfile.
- [ ] Compose.
- [ ] GHCR.
- [ ] Example env.
- [ ] Quickstart.

### Milestone 6 — Request adapter

- [ ] Map request to intent.
- [ ] Return payment descriptor.
- [ ] Detect settlement.
- [ ] Update/reflect paid state.
- [ ] Public example.

### Milestone 7 — Conformance

- [ ] Canary metadata.
- [ ] Public leakage checks.
- [ ] Key capability check.
- [ ] Replay test.
- [ ] Recovery test.
- [ ] JSON/SARIF report.

### Milestone 8 — Beta/adoption

- [ ] Recruit 5 testers.
- [ ] Recruit 1 integrator.
- [ ] Record settlements.
- [ ] Collect public feedback.
- [ ] Fix onboarding.
- [ ] Record demo.

---

## 39. Mensaje de elegibilidad sugerido para Octant

Antes de invertir todo el esfuerzo, se propuso consultar a Octant con un mensaje específico. Versión actualizada sin mencionar otros proyectos:

> Hi Octant team — we are preparing PPOps, an open-source, self-hostable adapter and local reconciliation layer that connects private Ethereum payment rails to invoices and merchant software. The node uses viewing capability only, detects and matches private settlements locally, and emits confirmation events without publishing invoice metadata or giving a processor spending access or a complete merchant payment graph.
>
> Before September 10, our target is a public v0.1 release, reproducible Docker build, documented threat model and privacy tests, real private settlements, external users, and at least one independent integration or adopter. All privacy-critical code will use a recognized open-source license and remain independently buildable and recoverable.
>
> Would a live capped beta with documented real usage and an independently operated integration satisfy the round’s working-software, verifiable-user and non-pre-launch requirements?

No se debe decir que estas condiciones ya están cumplidas hasta que lo estén.

---

## 40. Respuestas directas que condensan toda la conversación

### ¿Qué es PPOps?

Una capa autohospedable que conecta pagos privados con invoices, pedidos y sistemas comerciales.

### ¿Qué problema resuelve?

Una transferencia puede ser privada, pero la factura, reconciliación y webhook pueden volver a revelar toda la relación. PPOps evita esa filtración operacional.

### ¿Es una wallet?

No.

### ¿Es un mixer o privacy pool?

No.

### ¿Es un gateway completo?

No en v0.1.

### ¿Cuál es su núcleo?

Payment intents + encrypted settlement references + local view-only reconciliation + confirmation events.

### ¿Cuál es el primer rail propuesto?

RAILGUN.

### ¿Por qué RAILGUN?

Porque permite reutilizar infraestructura privada, SDK TypeScript, viewing capabilities y memos, evitando nuevos contratos y circuitos.

### ¿Cuál es la primera integración ideal?

Request Network.

### ¿Por qué Request Network?

Porque ya tiene invoices, payment networks y detection; PPOps puede agregar private settlement sin reinventar el resto.

### ¿Qué red?

El diseño es chain-agnostic. La red piloto queda pendiente según rail/adopter/costos.

### ¿Qué stack?

TypeScript, Node, Hono, Zod, OpenAPI, RAILGUN Wallet SDK, LevelDB, SQLite, Drizzle, viem, Vitest, Playwright, Docker, GitHub Actions y React/Vite para demo.

### ¿Contratos propios?

No en v0.1.

### ¿Hasta dónde llegar para Octant?

Beta pública reproducible, flujo real, usuarios externos, settlements verificables, adopter, threat model, tests y evidencia.

### ¿Deadline interno?

31 de agosto para ingeniería; primera semana de septiembre para adopción.

### ¿Parmelia debe mencionarse?

No como núcleo. PPOps se mantiene separado.

### ¿Qué hace que sea autoría propia?

Especificación, referencia abierta, adapters, conformance suite, adopción, release y documentación pública.

---

## 41. Prompt de continuidad para otra conversación

Copiar desde aquí cuando sea necesario retomar el trabajo:

```text
Estoy desarrollando PPOps — Private Payment Operations, un proyecto independiente para Octant Epoch 13 Privacy Round (deadline 10 de septiembre de 2026). PPOps no es una wallet, mixer, privacy pool ni gateway completo. Es una capa open-source y autohospedable que conecta privacy rails de Ethereum con invoices, órdenes y merchant software.

La v0.1 propuesta usa TypeScript/Node, Hono, Zod/OpenAPI, SQLite/Drizzle, viem, Docker y una rail inicial basada en RAILGUN. El PPOps Node opera con una view-only wallet, nunca con spending keys. Una app crea un PaymentIntent con amount/token/externalReference; PPOps calcula un commitment con salt, coloca una referencia en un memo privado, detecta el incoming private settlement, descifra y matchea localmente, verifica amount/token/expiry/finality y emite payment.confirmed. Request Network es la primera integración ideal, pero no debe bloquear el core.

El proyecto es chain-agnostic; la red piloto todavía debe decidirse según rail, adopter y costos. Parmelia es un proyecto separado y no debe ser el centro de la narrativa. No se crearán contratos Solidity ni circuitos ZK propios antes del round.

Para que Octant lo considere, PPOps debe llegar legítimamente a Beta: repo público con licencia, v0.1.0, Docker/build reproducible, threat model, privacy tests, flujo real end-to-end, al menos 5 usuarios externos (ideal 10–20), 20+ settlements (ideal 30+), al menos un adopter/integrador externo y una instalación independiente reproducida. El deadline interno de ingeniería es 31 de agosto; del 1 al 6 de septiembre se priorizan usuarios e integraciones; feature freeze el 7; aplicación idealmente el 9.

La tesis principal es: Privacy does not end at settlement. La diferenciación de PPOps es private payment interoperability: encrypted settlement references, local view-only reconciliation, private confirmation events, Privacy Manifest, Conformance Suite e independent recovery.
```

---

## 42. Fuentes y enlaces mencionados durante la conversación

### Octant

- https://octant.fillout.com/epoch-13
- https://octant.substack.com/p/epoch-13-the-privacy-round
- https://octant.build/
- https://docs.v2.octant.build/docs/projects/apply-for-funding/

### Ethereum / CROPS / Privacy

- https://blog.ethereum.org/2026/03/13/ef-mandate
- https://ethereum.org/roadmap/privacy/
- https://ethereum.org/latest/privacy-apps-on-ethereum/

### Standards and rails

- https://eips.ethereum.org/EIPS/eip-5564
- https://docs.railgun.org/developer-guide
- https://docs.railgun.org/developer-guide/wallet/private-wallets/view-only-wallets
- https://docs.railgun.org/developer-guide/wallet/transactions/private-transfers
- https://docs.railgun.org/developer-guide/wallet/private-balances
- https://docs.fluidkey.com/
- https://github.com/privacy-ethereum/anon-rpc
- https://notes.ethereum.org/@niard/KohakuRoadmap

### Payment infrastructure

- https://docs.request.network/
- https://github.com/RequestNetwork/requestNetwork
- https://woocommerce.com/document/depay-payments/

### Related projects/research

- https://github.com/MiragePrivacy
- https://arxiv.org/abs/2308.01703

> Nota: los enlaces y claims externos incluidos aquí provienen de la investigación y discusión mantenida en la conversación. Antes de usarlos en una aplicación pública, README o artículo, se deben volver a verificar sus estados, versiones y términos exactos.

---

## 43. Estado final al 23 de agosto de 2026

PPOps todavía no debe presentarse como producto live ni como proyecto con tracción.

El contexto consolidado define con claridad:

- El problema.
- El alcance.
- La arquitectura.
- El stack.
- El primer rail.
- La integración ideal.
- Los límites de privacidad.
- Los requisitos de Octant.
- La barra interna de elegibilidad.
- El calendario.

La prioridad inmediata es ejecutar el primer flujo real:

```text
Payment intent
   ↓
Private transfer with encrypted reference
   ↓
View-only local detection
   ↓
Automatic matching
   ↓
payment.confirmed
```

Hasta que ese flujo exista, PPOps sigue siendo ideación. Cuando funcione, sea reproducible y lo utilicen terceros, podrá presentarse como una beta open-source de infraestructura pública para privacidad operacional en pagos de Ethereum.

---


---

# Apéndice A — Diseño inicial completo y decisiones históricas superadas

Este apéndice conserva propuestas anteriores para no perder contexto. Cuando contradiga las secciones de “Decisiones vigentes”, prevalece la decisión vigente.

## A.1 Formulación inicial completa

Nombre inicial:

**PPOps — Private Payment Operations for Ethereum**

Subtítulo:

> **An open, local-first operations layer for private Ethereum payments.**

Tesis:

> **Privacy does not end at settlement.**

Problema descrito:

Una transferencia privada puede terminar vinculada nuevamente por:

- Parámetros del checkout.
- Metadata del link.
- Consultas RPC.
- Scanner administrado por terceros.
- Identificadores de invoice.
- Eventos de contrato.
- Webhooks.
- Receipts.
- Reconciliación.
- Consolidación posterior de fondos.

La propuesta inicial era construir un bien público independiente y utilizar un producto existente únicamente como primera implementación. Posteriormente Daniel decidió separar por completo PPOps de Parmelia en su narrativa.

## A.2 Private Payment Request Envelope inicial

Payload conceptual inicial:

```text
{
  version,
  chainId,
  asset,
  amountPolicy,
  expiry,
  railAdapter,
  opaqueReceiverPayload,
  requestCommitment,
  perRequestEventPublicKey,
  capabilities,
  nonce,
  signature
}
```

Principios propuestos:

- No incluir `order_id`, nombre, email, invoice ID o customer ID en URL, calldata o eventos.
- Usar el fragmento `#...` del link cuando sea posible, evitando que el contenido llegue automáticamente al servidor/CDN/access logs.
- Decodificar el checkout localmente.
- Evitar analytics y scripts de terceros en el flujo privado.
- Separar la firma de identidad del merchant de la dirección de recepción.
- Permitir interoperabilidad futura con invoice commitments externos.

Commitment inicial más completo:

```text
requestCommitment = keccak256(
  domainSeparator ||
  randomSalt ||
  merchantLocalReference ||
  chainId ||
  asset ||
  amountPolicy ||
  expiry
)
```

El salt aleatorio era obligatorio para evitar ataques de diccionario sobre IDs de invoice predecibles.

## A.3 Interfaz inicial de adapters

```ts
interface PrivateRailAdapter {
  createReceiver(context: RequestContext): Promise<OpaqueReceiver>

  scan(
    cursor: ScanCursor,
    viewMaterial: ViewMaterial
  ): AsyncIterable<SettlementCandidate>

  verifySettlement(
    candidate: SettlementCandidate,
    request: PrivateRequest
  ): Promise<VerificationResult>

  privacyManifest(): PrivacyManifest
}
```

La intención era permitir adapters para:

- ERC-5564.
- RAILGUN.
- Privacy Pools.
- Mirage u otras rails.

La versión inicial se pensó con ERC-5564; la dirección técnica más reciente favorece RAILGUN para reducir trabajo criptográfico y aprovechar view-only wallets/memos.

## A.4 Local-first reconciler inicial

Funciones propuestas:

- Mantener viewing keys dentro del entorno del merchant.
- Escanear eventos o estado amplio del protocolo.
- Probar localmente qué settlements pertenecen al merchant.
- Verificar token, amount, expiry, chain y confirmations.
- Descifrar el `requestCommitment`.
- Vincular settlement con invoice local.
- Mantener estados `seen`, `confirmed`, `finalized` y `reverted`.
- Gestionar reorgs e idempotencia.
- Conectarse a nodo propio o mecanismos de private reads.

La discusión inicial mencionó `anon-rpc` como posible integración futura para reducir filtraciones derivadas de RPC reads. Esto no quedó dentro del alcance obligatorio de v0.1.

## A.5 Sealed Payment Events iniciales

Envelope conceptual:

```text
{
  protocolVersion,
  eventId,
  sequence,
  timestamp,
  keyId,
  paddedCiphertext,
  reconcilerSignature
}
```

Propiedades planteadas:

- HPKE.
- Claves por merchant o por request.
- AAD con versión, event ID y route ID.
- Padding.
- Replay protection.
- At-least-once delivery.
- Dedupe por event ID.
- Secuencia monotónica.
- Firma del reconciliador.
- Relay incapaz de leer invoice, customer, amount o settlement.
- Camino directo/self-hosted.

## A.6 Receipts, recuperación y selective disclosure

Se propuso que cada pago produjera un receipt firmado sobre:

- `requestCommitment`.
- Settlement reference.
- Amount y asset.
- Final status.
- Protocol version.
- Timestamp.
- Merchant signature.

Posibilidades futuras:

- Receipt cifrado al payer.
- Export cifrado de requests.
- Reconstrucción desde clean install.
- Migración sin dependencia de proveedor.
- Divulgación selectiva de una invoice a un auditor.
- Pruebas ZK de totales/inclusión en una fase posterior.

## A.7 Privacy matrix inicial

| Superficie | Adapter stealth/ERC-5564 | Adapter shielded futuro | Aporte de PPOps |
|---|---|---|---|
| Dirección canónica del receptor | Oculta | Oculta | Evita reexposición operacional |
| Dirección del payer | Generalmente pública | Dependiente de rail | Declara la limitación |
| Amount/asset | Generalmente públicos | Pueden ocultarse | Evita unirlos con IDs comerciales |
| Timing | Público | Parcialmente observable | Padding/batching opcional de eventos |
| Invoice/order/customer ID | Fuera del alcance de rail | Fuera del alcance de rail | Commitment/cifrado local |
| RPC provider | Puede observar scanning | También puede observarlo | Local sync/private reads futuro |
| Processor/relay | Puede ver conciliación | Igual | Ciphertext only |
| Consolidación posterior | Puede deanonymizar | Depende de rail | Detectar/advertir; no prometer resolver |
| Recovery | Dependiente de wallet | Dependiente de rail | Formato y tooling independientes |

## A.8 Alcance v0.1 inicial posteriormente modificado

La primera propuesta de v0.1 incluía:

- Arbitrum One.
- USDC.
- ERC-5564.
- Private request envelope.
- Encrypted metadata commitment.
- Local reconciler.
- Sealed event.
- Recovery CLI.
- Privacy Manifest.
- Conformance suite.
- Integración de referencia.
- Beta mainnet con límites bajos.

Luego se corrigió:

- No fijar Arbitrum como identidad del proyecto.
- Favorecer RAILGUN como primera rail.
- No depender de Parmelia.
- Elegir red según rail y adopter.

## A.9 Plan original de 29 días, ya desactualizado

Antes de notar que ya era 23 de agosto, se había planteado:

### 12–15 de agosto

- Repo independiente.
- PPO-0 Threat Model.
- PPO-1 Request Envelope.
- PPO-2 Sealed Events.
- PPO-3 Privacy Manifest.
- PPO-4 Recovery Format.
- Licencias.
- Prior-art document.
- Consulta de elegibilidad.

### 16–21 de agosto

- SDK del envelope.
- Derivación de keys.
- Adapter ERC-5564.
- Encrypted metadata.
- Scanner local.
- Validación de settlement.
- Reorg handling.
- Test vectors.

### 22–26 de agosto

- Sealed events.
- Replay protection.
- Recovery export/import.
- Checkout sin terceros.
- Integración end-to-end.

### 27–31 de agosto

- Release candidate.
- Capped mainnet beta.
- Métricas agregadas.
- Review externo.
- Recovery test.

### 1–5 de septiembre

- 2 merchants/apps externos.
- 15–25 usuarios.
- 30 operaciones.
- Adopter testimonial.
- Segundo proyecto usando conformance.

### 6–9 de septiembre

- `v0.1.0`.
- Build reproducible.
- Demo.
- Architecture document.
- Privacy matrix.
- Métricas.
- Aplicación.

La conversación posterior comprimió el plan y fijó el 31 de agosto como deadline interno de ingeniería.

## A.10 Aplicación inicial propuesta

### Nombre

**PPOps — Private Payment Operations for Ethereum**

### Categoría

**Open Source Infrastructure**

### Stage

**Beta**, sólo si ya existía una beta pública utilizada.

### Tagline inicial

> **Private checkout and reconciliation without exposing merchant payment graphs.**

### One-sentence pitch inicial

> **Private Payment Operations is an open-source, local-first protocol and SDK that lets Ethereum merchants reconcile private payments and receive encrypted events without surrendering viewing keys, invoice metadata, or customer graphs to a payment processor.**

### Descripción inicial

> Ethereum payment privacy often ends at settlement. Even when a transfer uses a shielded pool or a one-time address, checkout URLs, RPC queries, hosted scanners, indexers, logs, callbacks, receipts and later fund movements can reconstruct who was paid, for what, and when.
>
> Private Payment Operations provides a signed private payment-request envelope, rail adapters, a local-first reconciler, encrypted replay-safe events, recoverable receipts and an automated privacy-conformance suite. Viewing and spending keys remain under merchant control; hosted relays only see opaque padded envelopes; and any merchant can independently build, scan and recover from the public specification.
>
> PPOps is not a new token, wallet or privacy pool. It composes with existing payment-privacy rails and standards. All privacy-critical code is open source, specifications and test vectors are freely reusable, and every hosted capability has an independently recoverable self-hosted path.

Esta descripción debe ajustarse al producto realmente construido; no debe mencionar componentes que no existan al aplicar.

## A.11 Funding goal inicial

Meta conceptual sugerida:

**USD 50,000**

| Uso | Presupuesto propuesto |
|---|---:|
| Revisión independiente de seguridad/privacidad y remediación | $20,000 |
| Hardening del protocolo/SDK y segundo rail adapter | $15,000 |
| Private reads y packaging self-hosted | $7,500 |
| Conformance suite, test vectors, docs e integraciones | $5,000 |
| Infraestructura reproducible, KYC y operaciones | $2,500 |

Texto inicial:

> The $50,000 goal funds an independent security/privacy review and remediation ($20k), protocol and SDK hardening plus a second privacy-rail adapter ($15k), private-read and self-hosted reconciliation packaging ($7.5k), conformance tests, reproducible builds and adopter documentation ($5k), and project operations/KYC ($2.5k). All privacy-critical components remain open source and independently recoverable.

Escalera conceptual:

- $10k: review, fixes y maintenance de v0.1.
- $25k: segundo adapter e integraciones.
- $50k: hardening completo, conformance madura y mantenimiento.

No se aprobó como presupuesto definitivo.

---

# Apéndice B — Registro cronológico de la conversación

## B.1 Inicio

Daniel presentó Octant Epoch 13 Privacy Round y explicó que la oportunidad encajaba con su trabajo acumulado en grants, Avalanche research, ETHLabs, CROPS, construcción de voz en Ethereum, artículos y desarrollo del ecosistema. Solicitó investigación profunda y máxima capacidad de ingeniería para crear algo brillante.

## B.2 Primera respuesta estratégica

Se propuso PPOps como una capa operacional local-first para pagos privados. La idea inicial planteaba:

- Proyecto independiente de bien público.
- Privacidad después del settlement.
- Arbitrum One como implementación inicial.
- Parmelia como posible reference implementation.
- Request envelopes, adapters, reconciler, sealed events, receipts y conformance.
- Aplicación, funding goal y plan de ejecución.

## B.3 Primera corrección de Daniel

Daniel preguntó:

- Por qué se eligió Arbitrum One.
- Qué era PPOps a nivel producto.
- Por qué mencionar Parmelia siendo un proyecto aparte.
- Si Ethereum realmente necesitaba PPOps.
- Quiénes lo integrarían.

## B.4 Corrección de arquitectura/producto

Se reconoció que Arbitrum era una decisión heredada, no esencial. Se separó PPOps de Parmelia y se refinó como private-settlement adapter/reconciler, no gateway completo. Request Network fue identificado como primer integrador ideal; Kohaku, rails privadas y commerce gateways como candidatos.

## B.5 Solicitud de explicación sencilla

Daniel pidió una explicación transversal, puntual y resumida.

Respuesta consolidada:

> PPOps conecta pagos privados de Ethereum con sistemas reales de negocio. Permite saber qué invoice se pagó y confirmar el pedido sin exponer innecesariamente quién pagó, a quién o por qué referencia comercial.

## B.6 Solicitud de stack técnico

El 23 de agosto Daniel señaló que el proyecto seguía en ideación y preguntó cuál debía ser el stack.

Se congeló la dirección técnica:

- TypeScript/Node.
- RAILGUN Wallet SDK.
- View-only wallet.
- Encrypted memo/reference.
- SQLite/Drizzle.
- Hono/Zod/OpenAPI.
- Generic `PaymentRail` interface.
- Request Network adapter.
- HPKE events.
- Docker.
- Sin contratos propios.

## B.7 Solicitud de nivel de madurez para Octant

Daniel preguntó hasta dónde debía llegar PPOps para que Octant lo considerara y no lo rechazara.

Se fijó la barra:

- Beta pública, no demo.
- Repo/release/license/build reproducible.
- Flujo real end-to-end.
- Usuarios externos.
- Settlements reales.
- Adopter.
- Threat model.
- Privacy conformance.
- Instalación independiente.
- 31 de agosto como deadline de ingeniería.

## B.8 Solicitud de exportación

Daniel pidió exportar absolutamente todo el contexto completo de la conversación, incluyendo Octant, el diseño de PPOps y todo lo relacionado. Este archivo es el resultado.

---

# Apéndice C — Regla de verdad para continuar

Al continuar el proyecto, separar siempre tres categorías:

## Hecho verificado

Sólo aquello que ya existe y puede demostrarse:

- Código publicado.
- Release.
- Test.
- Settlement.
- Adopter.
- Review.

## Diseño acordado

Aquello que el equipo decidió construir, pero todavía no existe.

## Hipótesis

- Request Network querrá integrarlo.
- Una rail específica permitirá exactamente el flujo esperado.
- Octant considerará suficiente el nivel de beta.
- Cierta cantidad de usuarios bastará.

Nunca convertir una hipótesis o un objetivo en una métrica de tracción o claim de producción.

# Fin del contexto maestro
