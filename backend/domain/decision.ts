import type { Consent, Decision, Operation, Signals } from '../shared/contracts';
export function eligible(signals: Signals | null, consent: Consent, now: number): signals is Signals {
    return Boolean(signals && consent.allowed && signals.consentRef === consent.reference &&
        signals.observedAt <= now && signals.validUntil > now);
}
export function decide(operation: Operation, consent: Consent, signals: Signals | null, now: number, degraded: boolean, reason: string): Decision {
    if (!consent.allowed)
        return { classification: 'denied', reason: 'consent_revoked', definitiveOffer: false, source: null, ageMs: null, validUntil: null };
    if (!eligible(signals, consent, now))
        return { classification: 'degraded', reason: 'no_eligible_snapshot', definitiveOffer: false, source: null, ageMs: null, validUntil: null };
    return { classification: degraded ? 'degraded' : 'normal', reason,
        definitiveOffer: operation === 'quote' && !degraded, source: signals.source,
        ageMs: now - signals.observedAt, validUntil: signals.validUntil, score: signals.score,
        ...(operation === 'quote' ? { premiumCop: 10000 + (100 - signals.score) * 100 } : {}) };
}
