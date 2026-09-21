type ProbeRow = {
    traceId: string;
    instanceId: string;
    operation: string;
    phase: string;
    probe?: boolean;
    breakerEvents?: {
        event: string;
        at: number;
    }[];
};
export function analyzeProbes(rows: ProbeRow[]) {
    const key = (row: ProbeRow) => `${row.instanceId}/${row.operation}`;
    const groups = new Set(rows.filter(row => row.phase === 'measured').map(key));
    const times = new Map<string, number[]>();
    const expected = new Map<string, number>();
    const missingEvidence: string[] = [];
    for (const row of rows) {
        if (!groups.has(key(row)))
            continue;
        const probes = (row.breakerEvents ?? []).filter(event => event.event === 'probe');
        expected.set(key(row), (expected.get(key(row)) ?? 0) + (row.probe ? 1 : 0));
        if (probes.some(event => !Number.isFinite(event.at))) {
            missingEvidence.push(`${row.operation}/${row.traceId}`);
            continue;
        }
        const group = times.get(key(row)) ?? [];
        group.push(...probes.map(event => event.at));
        times.set(key(row), group);
    }
    let violations = 0;
    for (const [id, group] of times) {
        if (group.length !== expected.get(id))
            missingEvidence.push(id);
        group.sort((a, b) => a - b);
        for (let i = 2; i < group.length; i++)
            if (group[i] - group[i - 2] < 30000)
                violations++;
    }
    return { version: 2, basis: 'breakerEvents.probe.at', violations, missingEvidence,
        scope: 'all phases of isolate/operation groups observed during measurement' };
}
