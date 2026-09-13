# Conexión con Bazantic — plataforma y API de demo

Objetivos: O2 y O0. Inicio: 2026-09-13 04:58:12 Bolivia.
Base: `cfc3d408175236a56410cbfe6ef7e4e4f95018f1`.
Estado actualizado: **GO; gateway y Recipe publicados con autorización**.
El relato inicial debajo conserva la secuencia histórica del gate. Véase la
[evidencia de publicación](DELIVERY.md) para el estado al 13 de septiembre, 05:38 Bolivia.
Ledger se omite por instrucción de Daniel.

## Documentación accesible

La herramienta web no recuperó las páginas. Se comprobó después acceso HTTP
directo satisfactorio a estas tres fuentes oficiales; el sitio sí es accesible:

- [Deploy an agent gateway](https://bazantic.com/docs/deploy-a-gateway): base
  URL, autenticación bearer y spec OpenAPI; permite spec alojada o pegada en el
  dashboard. Revisar métodos/precios antes de Save & Deploy. La URL se obtiene
  de la respuesta/listado real. Sandbox usa Base Sepolia; producción usa USDC
  real en Base. No se ha autorizado ningún gasto.
- [Recipes](https://bazantic.com/docs/recipes): borrador, herramientas existentes,
  prueba y publicación. Campos declarados: name, description, input_schema,
  input_example, output_example, prompt_template, model, tool_bindings. El prompt
  usa un único marcador de inputs. Los tests de borrador usan credencial del
  operador sin pago; sus entradas y salidas se conservan en la plataforma.
- [CLI](https://bazantic.com/docs/cli): paquete oficial `@bazantic/cli`, binario
  `baz`; login y gestión de gateways/Recipes. No hay comando CLI de ejecución
  de tests de Recipe. `baz` no está en el PATH local; no se instaló todavía.

No se ejecutaron los comandos de publicación o pago de los ejemplos. Los
detalles de versión y argumentos se comprobarán con la CLI instalada si se usa.

## Sesión de cuenta

Inicialmente se abrió `/login` y se dejó para Daniel. En la reanudación se
verificó el dashboard autenticado de su cuenta personal, el formulario
`/gateways/new` (Analyze / Review / Activate) y la creación de Recipes en
`/dashboard/recipes`. Estos controles y la documentación permiten avanzar con
la implementación local. No se creó una cuenta, gateway o Recipe ni se aceptaron
condiciones desde el agente. La publicación efectiva sigue sin demostrarse.

## Upstream local comprobado

Se ejecutó el siguiente smoke con exit 0. Usa `createDemo`, su cliente interno
autenticado y la ruta existente de estado. La credencial permanece encapsulada;
no se imprimieron IDs, claves ni respuestas completas. El cierre elimina el
estado temporal creado por esta ejecución.

```bash
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createDemo } from './src/demo.ts';
const demo = await createDemo();
try {
  const intent = await demo.client.createIntent({externalReference:'bazantic-b0-synthetic',amountAtomic:'10000',expiresAt:Math.floor(Date.now()/1000)+3600},'bazantic-b0-synthetic');
  const path = `/v1/intents/${encodeURIComponent(intent.id)}/status`;
  const denied = await demo.app.request(path);
  assert.equal(denied.status,401);
  const before = await demo.client.request(path);
  assert.equal(before.id,intent.id);
  assert.equal(before.status,'OPEN');
  const simulated = await demo.app.request(`/demo/${encodeURIComponent(intent.id)}/confirm`,{method:'POST',headers:{'content-type':'application/json'}});
  assert.equal(simulated.status,200);
  const after = await demo.client.request(path);
  assert.equal(after.status,'PAID');
  console.log(JSON.stringify({check:'bazantic-b0-upstream',environment:'in-process isolated simulation',unauthenticated:401,authenticated:true,before:'OPEN',after:'PAID',realPayment:false,publicEndpoint:false}));
} finally { await demo.close(); }
JS
```

Resultado: **401 sin credencial; OPEN autenticado; PAID después de evento
sintético**. Esto comprueba API y reconciliación de demo en el mismo proceso;
no prueba red HTTPS, gateway, MCP, Recipe ni pago onchain.

Conexión elegida para la demo: instancia aislada basada en `createDemo`, con
upstream accesible únicamente por el proceso local. Cuando la conexión esté habilitada,
solo la proyección del adapter y su OpenAPI podrán exponerse por HTTPS, con
autorización para la publicación; nunca la app de demo completa ni `/demo/*`.

## Resultado de la reanudación

Tras comprobar la sesión y los formularios, se implementaron el adapter, el
runner aislado y sus pruebas. Véase el [runbook](README.md). El alojamiento
HTTPS se deja para la aprobación operativa; no se inició un túnel ni se expuso
el servicio. Al inicio de la comprobación de conexión quedaban 181 min 48 s hasta congelar, o 151 min
48 s antes del margen de integración; debe recalcularse al continuar.

La publicación y la comparación A/B siguen pendientes. La comparación A/B es necesaria para
seleccionar el premio Bazantic con evidencia de mejora.
