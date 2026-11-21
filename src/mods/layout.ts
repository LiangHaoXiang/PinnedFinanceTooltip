/**
 * Panel geometry, kept free of DOM and React so it can be tested off-game.
 *
 * Everything is expressed in Gameface `rem` units, which the UI scales with the
 * player's interface scale; `computeRowBudget` converts the measured pixel space
 * above the money field into a row count.
 */

/** Space between the panel and the top edge of the money field, in px. */
export const PANEL_GAP_PX = 20;

/** Header (2 lines) + trend row + two section headers + panel padding, in rem. */
export const PANEL_CHROME_REM = 150;

/** One budget row including its vertical padding, in rem. */
export const PANEL_ROW_REM = 19;

export const MIN_ROWS = 4;
export const MAX_ROWS = 40;

/** A section with items never disappears from the panel; it collapses to this. */
export const SECTION_MIN_ROWS = 3;

/** Mirrors `max-width` in finance-panel.module.scss. */
export const PANEL_MAX_WIDTH_REM = 460;

/** Minimum gap between the panel and either screen edge, in px. */
export const PANEL_EDGE_PX = 8;

export interface RowPlan {
    shown: number;
    hidden: number;
}

export interface SectionPlans {
    income: RowPlan;
    expense: RowPlan;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * How many budget rows fit between the panel's anchor and the top of the screen.
 * Falls back to the minimum when the measurements are unusable (e.g. the toolbar
 * is mid-animation), so the panel stays readable on small windows.
 */
export function computeRowBudget(availablePx: number, remScale: number): number {
    const scale = Number.isFinite(remScale) && remScale > 0 ? remScale : 1;
    const availableRem = Math.max(0, Number.isFinite(availablePx) ? availablePx : 0) / scale;
    const rows = Math.floor((availableRem - PANEL_CHROME_REM) / PANEL_ROW_REM);
    return Math.round(clamp(rows, MIN_ROWS, MAX_ROWS));
}

/**
 * Keeps the panel inside the viewport horizontally. The anchor is the money
 * field's left edge, but the panel is up to 460rem wide and may need to slide
 * left on narrow windows or with a large interface scale.
 */
export function clampPanelLeft(anchorLeft: number, viewportWidthPx: number, remScale: number): number {
    const scale = Number.isFinite(remScale) && remScale > 0 ? remScale : 1;
    const viewport = Number.isFinite(viewportWidthPx) ? viewportWidthPx : 0;
    const maxLeft = Math.max(PANEL_EDGE_PX, viewport - PANEL_MAX_WIDTH_REM * scale - PANEL_EDGE_PX);
    if (!Number.isFinite(anchorLeft)) return PANEL_EDGE_PX;
    return Math.round(Math.min(maxLeft, Math.max(PANEL_EDGE_PX, anchorLeft)));
}

function planFor(count: number, shown: number): RowPlan {
    const safeCount = Math.max(0, Math.floor(count));
    const safeShown = Math.round(clamp(Math.floor(shown), 0, safeCount));
    return { shown: safeShown, hidden: safeCount - safeShown };
}

/**
 * Splits the row budget between the two sections. Each non-empty section keeps
 * its minimum first; the rest is handed out so the section with proportionally
 * more hidden items grows next, which keeps the split roughly proportional
 * instead of starving one side.
 */
export function distributeRows(incomeCount: number, expenseCount: number, budget: number): SectionPlans {
    const income = Math.max(0, Math.floor(incomeCount) || 0);
    const expense = Math.max(0, Math.floor(expenseCount) || 0);
    const total = income + expense;
    const capacity = Math.max(0, Math.floor(budget) || 0);

    if (total <= capacity) {
        return { income: planFor(income, income), expense: planFor(expense, expense) };
    }

    const incomeMin = Math.min(SECTION_MIN_ROWS, income);
    const expenseMin = Math.min(SECTION_MIN_ROWS, expense);
    let incomeShown = 0;
    let expenseShown = 0;

    if (capacity >= incomeMin + expenseMin) {
        incomeShown = incomeMin;
        expenseShown = expenseMin;
        let remaining = capacity - incomeMin - expenseMin;
        let incomeNeed = income - incomeMin;
        let expenseNeed = expense - expenseMin;
        while (remaining > 0 && (incomeNeed > 0 || expenseNeed > 0)) {
            const incomeRatio = incomeNeed > 0 ? incomeNeed / Math.max(1, income) : -1;
            const expenseRatio = expenseNeed > 0 ? expenseNeed / Math.max(1, expense) : -1;
            if (incomeRatio >= expenseRatio) {
                incomeShown += 1;
                incomeNeed -= 1;
            } else {
                expenseShown += 1;
                expenseNeed -= 1;
            }
            remaining -= 1;
        }
    } else {
        // Not even the two minimums fit: split proportionally and give the
        // remainder back when one side runs out of items.
        incomeShown = Math.round((capacity * income) / Math.max(1, total));
        expenseShown = capacity - incomeShown;
        if (incomeShown > income) {
            expenseShown += incomeShown - income;
            incomeShown = income;
        }
        if (expenseShown > expense) {
            incomeShown += expenseShown - expense;
            expenseShown = expense;
        }
    }

    return { income: planFor(income, incomeShown), expense: planFor(expense, expenseShown) };
}
