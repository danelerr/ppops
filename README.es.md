# PPOps, explicado en español

PPOps ayuda a tu aplicación a reconocer pagos privados de USDC en Arbitrum.
Lo ejecutas como un servicio junto a tu backend. Tu aplicación crea un cobro,
el cliente paga desde una wallet RAILGUN separada y PPOps notifica a tu backend
cuando el importe puede considerarse confirmado.

El servicio del comercio utiliza una clave de visualización; las claves para
gastar permanecen fuera de él.

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

Estas mejoras están en el código fuente actual y todavía no se han publicado.
El tag v0.1.0-beta.1 no contiene la nueva demo ni los comandos doctor y status.
La documentación técnica canónica está en inglés y corresponde al mismo checkout.

Consulta el [README principal](README.md) para conocer el alcance y estado de la beta.
