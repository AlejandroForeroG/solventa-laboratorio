# Solventa · Laboratorio de arquitectura

Banco experimental de cotización y perfilamiento de Solventa, Proyecto Final 1, MISW4501. Incluye el código del banco, los resultados de 30 corridas con datos sintéticos y el análisis final de Semana 7.

## Ejecutar la demostración

Requisito: Node.js 22 o posterior y Git.

```sh
git clone https://github.com/AlejandroForeroG/solventa-laboratorio.git
cd solventa-laboratorio
npm ci
npm run demo
npm run results
```

`demo` descomprime los registros incluidos de E05, repetición 2, comprueba sus huellas SHA-256 y recalcula las métricas. Muestra el p99 de cotización de 556 ms y su incumplimiento del límite de 500 ms. `results` presenta los 60 resultados por operación y repetición. Ambos comandos trabajan con registros existentes: no requieren cuenta de Cloudflare, base de datos, k6 ni credenciales y no generan carga remota.

## Resultado del laboratorio

Se emitieron 899.835 solicitudes durante medición: 899.033 completas y 802 no completas. En 52 de los 60 resultados pasan latencia y completitud. E05 evitó entre 92,24 % y 97,31 % de las llamadas frente a E09, el control sin circuito.

La hipótesis conjunta no pasa. E01 incumple cero respaldo; E05 presenta p99 de cotización fuera del límite y aperturas que no cumplen el plazo en todos los grupos; E06 incumple completitud de perfilamiento en una repetición. Se conserva el circuito, el plazo de 120 ms y la autorización obligatoria. Se proponen recuperación acotada de lecturas SQL, actualización asíncrona del respaldo y auditoría durable. La campaña está cerrada; E10 y E11 no se ejecutaron.

## Documentación y evidencias

| Recurso | Contenido |
|---|---|
| [Resultados y análisis](docs/resultados.md) | Objetivos, dictámenes Pasa/No pasa, 14 figuras y glosario |
| [Reproducción](docs/reproduccion.md) | Demostración local, descarga y recálculo de las 30 corridas |
| [Guion del video](docs/video-laboratorio.md) | Qué mostrar, comandos y narración |
| [Arquitectura ajustada](docs/arquitectura.md) | Modelos completos y decisiones vinculadas a resultados |
| [Funcionamiento del banco](docs/banco.md) | Componentes, configuración y comandos |
| [Protocolo original](docs/protocolo-s5.md) | Hipótesis y umbrales previos a la campaña |
| [Resultados tabulares](resultados/metricas.csv) | Las 60 mediciones individuales |
| [Registros originales](https://github.com/AlejandroForeroG/solventa-laboratorio/releases/tag/laboratorio-s7) | Un ZIP por corrida, con fuentes y registros del cliente y servidor |
| [Manifiesto](resultados/manifest.json) | Identificación y huellas de cada archivo y ZIP |

## Organización

```text
backend/          Dominio, aplicación, adaptadores y servicios Acquisition e Identity
experimentos/     Simulador, generador k6, escenarios, analizador e infraestructura local
tools/            Demostración, revisión de resultados y extracción de evidencias
resultados/       Resúmenes originales, análisis derivados, CSV, gráficas y capturas
docs/             Informe, protocolo, guía del banco, video y arquitectura
```

La lógica se publica formateada y sin comentarios. Las explicaciones están en la documentación. Los archivos históricos de cada corrida se conservan sin editar, incluidas sus fuentes, para comprobar las huellas de ejecución. Los identificadores y las direcciones del montaje en esas evidencias son referencias históricas, no credenciales para usarlo.

## Comprobaciones locales

```sh
npm run typecheck
npm test
```

La integración continua ejecuta estas comprobaciones y la demostración offline. Los estados automáticos originales se conservan; el dictamen académico por objetivo está en el informe. Las opciones diagnósticas SQL del banco no se presentan como mejoras validadas por estas 30 corridas.
