# Funcionamiento del banco experimental

## Componentes

| Carpeta | Responsabilidad |
|---|---|
| backend/domain | Reglas de circuito, señales y clasificación |
| backend/application | Casos de uso de cotización y perfilamiento |
| backend/acquisition | API de entrada, obtención de señales, respaldo y eventos |
| backend/identity | Verificación de consentimiento y eventos |
| backend/shared | Contratos, cancelación, acceso SQL y opciones diagnósticas |
| experimentos/simulator | Proveedor simulado y persistencia de evidencia del laboratorio |
| experimentos/k6 | Generación de solicitudes, latencia y registro del cliente |
| experimentos/plan.ts | Condiciones, tiempos, repeticiones y parámetros |
| experimentos/analyze.ts | Latencia, completitud, sondeos y conciliación |
| experimentos/test y backend/test | Pruebas locales de lógica y controles |

Simulator y el almacenamiento de evidencia son parte del laboratorio. No reemplazan Policy, Claims & Payments en la arquitectura del producto.

## Comandos

| Comando | Efecto |
|---|---|
| npm run demo | Recalcula E05 r2 con registros incluidos, sin red |
| npm run results | Presenta las 30 corridas guardadas |
| npm run reproduce | Recalcula las 30 corridas extraídas en .replay |
| npm test | Ejecuta 52 comprobaciones locales |
| npm run typecheck | Verifica tipos del banco y las herramientas |
| npm run bank -- init | Genera credenciales locales en archivos excluidos de Git |
| npm run bank -- plan --phase initial | Escribe la configuración de una campaña; no la ejecuta |
| npm run bank -- analyze --directory RUTA | Analiza registros existentes en RUTA |
| npm run bank -- export --directory RUTA | Consulta al banco remoto para exportar evidencia; requiere credencial |
| npm run bank -- run ... | Genera carga nueva con k6 |

La entrega se demuestra con `demo` y `results`. La campaña terminó con E01–E09; E10 y E11 quedaron cancelados. No es necesario desplegar ni ejecutar `run`, `export` o `campaign` para revisar este repositorio.

## Configuración para desarrollo

Los archivos `wrangler.jsonc` contienen recursos locales de ejemplo, con identificadores Hyperdrive nulos. `local-only` es una contraseña ficticia del ejemplo; no da acceso a ningún recurso remoto. `npm run bank -- init` crea un token aleatorio en `experimentos/bank.local.json` y las variables locales de los servicios. Estos archivos están excluidos de Git.

`npm run dev` inicia los servicios con Wrangler para desarrollo local. El montaje SQL dispone de `experimentos/infra/compose.yaml`, `schema.sql` y herramientas de configuración y migración. La campaña histórica usó SQL remoto y no equivale al modo local en memoria.

El generador requiere k6. En Windows x64, `node tools/install-k6.mjs` descarga la versión fijada y comprueba su hash. En otro sistema se puede pasar la ruta del ejecutable con `--k6`. Las opciones completas están en `experimentos/cli.ts`: escenario, variante, repetición, plazo, tasa, duración diagnóstica y ubicación del generador. Las ejecuciones remotas formales exigen HTTPS, montaje staging-sql, ubicación de Bogotá, topología de base de datos, versión del artefacto y comprobación del reloj.

La configuración remota se genera con `experimentos/infra/configure.mjs staging` y los dos identificadores Hyperdrive de la cuenta propia. Las credenciales se suministran mediante variables de entorno y secretos de Workers. El repositorio no incorpora credenciales ni recursos remotos listos para reutilizar.

## Interpretación

El resumen automático conserva los estados y comprobaciones del protocolo. Los dictámenes del informe distinguen latencia, completitud, seguridad y trazabilidad. Una respuesta preliminar o una denegación segura pueden estar completas técnicamente; no equivalen a una oferta definitiva. Una evidencia ausente permanece como tal.

Las opciones `--sql-read-retry` y `--snapshot-failure-degrade` están restringidas al modo diagnóstico y no estuvieron activadas en las 30 corridas formales. La publicación conserva esa separación.
