interface Attempt {
    traceId: string;
    operation: string;
    providerAttempt?: boolean;
    providerDispatched?: boolean;
    providerAbortAt?: number;
    cancelledAt?: number;
}
interface Receipt {
    requestId: string;
    operation: string;
}
const key = (id: string, operation: string) => `${operation}/${id}`;
function duplicates(keys: string[]) { const seen = new Set<string>(); return keys.filter(id => seen.has(id) || !seen.add(id)); }
export function reconcileProvider(api: Attempt[], receipts: Receipt[], ends: Receipt[] = []) {
    const attempts = api.filter(a => a.providerAttempt);
    const dispatched = attempts.filter(a => a.providerDispatched !== false);
    const attemptKeys = new Set(dispatched.map(a => key(a.traceId, a.operation)));
    const receiptKeys = new Set(receipts.map(r => key(r.requestId, r.operation)));
    const endKeys = new Set(ends.map(r => key(r.requestId, r.operation)));
    const notDispatched = attempts.filter(a => a.providerDispatched === false);
    const cancelledBeforeDispatch = notDispatched.filter(a => a.providerAbortAt !== undefined || a.cancelledAt !== undefined).map(a => key(a.traceId, a.operation));
    const unexplainedNonDispatch = notDispatched.filter(a => a.providerAbortAt === undefined && a.cancelledAt === undefined).map(a => key(a.traceId, a.operation));
    const missingReceipts = [...attemptKeys].filter(id => !receiptKeys.has(id));
    const unexpectedReceipts = [...receiptKeys].filter(id => !attemptKeys.has(id));
    const duplicateApi = duplicates(api.map(a => key(a.traceId, a.operation)));
    const duplicateReceipts = duplicates(receipts.map(r => key(r.requestId, r.operation)));
    const duplicateEnds = duplicates(ends.map(r => key(r.requestId, r.operation)));
    const missingEnds = [...receiptKeys].filter(id => !endKeys.has(id));
    const unexpectedEnds = [...endKeys].filter(id => !receiptKeys.has(id));
    return { reconciled: ![missingReceipts, unexpectedReceipts, duplicateApi, duplicateReceipts, unexplainedNonDispatch].some(a => a.length),
        attempts: attempts.length, dispatches: dispatched.length, cancelledBeforeDispatch, unexplainedNonDispatch, missingReceipts, unexpectedReceipts, duplicateApi, duplicateReceipts,
        completionReconciled: ![missingEnds, unexpectedEnds, duplicateEnds].some(a => a.length), missingEnds, unexpectedEnds, duplicateEnds };
}
