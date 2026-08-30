# 9Router

> Resumen traducido y abreviado. La documentación canónica está en inglés, en
> [README.md](../README.md) y [docs/README.md](../docs/README.md).

9Router es una pasarela local de enrutamiento de IA con panel de control.
Expone un único endpoint compatible con OpenAI en `/v1/*`, traduce cada
petición al formato que espera el proveedor elegido y conmuta entre modelos y
cuentas, de modo que una sola configuración del cliente sigue funcionando
cuando un proveedor agota su cuota, aplica un límite de velocidad o falla.

<p align="center">
  <img src="../images/9router.png" alt="Panel de control de 9Router" width="800"/>
</p>

## Instalación

```bash
npm install -g 9router
9router
```

El panel de control queda en `http://localhost:20128/dashboard` y la API
compatible con OpenAI en `http://localhost:20128/v1`. El primer inicio de
sesión usa `INITIAL_PASSWORD`, cuyo valor por defecto es `123456`. Cámbialo.

Los pasos completos están en
[docs/getting-started.md](../docs/getting-started.md).

## Estado del fork

Este repositorio es una bifurcación mantenida de forma independiente de
[decolua/9router](https://github.com/decolua/9router). Sigue al proyecto
original mientras incorpora correcciones e integraciones locales según su
propio calendario. Se conservan el nombre 9Router, el historial del proyecto
original, la licencia y la atribución de autoría.

El repositorio original es una referencia de solo lectura y todo el desarrollo
ocurre aquí. Esta bifurcación no cuenta con el respaldo del proyecto original
ni habla en su nombre.

El texto completo, incluido el proceso de sincronización, está en la sección
"Fork status" del [README.md](../README.md) en inglés.

## Documentación

- [README.md](../README.md), la página principal en inglés.
- [docs/README.md](../docs/README.md), el índice de la documentación.

## Licencia

MIT. Consulta [LICENSE](../LICENSE).
