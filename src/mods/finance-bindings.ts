import type { ValueBinding } from "cs2/api";
import { economyBudget, toolbarBottom } from "cs2/bindings";
import type { BudgetItem } from "cs2/bindings";

import { createFinanceStore } from "./finance-store";
import type { FinanceStore } from "./finance-store";

/**
 * Every host export this mod reads, resolved lazily.
 *
 * The previous implementation destructured `economyBudget` and its fields at
 * module scope, so a game update that moved one of those exports threw before
 * any guard could run and took the whole module - toolbar button included -
 * down with it. Reading through optional lookups keeps a rename degradable.
 */
export interface FinanceBindings {
    incomeItems?: ValueBinding<BudgetItem[]>;
    incomeValues?: ValueBinding<number[]>;
    expenseItems?: ValueBinding<BudgetItem[]>;
    expenseValues?: ValueBinding<number[]>;
    totalIncome?: ValueBinding<number>;
    totalExpenses?: ValueBinding<number>;
    moneyDelta?: ValueBinding<number>;
    unlimitedMoney?: ValueBinding<boolean>;
    getItemValue?: (item: BudgetItem, values: number[]) => number;
}

function pick<T>(namespace: unknown, key: string): T | undefined {
    if (!namespace) return undefined;
    const value = (namespace as Record<string, unknown>)[key];
    return value === undefined || value === null ? undefined : (value as T);
}

export function getFinanceBindings(): FinanceBindings {
    return {
        incomeItems: pick(economyBudget, "incomeItems$"),
        incomeValues: pick(economyBudget, "incomeValues$"),
        expenseItems: pick(economyBudget, "expenseItems$"),
        expenseValues: pick(economyBudget, "expenseValues$"),
        totalIncome: pick(economyBudget, "totalIncome$"),
        totalExpenses: pick(economyBudget, "totalExpenses$"),
        moneyDelta: pick(toolbarBottom, "moneyDelta$"),
        unlimitedMoney: pick(toolbarBottom, "unlimitedMoney$"),
        getItemValue: pick(economyBudget, "getItemValue"),
    };
}

/** Snapshot of which host exports resolved, for the single startup log line. */
export function describeFinanceBindings(bindings: FinanceBindings): Record<string, boolean> {
    return {
        incomeItems: !!bindings.incomeItems,
        incomeValues: !!bindings.incomeValues,
        expenseItems: !!bindings.expenseItems,
        expenseValues: !!bindings.expenseValues,
        totalIncome: !!bindings.totalIncome,
        totalExpenses: !!bindings.totalExpenses,
        moneyDelta: !!bindings.moneyDelta,
        unlimitedMoney: !!bindings.unlimitedMoney,
        getItemValue: !!bindings.getItemValue,
    };
}

let store: FinanceStore | null = null;

export function getFinanceStore(): FinanceStore {
    if (!store) store = createFinanceStore(getFinanceBindings());
    return store;
}
