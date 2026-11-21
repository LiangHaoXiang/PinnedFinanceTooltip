import type { ValueBinding } from "cs2/api";
import type { BudgetItem } from "cs2/bindings";

import type { FinanceBindings } from "./finance-bindings";

/**
 * The economy bindings tick far faster than a pinned panel needs to repaint.
 * The panel used to subscribe to eight bindings individually, and each Cohtml
 * callback is delivered as its own task, so one tick could re-render the whole
 * panel several times. Collecting them behind a single short window turns that
 * into at most one repaint per window.
 */
export const FLUSH_MS = 150;

export interface FinanceSnapshot {
    incomeItems: BudgetItem[];
    incomeValues: number[];
    expenseItems: BudgetItem[];
    expenseValues: number[];
    totalIncome: number;
    totalExpenses: number;
    moneyDelta: number;
    unlimitedMoney: boolean;
}

export interface FinanceStore {
    getSnapshot(): FinanceSnapshot;
    /** Registers a flush listener; returns the unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** A budget row value, guarded against missing/mismatched host data (never NaN). */
    itemValue(item: BudgetItem, values: number[]): number;
    /** Subscribes to the host bindings; reference counted, safe to call twice. */
    start(): void;
    stop(): void;
}

function toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function readBinding<T>(binding: ValueBinding<T> | undefined, fallback: T): T {
    if (!binding) return fallback;
    try {
        const value = binding.value;
        return value === undefined || value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

/**
 * The panel renders money in whole units, so a binding that drifts by a fraction
 * of a unit cannot change a single visible character. Comparing what would be
 * drawn - rather than the raw float - keeps a busy city from repainting the
 * panel on every simulation tick.
 */
function sameDisplayValue(previous: unknown, next: unknown): boolean {
    if (typeof previous === "number" && typeof next === "number") {
        return Math.round(previous) === Math.round(next);
    }
    if (Array.isArray(previous) && Array.isArray(next)) {
        if (previous.length !== next.length) return false;
        for (let index = 0; index < previous.length; index += 1) {
            if (!sameDisplayValue(previous[index], next[index])) return false;
        }
        return true;
    }
    return previous === next;
}

export function createFinanceStore(bindings: FinanceBindings, flushMs: number = FLUSH_MS): FinanceStore {
    let snapshot: FinanceSnapshot = {
        incomeItems: readBinding(bindings.incomeItems, []),
        incomeValues: readBinding(bindings.incomeValues, []),
        expenseItems: readBinding(bindings.expenseItems, []),
        expenseValues: readBinding(bindings.expenseValues, []),
        totalIncome: readBinding(bindings.totalIncome, 0),
        totalExpenses: readBinding(bindings.totalExpenses, 0),
        moneyDelta: readBinding(bindings.moneyDelta, 0),
        unlimitedMoney: readBinding(bindings.unlimitedMoney, false),
    };

    const listeners = new Set<() => void>();
    const disposers: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dirty = false;
    let users = 0;

    function schedule(): void {
        // The first change opens the window; later ones must not extend it, or a
        // continuously updating binding would postpone the repaint forever.
        if (timer !== null) return;
        timer = setTimeout(() => {
            timer = null;
            if (!dirty) return;
            dirty = false;
            for (const listener of Array.from(listeners)) {
                try {
                    listener();
                } catch (error) {
                    console.error("[PinnedFinanceTooltip] store listener failed:", error);
                }
            }
        }, flushMs);
    }

    function update(patch: Partial<FinanceSnapshot>): void {
        let mutated = false;
        let repaint = false;
        const next: FinanceSnapshot = { ...snapshot };
        const record = next as unknown as Record<string, unknown>;
        for (const key of Object.keys(patch) as Array<keyof FinanceSnapshot>) {
            const value = patch[key];
            if (value === undefined) continue;
            const previous = record[key];
            if (previous === value) continue;
            if (!sameDisplayValue(previous, value)) repaint = true;
            record[key] = value;
            mutated = true;
        }
        if (!mutated) return;
        // Keep the freshest value even when it cannot change what is drawn: the
        // next repaint carries it. Notifying on sub-unit drift would repaint the
        // panel several times a second for nothing.
        snapshot = next;
        if (!repaint) return;
        dirty = true;
        schedule();
    }

    function attach(): void {
        const wires: Array<[ValueBinding<unknown> | undefined, (value: unknown) => Partial<FinanceSnapshot>]> = [
            [bindings.incomeItems as ValueBinding<unknown> | undefined, value => ({ incomeItems: toArray<BudgetItem>(value) })],
            [bindings.incomeValues as ValueBinding<unknown> | undefined, value => ({ incomeValues: toArray<number>(value) })],
            [bindings.expenseItems as ValueBinding<unknown> | undefined, value => ({ expenseItems: toArray<BudgetItem>(value) })],
            [bindings.expenseValues as ValueBinding<unknown> | undefined, value => ({ expenseValues: toArray<number>(value) })],
            [bindings.totalIncome as ValueBinding<unknown> | undefined, value => ({ totalIncome: toNumber(value) })],
            [bindings.totalExpenses as ValueBinding<unknown> | undefined, value => ({ totalExpenses: toNumber(value) })],
            [bindings.moneyDelta as ValueBinding<unknown> | undefined, value => ({ moneyDelta: toNumber(value) })],
            [bindings.unlimitedMoney as ValueBinding<unknown> | undefined, value => ({ unlimitedMoney: value === true })],
        ];

        for (const [binding, apply] of wires) {
            if (!binding) continue;
            try {
                const subscription = binding.subscribe(value => update(apply(value)));
                disposers.push(() => {
                    try {
                        subscription.dispose();
                    } catch {
                        // the host already dropped the binding
                    }
                });
            } catch (error) {
                console.error("[PinnedFinanceTooltip] binding subscribe failed:", error);
            }
        }
    }

    function detach(): void {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            if (dispose) dispose();
        }
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        dirty = false;
    }

    return {
        getSnapshot: () => snapshot,
        subscribe: listener => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        itemValue: (item, values) => {
            const getItemValue = bindings.getItemValue;
            if (!getItemValue) return 0;
            try {
                const raw = getItemValue(item, values);
                return Number.isFinite(raw) ? raw : 0;
            } catch {
                return 0;
            }
        },
        start: () => {
            users += 1;
            if (users > 1) return;
            attach();
        },
        stop: () => {
            users = Math.max(0, users - 1);
            if (users > 0) return;
            detach();
        },
    };
}
