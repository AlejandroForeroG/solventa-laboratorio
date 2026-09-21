import type { Consent, Operation, Run, Signals } from '../shared/contracts';
export interface ConsentPort {
    check(run: Run): Promise<Consent>;
}
export interface SnapshotPort {
    read(run: Run): Promise<Signals | null>;
}
export interface OpenFinancePort {
    read(run: Run, operation: Operation, requestId: string, signal: AbortSignal): Promise<Signals>;
}
