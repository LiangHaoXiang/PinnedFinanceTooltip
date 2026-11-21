import { createElement } from "react";
import type { ComponentType } from "react";

/** Localization entries of the host UI, resolved through the module registry. */
export type LocEntry = ComponentType<Record<string, any>>;

export interface LocDictionary {
    Main?: { TOOLTIP_TITLE_MONEY?: LocEntry; TOOLTIP_DESCRIPTION_MONEY?: LocEntry };
    Toolbar?: { CURRENT_TREND?: LocEntry };
    EconomyPanel?: {
        INCOME_SECTION_TITLE?: LocEntry;
        EXPENSES_SECTION_TITLE?: LocEntry;
        BUDGET_ITEM?: LocEntry;
    };
}

let loc: LocDictionary | null = null;

export function setLoc(next: LocDictionary | null): void {
    loc = next;
}

export function getLoc(): LocDictionary | null {
    return loc;
}

/** Renders a host localization component, falling back to plain text when unavailable. */
export const LocText = ({ entry, fallback, ...props }: { entry?: LocEntry; fallback: string } & Record<string, any>): JSX.Element =>
    entry ? createElement(entry, props) : <>{fallback}</>;
