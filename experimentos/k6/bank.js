import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
const config = JSON.parse(open(__ENV.RUN_FILE));
const run = config.run;
const totalSeconds = (run.warmupMs + run.conditioningMs + run.measuredMs) / 1000;
const rate = config.rate;
export const options = {
    scenarios: { quote: { executor: 'constant-arrival-rate', rate: rate * 0.7, timeUnit: '1s', duration: `${totalSeconds}s`, preAllocatedVUs: 50, maxVUs: 300, exec: 'quote' },
        profile: { executor: 'constant-arrival-rate', rate: rate * 0.3, timeUnit: '1s', duration: `${totalSeconds}s`, preAllocatedVUs: 30, maxVUs: 150, exec: 'profile' } },
    discardResponseBodies: false,
    systemTags: ['status', 'method', 'name', 'scenario', 'error_code', 'expected_response'],
    thresholds: { dropped_iterations: ['count==0'] },
};
const emitted = new Counter('bank_emitted');
const complete = new Counter('bank_complete');
const classified = new Counter('bank_classified');
const latency = new Trend('bank_e2e_ms', true);
const providerCalls = new Counter('bank_provider_attempts');
export function setup() {
    const remaining = run.startAt - Date.now();
    if (remaining < 0)
        throw new Error('El inicio de la corrida ya pasó. Prepare un runId nuevo.');
    sleep(remaining / 1000);
}
function send(operation) {
    while (Date.now() < run.startAt)
        sleep((run.startAt - Date.now()) / 1000);
    const started = Date.now();
    const elapsed = started - run.startAt;
    const requestId = `${operation}-${exec.scenario.iterationInTest}`;
    if (elapsed >= run.warmupMs + run.conditioningMs + run.measuredMs) {
        console.log(JSON.stringify({ kind: 'client_skipped', requestId, operation, phase: 'finished', at: started }));
        return;
    }
    const phase = elapsed < run.warmupMs ? 'warmup' : elapsed < run.warmupMs + run.conditioningMs ? 'conditioning' : 'measured';
    const tags = { operation, phase };
    console.log(JSON.stringify({ kind: 'client_emitted', requestId, operation, phase, at: started }));
    emitted.add(1, tags);
    const response = http.post(`${config.baseUrl}/v1/${operation}`, JSON.stringify({ run, requestId, emittedAt: started }), { headers: { Authorization: `Bearer ${__ENV.BANK_TOKEN}`, 'Content-Type': 'application/json', 'x-run-id': run.runId, 'x-request-id': requestId, 'x-operation': operation }, timeout: '2s', tags: { ...tags, name: `/v1/${operation}` } });
    const finished = Date.now(), e2eMs = finished - started;
    latency.add(e2eMs, tags);
    let body;
    try {
        body = response.json();
    }
    catch {
        body = null;
    }
    const correlated = body && body.traceId === requestId;
    const classification = correlated && ['normal', 'degraded', 'denied', 'technical_error'].includes(body.classification) ? body.classification : 'technical_error';
    const validStatus = classification === 'denied' ? run.caseId === 'E08' && response.status === 403 : response.status >= 200 && response.status < 300;
    const ok = correlated && validStatus && classification !== 'technical_error';
    classified.add(1, { ...tags, classification });
    complete.add(ok ? 1 : 0, tags);
    providerCalls.add(body && body.providerAttempt ? 1 : 0, tags);
    console.log(JSON.stringify({ kind: 'client_response', requestId, operation, phase, at: finished, emittedAt: started, e2eMs,
        status: response.status, errorCode: response.error_code || 0, correlated: Boolean(correlated), classification, complete: Boolean(ok), technicalDependencyFailure: Boolean(body && body.technicalDependencyFailure),
        reason: correlated && typeof body.reason === 'string' && /^[a-z_]{1,80}$/.test(body.reason) ? body.reason : null,
        cfRay: response.headers['Cf-Ray'] || null, traceVersion: 1, timings: response.timings }));
}
export function quote() { send('quote'); }
export function profile() { send('profile'); }
export function handleSummary(data) { return { [__ENV.SUMMARY_FILE]: JSON.stringify(data, null, 2) }; }
