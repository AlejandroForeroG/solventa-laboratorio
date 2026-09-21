import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
const eventSchema = z.object({ kind: z.enum(['client_emitted', 'client_response', 'client_skipped']), requestId: z.string(), operation: z.enum(['quote', 'profile']), phase: z.string(), at: z.number(),
    classification: z.string().optional(), correlated: z.boolean().optional(), status: z.number().optional(), errorCode: z.number().optional() }).passthrough();
type Event = z.infer<typeof eventSchema>;
type Api = {
    traceId: string;
    operation: string;
    phase: string;
    classification: string;
};
const key = (event: {
    requestId: string;
    operation: string;
}) => `${event.operation}/${event.requestId}`;
function index(events: Event[]) {
    const entries = new Map<string, Event>(), duplicates: string[] = [];
    for (const event of events) {
        const id = key(event);
        if (entries.has(id))
            duplicates.push(id);
        entries.set(id, event);
    }
    return { entries, duplicates };
}
export function reconcileClient(events: Event[], api: Api[]) {
    const phases = Object.fromEntries(['warmup', 'conditioning', 'measured'].map(phase => {
        const emitted = index(events.filter(x => x.kind === 'client_emitted' && x.phase === phase));
        const responses = index(events.filter(x => x.kind === 'client_response' && x.phase === phase));
        const server = index(api.filter(x => x.phase === phase).map(x => ({ kind: 'client_response' as const, requestId: x.traceId, operation: x.operation as Event['operation'], phase: x.phase, classification: x.classification, at: 0 })));
        const missingResponses = [...emitted.entries.keys()].filter(id => !responses.entries.has(id));
        const missingApi = [...emitted.entries.keys()].filter(id => !server.entries.has(id));
        const unexpectedResponses = [...responses.entries.keys()].filter(id => !emitted.entries.has(id));
        const unexpectedApi = [...server.entries.keys()].filter(id => !emitted.entries.has(id));
        const differences = [...responses.entries].filter(([id, r]) => server.entries.has(id) && r.classification !== server.entries.get(id)!.classification).map(([id]) => id);
        const duplicateIds = { emitted: emitted.duplicates, responses: responses.duplicates, api: server.duplicates };
        return [phase, { emitted: emitted.entries.size, responses: responses.entries.size, api: server.entries.size, missingResponses, missingApi, unexpectedResponses, unexpectedApi, differences, duplicateIds,
                reconciled: ![missingResponses, missingApi, unexpectedResponses, unexpectedApi, ...Object.values(duplicateIds)].some(x => x.length) }];
    }));
    return { available: true, phases, skipped: events.filter(x => x.kind === 'client_skipped').length, reconciled: Object.values(phases).every(x => x.reconciled) };
}
export async function readClientLedger(file: string) {
    const events: Event[] = [];
    for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
        if (!line.trim())
            continue;
        const logged = JSON.parse(line);
        events.push(eventSchema.parse(typeof logged.msg === 'string' ? JSON.parse(logged.msg) : logged));
    }
    return events;
}
