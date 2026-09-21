export function evidenceFailure(error: unknown) {
    const e = error as {
        message?: unknown;
        name?: unknown;
        retryable?: unknown;
        overloaded?: unknown;
        remote?: unknown;
        code?: unknown;
        status?: unknown;
    } | null;
    const message = typeof e?.message === 'string' ? e.message : '';
    const code = /overload/i.test(message) ? 'OVERLOADED' : /reset/i.test(message) ? 'RESET' : /disconnect|network|connection/i.test(message) ? 'TRANSPORT' : /timeout|timed out/i.test(message) ? 'TIMEOUT' : message === 'evidence_key_conflict' ? 'KEY_CONFLICT' : message === 'evidence_http_error' ? 'HTTP_ERROR' : 'UNKNOWN';
    return { code, name: ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(String(e?.name)) ? e!.name : 'Error',
        retryable: e?.retryable === true, overloaded: e?.overloaded === true, remote: e?.remote === true,
        ...(typeof e?.status === 'number' ? { status: e.status } : {}) };
}
export async function deliverEvidence(send: () => Promise<unknown>, context: Record<string, unknown>, log: (event: Record<string, unknown>) => void = e => console.error(JSON.stringify(e)), pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await send();
            if (attempt > 1)
                log({ kind: 'evidence_recovered', ...context, attempt, at: Date.now() });
            return;
        }
        catch (error) {
            const diagnostic = evidenceFailure(error);
            const retry = diagnostic.retryable && !diagnostic.overloaded && diagnostic.code !== 'KEY_CONFLICT' && attempt < 3;
            log({ kind: 'evidence_error', ...context, attempt, at: Date.now(), diagnostic, retry, reason: 'record_failed' });
            if (!retry)
                return;
            await pause(100 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
        }
    }
}
