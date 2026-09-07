# PPOps, explicado en español

PPOps ayuda a tu aplicación a reconocer pagos privados de USDC en Arbitrum.
Lo ejecutas como un servicio junto a tu backend. Tu aplicación crea un cobro,
el cliente paga desde una wallet RAILGUN separada y PPOps notifica a tu backend
cuando el importe puede considerarse confirmado.

El servicio del comercio utiliza una clave de visualización; las claves para
gastar permanecen fuera de él.

Este flujo se llama **PPOps PayIn**: solicitud firmada, pago desde una wallet
separada, detección view-only, validación y notificación al comercio.
**Payout** (salidas y posibles reembolsos) queda únicamente en el
[roadmap](docs/ROADMAP.md), sin API ni claves de gasto en el servicio.

## Pruébalo sin fondos

Desde este repositorio, con Node.js 24:

~~~bash
npm ci
npm run demo
~~~

Abre http://127.0.0.1:8788/shop/. Crea una orden, abre su solicitud de pago y
pulsa **Simulate payment**. Regresa con **Return to the example shop**:
verás la entrega registrada una sola vez. Detén la demo con Ctrl-C.

Todo este recorrido es una simulación local. No necesitas wallet, RPC ni dinero.

## Para una integración real

- **Comercio:** [inicio paso a paso](docs/QUICKSTART.md).
- **Desarrollador del backend:** [ejemplo ejecutable](examples/README.md) y
  [guía de integración](docs/MERCHANT-INTEGRATION.md).
- **Persona que paga:** [requisitos y wallet de referencia](docs/PAYER-INTEGRATION.md).
- **Operación del servidor:** [Docker y despliegue](docs/DEPLOYMENT.md).
- **Problemas:** [diagnóstico](docs/TROUBLESHOOTING.md).

La wallet del pagador debe tener USDC privado disponible para gastar, además
de la comisión. Una transferencia pública normal no completa el cobro.

La versión actual es **v0.1.0-beta.3**. Conserva la demo local, el cliente TypeScript y las utilidades de diagnóstico de beta.2.
Esta release añade mejoras de PayIn: checkout
con verificación local, estados claros, QR de la solicitud y diagnóstico de saldo
en el payer de referencia. El botón **Pay privately** abre el intercambio de la
solicitud; todavía no conecta automáticamente con una wallet. La firma no prueba
por sí sola la identidad del comercio. Consulta [PayIn](docs/PAYIN.md).
La documentación técnica completa está en inglés en el [README principal](README.md).
