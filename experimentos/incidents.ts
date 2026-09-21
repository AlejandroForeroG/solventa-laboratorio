type Event = Record<string, any>;
export function incidentReport(client: Event[], api: Event[], providers: Event[], ends: Event[]) {
    const key = (e: Event) => `${e.operation}/${e.traceId ?? e.requestId}`;
    const server = new Map(api.map(e => [key(e), e]));
    const received = new Set(providers.map(key)), finished = new Set(ends.map(key));
    const incidents: Event[] = [];
    for (const c of client.filter(e => e.kind === 'client_response')) {
        const a = server.get(key(c));
        if (c.classification !== 'technical_error' && a)
            continue;
        incidents.push({ id: key(c), phase: c.phase, at: c.at, category: !a ? 'missing_api_record' : 'client_failure_with_api_record',
            observed: { status: c.status, errorCode: c.errorCode, timings: c.timings, cfRay: c.cfRay ?? null, serverClassification: a?.classification ?? null, serverReason: a?.reason ?? null },
            attribution: 'unresolved', nextEvidence: !a ? 'Correlacionar ingress y handler_end de acquisition con CF-Ray y registros del host. Ausencia de API no prueba ausencia de ejecución.' : 'Comparar ingreso, final del handler y transporte; una respuesta registrada no demuestra entrega al cliente.' });
    }
    for (const a of api) {
        if (a.providerDispatched && !received.has(key(a)))
            incidents.push({ id: key(a), phase: a.phase, category: 'missing_provider_receipt',
                observed: { dispatchAt: a.providerDispatchedAt, abortAt: a.providerAbortAt, abortCause: a.providerAbortCause, classification: a.classification, reason: a.reason }, attribution: 'unresolved',
                nextEvidence: 'Cruzar provider_dispatch, ingress del simulador, provider y evidence_error. Un despacho es intención de fetch, no recepción confirmada.' });
        if (a.classification === 'technical_error' || a.technicalDependencyFailure)
            incidents.push({ id: key(a), phase: a.phase, category: 'server_dependency_or_application_failure',
                observed: { reason: a.reason, dependency: a.dependency, diagnostic: a.diagnostic, activeStage: a.activeStage, consentSql: a.consentSql, snapshotSql: a.snapshotSql }, attribution: 'unresolved',
                nextEvidence: 'Revisar etapa y código SQL, cancelación y métricas de pool en el intervalo; no atribuir SQL únicamente a Cloudflare.' });
    }
    for (const p of providers)
        if (!finished.has(key(p)))
            incidents.push({ id: key(p), phase: p.phase, category: 'missing_provider_end', attribution: 'unresolved', nextEvidence: 'Revisar cancelación, handler_end y evidence_error del simulador.' });
    return { version: 1, scope: 'all_phases', counts: incidents.reduce((n: Record<string, number>, e) => { n[e.category] = (n[e.category] ?? 0) + 1; return n; }, {}), incidents,
        limitations: ['Categorías pueden solaparse por solicitud; no sumar como solicitudes únicas.', 'Logs Cloudflare complementarios no se descargan automáticamente en este informe.', 'Ausencia de evidencia no identifica al responsable. Los resultados históricos no contienen los nuevos ingress.', 'Instrumentación de consola agrega volumen y puede perderse; no equivale a un recibo durable.'],
        mitigations: { client_transport: 'Registrar CPU, DNS y salud del runner; contrastar con runner independiente en diagnóstico separado.', provider: 'Conservar deadline, breaker y fallback seguro; probar cambios por separado sin ocultar errores.', sql: 'Correlacionar connect/query/close y pool; evaluar reintento acotado solo de lectura bajo deadline y presupuesto.', evidence: 'Reexportar por lectura; conservar huecos e INCONCLUSO; investigar errores de persistencia.' } };
}
