export type CircuitState = 'closed' | 'open' | 'half_open';
export interface Ticket {
    generation: number;
    probe: boolean;
}
export class CircuitBreaker {
    private events: Record<string, unknown>[] = [];
    state: CircuitState = 'closed';
    private samples: {
        at: number;
        ok: boolean;
    }[] = [];
    private openedAt = 0;
    private probeTimes: number[] = [];
    private successes = 0;
    private generation = 0;
    private probesInFlight = 0;
    constructor(private observer: (event: Record<string, unknown>) => void = () => { }) { }
    private emit(event: Record<string, unknown>) { this.events.push(event); this.observer(event); }
    drainEvents() { const events = this.events; this.events = []; return events; }
    acquire(now: number): Ticket | null {
        if (this.state === 'open') {
            if (now - this.openedAt < 30000)
                return null;
            this.state = 'half_open';
            this.emit({ event: 'half_open', at: now });
        }
        if (this.state === 'half_open') {
            this.probeTimes = this.probeTimes.filter(t => now - t < 30000);
            if (this.probeTimes.length >= 2 || this.probesInFlight)
                return null;
            this.probeTimes.push(now);
            this.probesInFlight++;
            this.emit({ event: 'probe', at: now });
            return { generation: this.generation, probe: true };
        }
        return { generation: this.generation, probe: false };
    }
    complete(ticket: Ticket, ok: boolean, now: number) {
        if (ticket.generation !== this.generation)
            return;
        if (ticket.probe) {
            this.probesInFlight--;
            if (!ok)
                return this.open(now);
            this.successes++;
            this.emit({ event: 'probe_success', at: now, successes: this.successes });
            if (this.successes === 5) {
                this.state = 'closed';
                this.samples = [];
                this.successes = 0;
                this.generation++;
                this.emit({ event: 'closed', at: now });
            }
            return;
        }
        if (this.state !== 'closed')
            return;
        this.samples = [...this.samples.filter(s => now - s.at <= 30000), { at: now, ok }].slice(-20);
        if (this.samples.length >= 10 && this.samples.filter(s => !s.ok).length / this.samples.length >= 0.5)
            this.open(now);
    }
    private open(now: number) {
        this.state = 'open';
        this.openedAt = now;
        this.successes = 0;
        this.probesInFlight = 0;
        this.generation++;
        this.emit({ event: 'open', at: now });
    }
}
