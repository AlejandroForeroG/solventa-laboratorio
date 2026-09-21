# Guion para el video de evidencias del laboratorio

Duración sugerida: cinco minutos. Este segmento demuestra el laboratorio y sus decisiones de arquitectura; la navegación web y móvil, el plan y el tablero se muestran en las demás partes del video de entrega.

## Preparación

Abrir el repositorio, [resultados.md](resultados.md), [arquitectura.md](arquitectura.md) y las gráficas de latencia E04–E06 y comparación E05/E09. Instalar las dependencias antes de grabar:

```sh
git clone https://github.com/AlejandroForeroG/solventa-laboratorio.git
cd solventa-laboratorio
npm ci
```

Usar letra de terminal legible, ocultar notificaciones y grabar la salida real. La demostración recalcula una corrida conservada; debe presentarse así en el video. No requiere abrir la cuenta del proveedor ni mostrar credenciales.

## 0:00–0:35 · Pregunta y montaje

Mostrar README y la vista funcional.

«Evaluamos si Solventa puede cotizar y perfilar cuando falla su fuente de señales financieras, manteniendo una respuesta rápida y usando solo datos autorizados. El banco tiene Acquisition, Identity y un simulador de Open Finance en Cloudflare Workers. Ejecutamos 30 corridas con datos sintéticos: tres repeticiones por condición. En E07 probamos respaldo ausente y vencido por separado».

## 0:35–1:05 · Ubicación de la evidencia

Mostrar `resultados/corridas`, `metricas.csv`, `manifest.json` y la versión `laboratorio-s7` con los 30 ZIP.

«Aquí están las configuraciones, los resultados por corrida y las huellas que permiten comprobar que los archivos no cambiaron. Los ZIP incluyen los registros del cliente y del servidor y las fuentes ejecutadas. Las gráficas del informe se construyeron con esos registros».

## 1:05–2:00 · Ejecución reproducible

Ejecutar y dejar visible la tabla:

```sh
npm run demo
```

«Ahora recalculamos localmente E05, repetición 2, a partir de sus registros originales. No estamos generando nuevas solicitudes. El programa verifica los archivos y comprueba que las métricas coincidan con las de la corrida».

Al aparecer la tabla:

«En cotización hubo 21.000 respuestas completas. El p95 fue de 238 milisegundos y pasó; el p99 fue de 556, superior al límite de 500. Por eso esta repetición no pasa latencia, aunque su completitud sí pasa. El perfilamiento cumple ambos criterios. El programa termina bien porque reprodujo el resultado, no porque todas las pruebas hayan pasado».

## 2:00–3:05 · Comparación y alcance del fallo

Mostrar [latencia E04–E06](../resultados/graficas/02-latencia.png) y [reducción de llamadas](../resultados/graficas/07-comparacion.png).

«E05 tuvo el circuito activado; E09 repitió la caída sin esa protección. El circuito evitó entre 92,24 % y 97,31 % de las llamadas en la ventana definida, por encima de la meta del 80 %. E09 no pasó desempeño y completitud en sus seis resultados. Por eso mantenemos el circuito local. El exceso de p99 de E05 y las aperturas tardías de algunos grupos siguen registrados; no los ocultamos con el promedio».

Mostrar el resumen del informe o ejecutar:

```sh
npm run results
```

«En total, 52 de 60 resultados pasan latencia y completitud. E01 tuvo 25 respuestas degradadas entre 90.000 solicitudes: no cumple cero respaldo, pero el impacto observado fue de 0,0278 %. E06 falló completitud de perfilamiento en una repetición. En E07 y E08 no se usaron datos no elegibles ni se emitieron ofertas definitivas».

## 3:05–3:45 · Corrección e incidencias

Mostrar [gráfica de sondeos](../resultados/graficas/06-sondeos.png) y la sección 3 del informe.

«Encontramos un error nuestro: medíamos el intervalo de sondeos desde el inicio de la solicitud, en vez del instante del sondeo. Corregimos el analizador y eliminamos 52 falsas alarmas sin repetir carga. Las 52 pruebas automatizadas pasan. También quedaron 33 recibos sin confirmar. Las trazas ubican esperas de consulta, pero no permiten atribuir todos esos fallos exclusivamente a Cloudflare».

## 3:45–4:45 · Ajustes de arquitectura

Mostrar las vistas funcional, de interacción y de actualización asíncrona de [arquitectura.md](arquitectura.md). Acercar la parte que se está explicando.

«Conservamos los tres servicios, el plazo de 120 milisegundos, el circuito y la autorización obligatoria. Proponemos tres ajustes: recuperar una lectura SQL transitoria si queda tiempo; actualizar el respaldo autorizado de forma asíncrona desde Acquisition; y guardar resultado y auditoría juntos para publicar después mediante outbox. Identity vuelve a verificar el consentimiento en el trabajo asíncrono. Estos son cambios de diseño para implementar, no mejoras de desempeño ya demostradas».

## 4:45–5:00 · Conclusión

Volver al enlace del repositorio y al cuadro de conclusiones.

«La hipótesis de cumplir todos los criterios no pasa. Los resultados sí respaldan conservar la protección ante fallas y los controles de datos. Cerramos la experimentación con estos hallazgos y con acciones concretas para atender los incumplimientos en Proyecto Final 2».

## Antes de entregar

Comprobar que la grabación muestra la terminal real, el p99 de 556 ms, una gráfica comparativa y los ajustes del modelo. El enlace del video debe abrirse con los permisos de la entrega. Este archivo es el guion; la grabación y su publicación todavía deben realizarse.
