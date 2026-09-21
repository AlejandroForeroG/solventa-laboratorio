# Reproducción de resultados

## Demostración incluida

Después de `npm ci`, ejecutar `npm run demo`. El comando usa los tres archivos comprimidos de `resultados/demo/` y la configuración original de E05 r2. Verifica cinco archivos contra el manifiesto, recalcula latencia y completitud, exige coincidencia con las métricas históricas y guarda `.replay/<runId>/reproduccion.json`.

El proceso puede tardar unos segundos según el equipo. E05 r2 conserva el p99 de cotización de 556 ms frente a una meta de 500 ms. Que el programa termine correctamente significa que reprodujo el resultado, no que el escenario haya pasado.

`npm run results` lee los resultados de las 30 corridas y muestra las 60 combinaciones de operación y repetición. Su columna Pasa/No pasa evalúa latencia y completitud. El informe añade respaldo, privacidad, apertura, reducción de llamadas, recuperación y trazabilidad.

## Recalcular las 30 corridas

Se necesita Python 3.11 o posterior, aproximadamente 383 MiB de descarga y al menos 10 GB libres: los originales descomprimidos ocupan 7,06 GiB y el análisis genera archivos adicionales. Los ZIP se pueden descargar desde [laboratorio-s7](https://github.com/AlejandroForeroG/solventa-laboratorio/releases/tag/laboratorio-s7). Con GitHub CLI:

```sh
gh release download laboratorio-s7 --repo AlejandroForeroG/solventa-laboratorio --pattern "*.zip" --dir descargas
python tools/extract-evidence.py descargas
npm run reproduce
```

El extractor comprueba cada ZIP antes de extraerlo. El analizador verifica los archivos de entrada y compara las métricas originales de cada corrida. Esta operación no contacta al banco ni al proveedor simulado. El resultado se escribe en `.replay/`; los originales de `resultados/` no cambian.

## Qué contiene la evidencia

Cada ZIP incluye configuración, resultado original, resumen k6, registro detallado k6, eventos del cliente, eventos del servidor, manifiesto de fuentes y copia de las fuentes ejecutadas. `resultados/corridas/` conserva los resúmenes y el recálculo de sondeos de cada corrida sin exigir la descarga masiva.

La corrección del analizador usa el instante del sondeo, agrupado por instancia y operación. Eliminó 52 falsas alarmas. Las métricas de latencia y completitud permanecen iguales. Los estados automáticos pasan de 12 a 14 corridas con criterios básicos cumplidos; las 14 inconclusas siguen identificadas por sus lagunas de evidencia. El dictamen final por objetivo figura en [resultados.md](resultados.md).

La fuente activa está organizada y formateada para su publicación. La fuente histórica dentro de los ZIP corresponde a la ejecutada y conserva sus hashes; no se espera que ambos árboles tengan las mismas huellas después de retirar comentarios.

## Análisis agregado y gráficas

Las herramientas Python permiten reconstruir los CSV, la comparación de llamadas, los grupos del circuito y las gráficas. Es un paso opcional después de extraer los 30 ZIP:

```sh
python -m pip install -r tools/analisis/requirements.txt
python tools/analisis/analizar-30.py
python tools/analisis/verificar-ventanas-30.py
python tools/analisis/graficar-30.py
```

Los archivos derivados se escriben en `.replay/analisis/`; las figuras quedan en su subcarpeta `graficas`. Los archivos publicados en `resultados/` permanecen intactos. La tipografía de la gráfica puede variar si el equipo no dispone de Times New Roman; sus datos y escalas conservan el cálculo.
