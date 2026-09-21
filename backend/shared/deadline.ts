export async function withinDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_ok, fail) => { timer = setTimeout(() => { const error = new Error('hard_deadline'); fail(error); controller.abort(error); }, ms); });
    try {
        return await Promise.race([work(controller.signal), timeout]);
    }
    finally {
        clearTimeout(timer!);
    }
}
export async function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal)
        return work;
    let abort: () => void = () => { };
    const stopped = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (signal.aborted)
            abort();
        else
            signal.addEventListener('abort', abort, { once: true });
    });
    try {
        return await Promise.race([work, stopped]);
    }
    finally {
        signal.removeEventListener('abort', abort);
    }
}
