import { memo, useMemo } from "react";
import type { FC, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BudgetItem } from "cs2/bindings";
import { Portal } from "cs2/ui";

import panelStyles from "./finance-panel.module.scss";
import { NumberComp, toCssColor } from "./format";
import { getFinanceStore } from "./finance-bindings";
import { useFinanceSnapshot } from "./use-finance-snapshot";
import { useAnchorState } from "./use-anchor-state";
import { computeRowBudget, clampPanelLeft, distributeRows, PANEL_GAP_PX } from "./layout";
import type { RowPlan } from "./layout";
import { getRemScale } from "./money-anchor";
import { getLoc, LocText } from "./localization";
import type { LocEntry } from "./localization";

const PortalComp: FC<{ children?: ReactNode }> = Portal ?? (({ children }) => createPortal(children, document.body));

interface BudgetRowData {
    id: string;
    value: number;
    color: string;
}

function toRows(items: BudgetItem[], values: number[], itemValue: (item: BudgetItem, values: number[]) => number): BudgetRowData[] {
    const rows: BudgetRowData[] = [];
    for (const item of items) {
        rows.push({ id: item.id, value: itemValue(item, values), color: toCssColor(item.color) });
    }
    return rows;
}

/**
 * Memoized on primitives so a flush that only moves one category's number does
 * not re-render every other row (the host localization components are not free).
 */
const BudgetRow = memo(function BudgetRow({ id, value, color }: BudgetRowData) {
    return (
        <div className={panelStyles.itemRow}>
            <span className={panelStyles.itemName}>
                <span className={panelStyles.itemLegend} style={{ backgroundColor: color }} />
                <LocText entry={getLoc()?.EconomyPanel?.BUDGET_ITEM} hash={id} showIdOnFail={false} fallback={id} />
            </span>
            <span className={panelStyles.itemValue}>
                <NumberComp value={value} unit={"money"} />
            </span>
        </div>
    );
});

interface BudgetSectionProps {
    kind: "income" | "expense";
    titleEntry?: LocEntry;
    titleFallback: string;
    rows: BudgetRowData[];
    plan: RowPlan;
    total: number;
}

const BudgetSection: FC<BudgetSectionProps> = ({ kind, titleEntry, titleFallback, rows, plan, total }) => {
    const shownRows = plan.shown > 0 ? rows.slice(0, plan.shown) : [];
    return (
        <div className={panelStyles.section}>
            <div className={panelStyles.sectionHeader}>
                <span>
                    <LocText entry={titleEntry} fallback={titleFallback} />
                </span>
                <span className={kind === "income" ? panelStyles.positive : panelStyles.negative}>
                    <NumberComp value={total} unit={"money"} />
                </span>
            </div>
            {shownRows.map(row => (
                <BudgetRow key={row.id} {...row} />
            ))}
            {/* No scrolling is possible on a pointer-events:none panel, so the rows
                that do not fit are counted instead of being clipped invisibly. */}
            {plan.hidden > 0 ? <div className={panelStyles.sectionFooter}>{`+${plan.hidden}`}</div> : null}
        </div>
    );
};

const FinanceHeader: FC = () => (
    <div className={panelStyles.header}>
        <div className={panelStyles.headerTitle}>
            <LocText entry={getLoc()?.Main?.TOOLTIP_TITLE_MONEY} fallback="Money" />
        </div>
        <div className={panelStyles.headerDescription}>
            <LocText entry={getLoc()?.Main?.TOOLTIP_DESCRIPTION_MONEY} fallback="" />
        </div>
    </div>
);

const CurrentTrend: FC<{ moneyDelta: number; unlimitedMoney: boolean }> = ({ moneyDelta, unlimitedMoney }) => {
    if (unlimitedMoney) return null;
    return (
        <div className={panelStyles.trendRow}>
            <span className={panelStyles.trendLabel}>
                <LocText entry={getLoc()?.Toolbar?.CURRENT_TREND} fallback="Current trend" />
            </span>
            <span className={moneyDelta >= 0 ? panelStyles.positive : panelStyles.negative}>
                <NumberComp value={moneyDelta} unit={"moneyPerHour"} signed />
            </span>
        </div>
    );
};

/** Pinned panel shown above the money field while expanded. */
export const FinancePanel: FC = () => {
    const store = getFinanceStore();
    const snapshot = useFinanceSnapshot(store);
    const { anchor, visible } = useAnchorState();

    const incomeItems = useMemo(() => snapshot.incomeItems.filter(item => item.active), [snapshot.incomeItems]);
    const expenseItems = useMemo(() => snapshot.expenseItems.filter(item => item.active), [snapshot.expenseItems]);
    const incomeRows = useMemo(() => toRows(incomeItems, snapshot.incomeValues, store.itemValue), [incomeItems, snapshot.incomeValues, store]);
    const expenseRows = useMemo(() => toRows(expenseItems, snapshot.expenseValues, store.itemValue), [expenseItems, snapshot.expenseValues, store]);

    // Hiding instead of collapsing keeps `expanded` intact: the panel comes back
    // by itself after photo mode or a hide-UI toggle instead of needing a click.
    if (!anchor || !visible) return null;

    const remScale = getRemScale();
    const budget = computeRowBudget(anchor.top - PANEL_GAP_PX, remScale);
    const plans = distributeRows(incomeRows.length, expenseRows.length, budget);
    const left = clampPanelLeft(anchor.left, window.innerWidth, remScale);

    return (
        <PortalComp>
            <div
                className={panelStyles.panel}
                style={{
                    left: `${left}px`,
                    bottom: `${window.innerHeight - anchor.top + 12}px`,
                }}
            >
                <FinanceHeader />
                <CurrentTrend moneyDelta={snapshot.moneyDelta} unlimitedMoney={snapshot.unlimitedMoney} />
                <BudgetSection
                    kind="income"
                    titleEntry={getLoc()?.EconomyPanel?.INCOME_SECTION_TITLE}
                    titleFallback="Income"
                    rows={incomeRows}
                    plan={plans.income}
                    total={snapshot.totalIncome}
                />
                <BudgetSection
                    kind="expense"
                    titleEntry={getLoc()?.EconomyPanel?.EXPENSES_SECTION_TITLE}
                    titleFallback="Expenses"
                    rows={expenseRows}
                    plan={plans.expense}
                    total={snapshot.totalExpenses}
                />
            </div>
        </PortalComp>
    );
};
