# Decisiones de arquitectura — Semana 7

Cierre del 20 de septiembre de 2026, basado en las 30 corridas de E01 a E09. La ejecución termina con esos resultados: se cancelan E10, E11 y las repeticiones adicionales. El [informe final](https://docs.google.com/document/d/1wOlHtOBtMxHu6x6mch2Nq1quFtkRIJLXdoAo-NSq9cw/edit) presenta los dictámenes, las 14 figuras y los datos que sustentan estas decisiones.

## Decisión general

Se conserva la arquitectura base: adaptador con plazo de 120 ms, cortocircuitos local, consentimiento obligatorio y respaldo autorizado y vigente. Pasan los objetivos evaluados de E02, E03, E04, E07 y E08. E01, E05 y E06 presentan incumplimientos concretos que requieren mejoras. E09, ejecutado sin cortocircuitos, no pasa desempeño y completitud; ese control respalda mantener la protección. La hipótesis de cumplimiento simultáneo de todos los criterios no pasa.

## Cambios y fundamento

| Resultado del laboratorio | Decisión y componente responsable | Consecuencia | Estado |
|---|---|---|---|
| E01: 25 respuestas degradadas en 90.000 solicitudes (0,0278 %) y un error técnico; pasan latencia y completitud, no pasa cero respaldo | Conservar 120 ms en el adaptador. Incorporar recuperación acotada de lecturas SQL en el servicio propietario | Una demora transitoria puede recuperarse con un único intento adicional dentro del presupuesto. Consume tiempo y capacidad | Plazo vigente; recuperación propuesta para el producto |
| E02: respaldo máximo de 0,0667 %, inferior al 5 %; E03 contiene al proveedor de 300 ms | Conservar cancelación, cortocircuitos y respaldo autorizado | Acotar la espera externa. Comunicar fuente, antigüedad y carácter preliminar cuando corresponda | Conservar mecanismos medidos |
| E04: pasan latencia, completitud y degradación explícita; degradación entre 85,88 % y 90,38 % según operación y repetición | Actualizar señales autorizadas de forma asíncrona en Acquisition & Risk mediante outbox y Queue | Obtener respaldo reciente sin esperar toda la integración externa durante la solicitud. Añade procesamiento, almacenamiento y control de vigencia | Propuesta de implementación |
| E05: reducción de llamadas de 92,24 % a 97,31 %, frente a meta del 80 %; no pasa p99 de cotización r2 (556 ms frente a 500) ni apertura universal antes de 30 s | Mantener el circuito local y gestionar las esperas SQL. Registrar estado por instancia y operación y última actividad | Mantener la reducción medida y distinguir una instancia sin tráfico de una recuperación fallida. No añadir coordinación global al recorrido síncrono | Circuito vigente; gestión SQL y seguimiento propuestos |
| E06: 219 cierres con cinco éxitos consecutivos y pico menor al 110 %; no pasa completitud de perfilamiento r2 (Wilson 99,8858 % frente a 99,9 %) | Conservar recuperación del circuito. Gestionar consultas en Identity y Acquisition & Risk | Recuperar lecturas transitorias y conservar un resultado explícito ante espera persistente. Un consentimiento no verificable mantiene el acceso bloqueado | Circuito vigente; política SQL propuesta |
| E07 y E08: cero usos de respaldo no elegible y cero ofertas definitivas; E08 registra cero consultas a proveedor o respaldo | Mantener consentimiento fresco en Identity y verificación de vigencia en Acquisition & Risk | Proteger el dato incluso si impide completar una oferta. El trabajo asíncrono vuelve a comprobar consentimiento | Conservar controles y extenderlos al trabajo asíncrono |
| E09: seis resultados de operación y repetición no pasan sin cortocircuitos; 756 respuestas no completas | Mantener activado el cortocircuitos | Evitar trasladar la caída del proveedor a cada solicitud. E09 es el control de comparación | Conservar protección |
| Trazabilidad total: 33 recibos no confirmados y diferencias cliente/servidor | Guardar resultado y auditoría en la transacción del propietario mediante outbox; publicar de forma asíncrona con consumidores idempotentes | Reconstruir decisiones sin depender del muestreo del panel. Distinguir despacho, recepción y cierre. Añade almacenamiento y conciliación | Propuesta para el producto; correlación y persistencia experimental ya disponibles |
| Cálculo incorrecto del intervalo entre sondeos | Usar probe.at y agrupar por instancia y operación | Eliminar falsas alarmas conservando resultados originales y reglas del protocolo | Corregido: 52 pruebas automatizadas pasaron, 30 corridas recalculadas y 52 falsas alarmas eliminadas |

## Recuperación de lecturas y tratamiento de errores

La política propuesta toma la opción diagnóstica ya desarrollada: primer SELECT de hasta 200 ms, cierre de la conexión y como máximo un reintento ante un error transitorio permitido. La espera entre intentos es de 10 a 25 ms y se conserva el límite total de 700 ms. El presupuesto local por instancia y dependencia admite una ráfaga de dos reintentos y repone cinco por segundo. No se reintentan escrituras ni errores de autorización.

Si Identity no puede verificar consentimiento, se bloquea el acceso. Si el consentimiento está verificado pero falla la consulta del respaldo, se devuelve un estado preliminar sin datos ni oferta y se conserva la causa técnica. Las pruebas diagnósticas de esta opción registraron respuestas de hasta 836 ms; la propuesta no se presenta como una mejora de p99 ya conseguida.

## Actualización asíncrona y auditoría

Acquisition & Risk registra la solicitud de actualización en su outbox dentro de la transacción que origina el trabajo. Queue entrega el mensaje a un consumidor idempotente que vuelve a verificar el consentimiento con Identity antes de consultar o usar información. La copia conserva fuente, vigencia y versión de autorización. La respuesta síncrona identifica si usa respaldo o si permanece preliminar.

El resultado de negocio y su evento de auditoría se guardan en una transacción del propietario. La publicación posterior y la deduplicación evitan depender del panel de observabilidad para reconstruir decisiones. Un despacho sin recibo permanece identificado como tal. Esta propuesta no atribuye a Cloudflare todos los errores: las trazas localizan esperas de consultas, pero no separan una causa exclusiva de base de datos, conexión, Hyperdrive o ejecución del servicio.

## Integración con los modelos del proyecto

La [arquitectura S6 completa](https://drive.google.com/file/d/1GQFxNKw0DtiH0WJuGHKOP59q2g0ldoJ-/view) y los [modelos en Lucidchart](https://lucid.app/lucidchart/48598a5b-beb0-45f1-8f76-832056912678/edit) son la base para incorporar estas decisiones. Este documento no modifica Lucidchart. Deben conservarse las vistas funcional, despliegue, información, estructura hexagonal e interacción, junto con los propietarios y conectores existentes.

Los cambios corresponden a las lecturas de Identity y Acquisition & Risk, la actualización asíncrona de señales y la auditoría. Simulator y Evidence pertenecen al laboratorio; no sustituyen los dominios Policy, Claims & Payments. Se conservan los modelos de emisión, pagos, firma, siniestros, R2, Queues, Workflows y Outbox/Inbox del producto.

El cierre de los laboratorios no depende de otra campaña. Estas decisiones alimentan la implementación de Proyecto Final 2; los cambios propuestos se distinguen de los mecanismos que sí se midieron.
