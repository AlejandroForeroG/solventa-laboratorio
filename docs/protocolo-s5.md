# Fuente consultada: Solventa - Diseño final de experimentos - Semana 5

URL: https://docs.google.com/document/d/1ojgu0vQBPDDUtLLbq0zzLS3dnSZHvwO2PkfPbBGdzNM/edit

Última modificación indicada por Drive: 2026-09-07T04:35:53.309Z

Consulta: 7 de septiembre de 2026. Extracción textual completa del conector; las imágenes no están contenidas en esta copia. Antecedente, no entregable de semana 6.

﻿Solventa diseño final de los experimentos


Alcance del experimento: cotizador y perfilador
Experimento comprometido: EXP-S5-01


1. Decisión sobre la cantidad de experimentos


Continuidad con la semana 4. EXP-S5-01 refina el experimento «Degradación controlada de Open Finance durante la cotización» (EXP-S4-01), incluido en la Hoja de trabajo de arquitectura de la semana 4. Conserva la hipótesis de deadline, circuit breaker y fallback autorizado; amplía la evaluación al cotizador y al perfilador, precisa los controles y criterios de aceptación e incorpora la confirmación E11. El esfuerzo pasa de 22 a 28 horas-equipo, incluidas 6 horas de contingencia.


La validación de Transactional Outbox, Cloudflare Queues y consumo idempotente, contemplada en el diseño de semana 4, queda fuera del alcance de EXP-S5-01. Estos elementos permanecen en la arquitectura y su validación se aborda en pruebas posteriores de integración y mensajería.


La entrega compromete un experimento integrado porque la incertidumbre dominante es común al cotizador y al perfilador: ambos dependen de señales de Open Finance y de la decisión de continuar, degradar o denegar cuando esa fuente es lenta o no está disponible. No se divide artificialmente en varios experimentos que repetirían el banco, los datos y la inyección de fallas.


La decisión sigue la orientación del encuentro del 31 de agosto: no existe una cantidad obligatoria; el diseño debe ser ejecutable con la capacidad real de las semanas 6 y 7 y debe validar una hipótesis arquitectónica, no comparar herramientas. EXP-S5-01 requiere 28 horas-equipo, incluidas 6 horas de reserva para repetición y contingencias. Un segundo experimento solo se incorporará si el tablero demuestra capacidad remanente después del trabajo UX/UI; no forma parte del compromiso de esta entrega.


2. Resumen exigido por la rúbrica




Elemento
	Definición final
	Propósito
	determinar si Adapter/ACL + deadline + circuit breaker local + fallback autorizado preserva latencia, completitud técnica, privacidad y trazabilidad del cotizador y el perfilador ante degradación de Open Finance
	Respuesta esperada
	cotización p95 ≤ 250 ms y p99 ≤ 500 ms; perfilamiento p95 ≤ 400 ms y p99 ≤ 800 ms; límite inferior Wilson 95 % de completitud ≥ 99,9 %; cero uso de datos vencidos o revocados; degradación explícita y reducción ≥ 80 % de llamadas inútiles
	Interpretación
	reglas preregistradas de aceptar, ajustar o rechazar; los resultados se evalúan por endpoint, escenario y repetición, sin mezclar fases ni presentar una corrida local como certificación de producción
	Tecnologías
	TypeScript/Hono, Workers preview, Wrangler/Miniflare, puertos hexagonales, Zod, CockroachDB de prueba mediante Hyperdrive, proveedor controlado implementado como Worker simulador, k6 y logs estructurados
	Esfuerzo
	28 horas-equipo: Alejandro 8 h, David 8 h, Juan 6 h y Yesid 6 h; incluye 6 h de contingencia y repetición




3. EXP-S5-01 - Cotización y perfilamiento bajo degradación de Open Finance


3.1 Propósito


Validar o refutar que la decisión arquitectónica permite mantener los ASR QP-01 y QP-02 cuando la dependencia externa presenta latencia, errores, indisponibilidad y recuperación, sin utilizar información cuyo consentimiento o vigencia ya no sean válidos.


El experimento también genera evidencia parcial para QM-02, porque sustituye el proveedor por un simulador detrás del mismo puerto. No valida QE-01 (500→50.000 cotizaciones/min conservando p95 y autoescalado ≤ 60 s), QE-02 (≥ 1.000.000 eventos/10 min), QE-03 (≥ 10 millones de perfiles/< 2 h), la disponibilidad mensual de journeys críticos ≥ 99,97 %, la disponibilidad de recaudo/pago ≥ 99,99 %, el RTO/RPO zonal, el failover regional con RTO ≤ 5 min y cero pérdida confirmada, ni el producto completo. Estos ASR permanecen trazados en Arquitectura y Estrategia de Pruebas v3 para campañas posteriores; no se presentan como descartados ni validados.


3.2 Incertidumbre y punto de sensibilidad


Esperar demasiado al proveedor amenaza los percentiles y propaga la saturación. Cortar demasiado pronto aumenta la degradación y puede reducir la calidad del perfil. El punto de sensibilidad es la combinación de:


- deadline del adapter: 80, 120 o 160 ms;
- regla de apertura y ventana del circuit breaker;
- vigencia y consentimiento del snapshot alternativo;
- fragmentación del estado del breaker entre isolates;
- carga concurrente sobre cotización y perfilamiento.


3.3 Hipótesis preregistrada


Con un deadline inicial de 120 ms, un circuit breaker local por isolate y operación, y fallback a un snapshot autorizado vigente o a una respuesta degradada sin oferta definitiva, Solventa mantendrá simultáneamente:


- cotización: p95 ≤ 250 ms y p99 ≤ 500 ms;
- perfilamiento: p95 ≤ 400 ms y p99 ≤ 800 ms;
- límite inferior del intervalo Wilson al 95 % para completitud técnica ≥ 99,9 % durante la falla inyectada;
- cero solicitudes esperando al proveedor después del deadline operativo;
- cero uso de perfiles o señales vencidas, revocadas o sin consentimiento;
- 100 % de respuestas clasificadas como normal, degradada, denegada o error técnico;
- máximo dos probes semiabiertos por isolate cada 30 s;
- al menos 80 % menos llamadas al proveedor que el control sin breaker durante la caída total, entre T+30 s y T+90 s;
- cierre del circuito después de cinco respuestas consecutivas válidas acumuladas entre intervalos de sondeo, sin reapertura durante los dos minutos posteriores; una falla reinicia el conteo y vuelve a abrir.


3.4 ASR y decisión bajo prueba




Elemento
	Relación con el experimento
	QP-01
	mide p95/p99 del endpoint de cotización bajo cada condición
	QP-02
	mide p95/p99 del endpoint de perfilamiento bajo cada condición
	QS-01
	comprueba consentimiento, vigencia, minimización de logs y denegación segura
	QM-02
	verifica que cambiar proveedor/simulador no altere dominio ni casos de uso
	Adapter + ACL
	normaliza payload, error y semántica externa al modelo canónico
	Deadline + breaker + fallback
	contiene latencia, reduce llamadas inútiles y conserva una respuesta trazable




4. Banco experimental




Elemento
	Función
	Tecnología propuesta y razón
	API mínima
	exponer cotización y perfilamiento con correlación
	Hono + TypeScript, coherentes con la arquitectura objetivo
	Casos de uso
	coordinar consentimiento, señales, perfil y cotización
	puertos hexagonales para aislar infraestructura
	OpenFinancePort
	contrato canónico versionado
	interfaz TypeScript + Zod para validar esquema
	Adapter
	deadline, normalización y telemetría
	fetch y cancelación explícita; es la decisión bajo prueba
	Proveedor controlado
	producir latencia, 5xx, timeout, respuesta inválida y recuperación
	Worker simulador en TypeScript/Hono desplegado en preview, con seed y contador de llamadas; no se compara con otra tecnología
	Circuit breaker
	observar, abrir, sondear y cerrar por isolate/operación
	implementación instrumentada con instanceId para medir fragmentación
	Repositorio de snapshots
	vigencia, consentimiento y revocación
	CockroachDB de prueba por Hyperdrive en preview; repositorio local solo para depuración
	Generador de carga
	fases, umbrales y exportación cruda
	k6
	Observabilidad
	latencia, clasificación, estado del circuito y llamadas
	logs estructurados y traceId; sin PII ni payload completo




La corrida local sirve para depurar reglas. La conclusión sobre QP-01/QP-02 requiere al menos una ejecución candidata en Workers preview/staging, generada desde un runner ubicado en Bogotá, Colombia, con Hyperdrive y CockroachDB de prueba. Cada corrida registra región, zona horaria, latencia base de red y topología de base usada. Si el ambiente no reproduce la topología candidata de tres regiones, la conclusión se limita a la viabilidad del adapter/breaker y no se extrapola a latencia multirregión de producción.


5. Variables y controles


5.1 Independientes




Variable
	Valores preregistrados
	latencia del proveedor
	40, 100, 150, 300 y 1.000 ms
	error del proveedor
	0 %, 5 %, 30 % y 100 %
	deadline
	80, 120 y 160 ms
	circuito
	sin breaker y base porcentual (≥ 50 % de fallas en 20 intentos/30 s, mínimo 10 muestras)
	snapshot
	vigente, vencido, revocado, ausente
	mezcla de tráfico
	70 % cotización / 30 % perfilamiento; además corridas aisladas por endpoint
	carga del prototipo
	100 solicitudes/s; 300 solicitudes/s solo como estrés acotado




No se ejecuta el producto cartesiano. Los casos E01–E08 usan la configuración base y E09 es el control sin breaker emparejado con E05. E10 ejecuta seis subcasos: tres deadlines por dos latencias válidas del proveedor (100 y 150 ms, sin errores), con breaker base y 100 solicitudes/s. El control sin breaker permanece en E09 para aislar la reducción de llamadas durante la caída total. E11 confirma la configuración ganadora sobre los siete casos de aceptación. La carga de 300 solicitudes/s se limita a E01, E03 y E05 y no se extrapola al volumen productivo.


5.2 Dependientes


- p50, p95 y p99 E2E por endpoint, escenario y repetición;
- completitud técnica e intervalo Wilson 95 %;
- llamadas y latencia del proveedor;
- proporción normal, degradada, denegada y error técnico;
- tiempo hasta apertura, probes, cierre y reapertura;
- fallbacks correctos e incorrectos;
- uso de datos vencidos/revocados, esperado en cero;
- solicitudes en vuelo, throughput y saturación observada.


5.3 Controladas


- mismo commit, configuración, runner en Bogotá/Colombia, dataset, seed y payload;
- regla de perfil y cotización determinista;
- reloj controlable para consentimiento y vigencia;
- warm-up de dos minutos y tres repeticiones por escenario;
- orden aleatorio de corridas independientes después de la línea base; E06 conserva obligatoriamente la secuencia caída → recuperación y cada comparación E05/E09 mantiene condiciones emparejadas;
- solo datos sintéticos; sin PII ni credenciales productivas;
- resultados de local y preview separados.


6. Casos y respuesta esperada




Caso
	Condición
	Resultado esperado preregistrado
	E01 Base
	40 ms, 0 % error
	sin fallback; ambos endpoints cumplen p95/p99
	E02 Cercano al deadline
	100 ms
	fallback < 5 %; ambos endpoints cumplen p95/p99
	E03 Proveedor lento
	300 ms
	corte por deadline, respuesta clasificada y percentiles cumplidos
	E04 Caída parcial
	30 % error
	completitud Wilson ≥ 99,9 %, degradación explícita y percentiles cumplidos; no se usa para juzgar reducción del breaker
	E05 Caída total
	100 % error durante 5 min
	apertura ≤ 30 s, máximo dos probes/isolate/30 s, degradación explícita y ≥ 80 % menos llamadas que E09 en la ventana común
	E06 Recuperación
	regreso a 40 ms
	cierre tras cinco éxitos, sin reapertura 2 min y pico de llamadas ≤ 110 % de la tasa previa
	E07 Snapshot no elegible
	proveedor caído + datasets de snapshot vencido y ausente, identificados por separado
	no usarlo; respuesta controlada sin oferta definitiva
	E08 Consentimiento revocado
	proveedor caído + revocación
	cero uso del dato y auditoría de la denegación
	E09 Control sin breaker
	misma caída total, seed, carga, duración y origen temporal de E05; emparejar también el deadline de la configuración confirmada
	línea emparejada para llamadas, latencia y errores entre T+30 s y T+90 s
	E10 Selección
	80/120/160 ms × latencia válida de 100/150 ms, 0 % error y breaker base
	comparar corte prematuro y latencia; elegir deadline elegible por seguridad, p95/p99, completitud y menor fallback. La reducción del breaker se confirma con E05/E09, no con E10
	E11 Confirmación
	E01, E03, E04, E05, E06, E07 y E08 con la configuración ganadora
	tres repeticiones completas y E09 emparejado con E05 usando el deadline seleccionado; insumo confirmatorio del veredicto




Completitud técnica. El numerador contiene respuestas normales 2xx, degradadas 2xx y denegaciones de negocio esperadas 4xx con cuerpo y correlación. El denominador contiene todas las solicitudes emitidas. Timeout del cliente, 5xx, pérdida de correlación o respuesta sin clasificación es fallo técnico. E07/E08 jamás cuentan como oferta exitosa.


7. Procedimiento reproducible


1. Registrar commit, runtime, configuración, región, dataset y responsables.
2. Ejecutar pruebas unitarias y de contrato; detener si alguna falla.
3. Desplegar API, proveedor controlado, Hyperdrive y base de prueba en preview/staging.
4. Sembrar snapshots sintéticos vigentes, vencidos, revocados y ausentes.
5. Ejecutar warm-up de dos minutos sin usarlo para el veredicto.
6. Ejecutar E01 tres veces y luego E02–E09 en orden aleatorio, tres repeticiones cada uno.
7. Ejecutar E10 para seleccionar una configuración sin cambiar los criterios preregistrados.
8. Ejecutar E11: repetir E01, E03–E08 y su control E09 tres veces con la configuración ganadora; en E09 se desactiva únicamente el breaker.
9. Mantener cada fase cinco minutos. Antes de E06, abrir el circuito con la falla de E05 y fijar T=0 al restaurar el proveedor; observar al menos dos minutos después del cierre. Reiniciar estado entre corridas independientes para evitar arrastre.
10. Exportar salida k6, logs, configuración, llamadas al proveedor y estado del circuito.
11. Reconciliar solicitudes emitidas contra las cuatro clasificaciones.
12. Calcular percentiles por repetición e intervalo Wilson; reportar mediana y peor repetición.
13. Aplicar las reglas de interpretación sin cambiarlas después de ver resultados.
14. Emitir veredicto, actualizar ADR y enlazar evidencia real en el tablero.


8. Interpretación preregistrada


8.1 Aceptar


Se acepta la configuración solo si E11 confirma E01, E03, E04, E05, E06, E07 y E08 en tres repeticiones por endpoint. Seguridad, clasificación, completitud y p95/p99 se exigen en cada caso; ausencia de fallback se exige en E01; apertura, sondeos y reducción ≥ 80 % se juzgan en E05 frente a E09 emparejado; cierre, pico y no reapertura se juzgan en E06; E07/E08 exigen cero uso de respaldo no elegible. No se exige apertura durante operación sana. E10 selecciona primero las opciones que cumplen seguridad, completitud y latencia en ambas latencias del proveedor; entre ellas elige menor fallback y, en empate, menor deadline. Ninguna selección equivale a aceptación sin E11.


8.2 Ajustar y repetir


Se ajusta si no existe violación de consentimiento/vigencia, pero sucede al menos uno de estos casos:


- un p95/p99 supera el umbral;
- E02 supera 5 % de fallback;
- hay reapertura durante los dos minutos observados;
- el pico de recuperación supera 110 %;
- otra configuración aceptable reduce el fallback al menos dos puntos porcentuales.


Solo se cambia deadline, ventana, umbral, probes o acceso al snapshot. Se repiten E01 y todos los casos afectados con la nueva configuración.


8.3 Rechazar


Se rechaza la decisión si usa un dato vencido/revocado, oculta degradación, pierde trazabilidad o ninguna configuración satisface conjuntamente seguridad, completitud y latencia. El breaker local se rechaza si no reduce al menos 80 % de llamadas en la corrida representativa. Las alternativas son precalcular señales autorizadas, sacar el perfilamiento completo del camino síncrono o declarar la cotización inicial como preliminar; cualquier cambio exige ADR y nuevo experimento.


9. Evidencia requerida


Cada ejecución válida conserva:


- README y procedimiento;
- commit y artefacto desplegado;
- configuración del adapter y circuito;
- scripts k6, seed y dataset sintético;
- salidas crudas y resumen reproducible;
- logs/trazas representativas sin PII;
- conteo de llamadas y reconciliación;
- limitaciones del ambiente y costo real;
- veredicto firmado por ejecutor y revisor;
- ADR y enlaces de tablero actualizados.


Se reporta el tamaño de muestra y el intervalo Wilson por endpoint, escenario y repetición. Una muestra insuficiente para sustentar el límite inferior ≥ 99,9 % produce un resultado inconcluso que requiere ampliar o repetir la corrida; no se agregan escenarios para ocultar fallas. Una captura aislada no sustituye la salida cruda. Mientras no se ejecute, todo valor anterior se conserva como respuesta esperada, no como resultado observado.


10. Tecnologías y esfuerzo asociado




Actividad
	Responsable
	Horas
	Evidencia de terminación
	banco mínimo, contratos y configuración
	Juan Sebastián Sánchez Tabares
	6
	código, unitarias y contrato canónico
	proveedor Worker simulado, adapter y fases
	David Armando Rodríguez Varón
	8
	simulador, scripts, seed y configuración
	snapshots, consentimiento y casos negativos
	Yesid Arley Marín Rivera
	6
	fixtures, consultas y trazas
	ejecución, análisis, revisión y ADR
	Alejandro Forero
	8
	salidas, cálculo, acta y ADR
	Total
	Equipo
	28
	22 h base + 6 h de contingencia y repetición




La estimación es horas-equipo, no puntos convertidos a horas. El protocolo tiene 23 condiciones principales: nueve casos iniciales, seis subcasos de selección y ocho confirmatorios contando el control E09 emparejado. A tres repeticiones de cinco minutos son 345 minutos de carga efectiva (5 h 45 min). Si cada corrida tiene dos minutos de warm-up, el banco requiere al menos 483 minutos (8 h 3 min), más preparación y recuperación. Es tiempo transcurrido del banco, no horas-persona adicionales automáticas: la campaña debe automatizarse. Las corridas aisladas y el estrés son diagnósticos adicionales sujetos a la reserva. Las 6 h adicionales absorben una repetición fallida o un ajuste. Antes de iniciar, el equipo valida capacidad UX/UI y experimental en el tablero. Si una ausencia reduce la capacidad, se reduce la carga de estrés o sensibilidad, pero nunca E07/E08, E11 ni los umbrales después de observar resultados.


11. Riesgos y límites de validez




Riesgo
	Mitigación
	local no reproduce la red real
	exigir corrida candidata en preview/staging
	simulador demasiado regular
	incluir jitter, 5xx, timeout, respuesta inválida y recuperación
	estado local fragmentado por isolate
	registrar instanceId y evaluar reducción real de llamadas
	prueba breve interpretada como SLA
	limitar conclusión a viabilidad de la decisión
	caché/snapshot siempre favorable
	incluir ausente, vencido y revocado
	cuotas del ambiente
	escalamiento progresivo y reporte del máximo real, sin extrapolación
	cambios post hoc
	conservar hipótesis, scripts y reglas fechadas antes de ejecutar




12. Resultado de Semana 5


El resultado de esta entrega es el diseño final y preregistrado. La ejecución se planifica para semanas 6 y 7.
