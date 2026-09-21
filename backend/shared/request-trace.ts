import type { MiddlewareHandler } from 'hono';
export function correlation(headers: Headers) {
    const safe = (name: string, max: number) => { const v = headers.get(name); return v && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(v) ? v : undefined; };
    return { runId: safe('x-run-id', 100), traceId: safe('x-request-id', 150), operation: safe('x-operation', 16), cfRay: safe('cf-ray', 64) };
}
export function requestTrace(service: string): MiddlewareHandler {
    return async (c, next) => {
        const ids = correlation(c.req.raw.headers);
        if (!ids.runId || !ids.traceId) {
            await next();
            return;
        }
        const at = Date.now();
        const log = (stage: string, extra = {}) => console.log(JSON.stringify({ kind: 'request_trace', traceVersion: 1, service, ...ids, stage, at: Date.now(), ...extra }));
        log('ingress');
        try {
            await next();
        }
        finally {
            log('handler_end', { durationMs: Date.now() - at, status: c.res.status, aborted: c.req.raw.signal.aborted });
        }
    };
}
