import type { Consent, Run, Signals } from './contracts';
export function consentFixture(run: Run): Consent {
    return { allowed: run.fixture !== 'revoked', reference: `synthetic-${run.fixture}`, checkedAt: run.fixtureNow };
}
export function snapshotFixture(run: Run): Signals | null {
    if (run.fixture === 'absent')
        return null;
    return { version: '1', score: 70, source: 'snapshot', consentRef: `synthetic-${run.fixture}`,
        observedAt: run.fixtureNow - 60000, validUntil: run.fixtureNow + (run.fixture === 'expired' ? -1 : 3600000) };
}
