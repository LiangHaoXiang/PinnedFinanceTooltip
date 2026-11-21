import { useEffect, useState } from "react";

import type { FinanceSnapshot, FinanceStore } from "./finance-store";

/**
 * Subscribes the panel to the coalescing store: one repaint per flush window
 * instead of one per binding callback.
 */
export function useFinanceSnapshot(store: FinanceStore): FinanceSnapshot {
    const [snapshot, setSnapshot] = useState<FinanceSnapshot>(() => store.getSnapshot());

    useEffect(() => {
        setSnapshot(store.getSnapshot());
        const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
        store.start();
        return () => {
            unsubscribe();
            store.stop();
        };
    }, [store]);

    return snapshot;
}
