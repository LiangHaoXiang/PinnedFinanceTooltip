import {
    createElement,
    Component,
    useEffect,
    useRef,
    useState,
    ComponentType,
    FC,
    ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ModuleRegistry, ModuleRegistryExtend } from "cs2/modding";
import { ValueBinding } from "cs2/api";
import { Portal } from "cs2/ui";
import { LocalizedNumber$1 as LocalizedNumber } from "cs2/l10n";
import {
    economyBudget,
    toolbarBottom,
    game,
    BudgetItem,
} from "cs2/bindings";

const {
    totalIncome$,
    totalExpenses$,
    incomeItems$,
    incomeValues$,
    expenseItems$,
    expenseValues$,
    getItemValue,
} = economyBudget;

const { activeGameScreen$, GameScreen } = game;

import styles from "./pinned-finance-tooltip.module.scss";
import panelStyles from "./finance-panel.module.scss";

/**
 * All host-runtime lookups degrade gracefully: enum values are inlined as string
 * literals and missing component exports fall back to local implementations, so a
 * game update can never crash the bottom toolbar through this mod.
 */
const PortalComp: FC<{ children?: ReactNode }> =
    Portal ?? (({ children }) => createPortal(children, document.body));

const formatNumber = (value: number) =>
    Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const FallbackNumber: FC<{ value: number; unit?: unknown; signed?: boolean }> = ({ value, unit, signed }) => {
    const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
    const suffix = unit === "moneyPerHour" ? "/h" : "";
    return <>{`${sign}${formatNumber(value)}${suffix}`}</>;
};

const NumberComp: FC<{ value: number; unit?: unknown; signed?: boolean }> = (LocalizedNumber as FC<{ value: number; unit?: unknown; signed?: boolean }>) ?? FallbackNumber;

/** Localization entries of the host UI, resolved through the module registry. */
type LocEntry = ComponentType<Record<string, any>>;

interface LocDictionary {
    Main?: { TOOLTIP_TITLE_MONEY?: LocEntry; TOOLTIP_DESCRIPTION_MONEY?: LocEntry };
    Toolbar?: { CURRENT_TREND?: LocEntry };
    EconomyPanel?: {
        INCOME_SECTION_TITLE?: LocEntry;
        EXPENSES_SECTION_TITLE?: LocEntry;
        BUDGET_ITEM?: LocEntry;
    };
}

let loc: LocDictionary | null = null;

/** Renders a host localization component, falling back to plain text when unavailable. */
const LocText = ({ entry, fallback, ...props }: { entry?: LocEntry; fallback: string } & Record<string, any>): JSX.Element => {
    return entry ? createElement(entry, props) : <>{fallback}</>;
};

/** Subscribes with a stable hook count; unregistered or broken bindings yield the fallback. */
function useBindingValue<T>(binding: ValueBinding<T> | undefined, fallback: T): T {
    const [value, setValue] = useState<T>(() => {
        try {
            return binding?.value ?? fallback;
        } catch {
            return fallback;
        }
    });

    useEffect(() => {
        if (!binding) return;
        try {
            setValue(binding.value);
            const subscription = binding.subscribe(v => setValue(() => v));
            return () => subscription.dispose();
        } catch (e) {
            console.error("[PinnedFinanceTooltip] binding subscribe failed:", e);
            return;
        }
    }, [binding]);

    return value;
}

export function registerPinnedFinanceTooltip(registry: ModuleRegistry): void {
    try {
        loc = registry.get("game-ui/common/localization/loc.generated.ts", "Loc") ?? null;
    } catch (e) {
        loc = null;
    }

    console.log("[PinnedFinanceTooltip] loaded. Host runtime:", {
        portal: typeof Portal === "function",
        localizedNumber: typeof LocalizedNumber === "object" || typeof LocalizedNumber === "function",
        economyBudget: !!totalIncome$,
        toolbarBottom: !!toolbarBottom?.moneyDelta$,
        loc: !!loc,
    });

    // NOTE: extending the money field itself is not possible in this game build - its
    // module export compiles to a const binding, so the module registry override setter
    // throws. The bottom toolbar export is a var binding, so it can be wrapped safely.
    registry.extend(
        "game-ui/game/components/toolbar/toolbar.tsx",
        "Toolbar",
        extendToolbar,
    );
}

const extendToolbar: ModuleRegistryExtend = (Toolbar: ComponentType<any>) => {
    return function PinnedFinanceTooltipToolbar(this: unknown, props: Record<string, any>) {
        const [expanded, setExpanded] = useState(false);
        const toggle = () => setExpanded(value => !value);

        // Collapse as soon as the player leaves the live game view: ESC pause menu,
        // save/load screens, new game or options. Event-driven, no polling.
        const activeScreen = useBindingValue(activeGameScreen$, GameScreen.main);
        useEffect(() => {
            if (
                activeScreen === GameScreen.pauseMenu
                || activeScreen === GameScreen.saveGame
                || activeScreen === GameScreen.loadGame
                || activeScreen === GameScreen.newGame
                || activeScreen === GameScreen.options
            ) {
                setExpanded(false);
            }
        }, [activeScreen]);

        return (
            <>
                <Toolbar {...props} />
                {/* Button lives outside the error boundary: panel failures must never
                    remove the toggle or the user cannot recover without reloading. */}
                <ToolbarButtonManager expanded={expanded} onToggle={toggle} />
                {expanded && (
                    <PanelErrorBoundary>
                        <FinancePanel />
                    </PanelErrorBoundary>
                )}
            </>
        );
    };
};

/** Keeps a broken panel from taking down the whole toolbar. */
class PanelErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.error("[PinnedFinanceTooltip] panel failed:", error);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

interface ToolbarButtonManagerProps {
    expanded: boolean;
    onToggle: () => void;
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';

/**
 * Injects a native toggle button into the vanilla money field so it gets normal
 * toolbar hit-testing. Re-attaches itself if React rebuilds the toolbar DOM.
 * Uses no host runtime APIs, so it cannot fail.
 */
const ToolbarButtonManager: FC<ToolbarButtonManagerProps> = ({ expanded, onToggle }) => {
    const buttonRef = useRef<HTMLDivElement | null>(null);
    const onToggleRef = useRef(onToggle);
    onToggleRef.current = onToggle;

    useEffect(() => {
        const find = () => {
            let best: Element | null = null;
            let bestTop = -1;
            document.querySelectorAll('img[src*="Money.svg"]').forEach(img => {
                const r = img.getBoundingClientRect();
                if (r.width > 0 && r.top > bestTop) {
                    bestTop = r.top;
                    best = img;
                }
            });
            if (!best) return;
            const field = (best as Element).closest('[class*="field_"]') ?? best;

            let button = buttonRef.current;
            if (!button) {
                button = document.createElement("div");
                button.title = "Pinned Finance Tooltip";
                button.innerHTML = ICON_SVG;
                // Inside the field for correct flex layout; swallow pointer events so
                // the vanilla click handler on the money field (opens the economy
                // panel) never sees them.
                const swallow = (event: Event) => event.stopPropagation();
                button.addEventListener("pointerdown", swallow);
                button.addEventListener("mousedown", swallow);
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    event.preventDefault();
                    onToggleRef.current();
                });
                buttonRef.current = button;
            }
            if (button.parentElement !== field) {
                field.appendChild(button);
            }
        };
        find();
        // Steady state costs one isConnected check per tick; the DOM query and
        // re-attach only run when the toolbar was rebuilt and the button dropped.
        const timer = window.setInterval(() => {
            if (buttonRef.current?.isConnected) return;
            find();
        }, 1000);
        window.addEventListener("resize", find);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("resize", find);
            if (buttonRef.current) {
                buttonRef.current.remove();
                buttonRef.current = null;
            }
        };
    }, []);

    // Keep the pressed state in sync with the React side.
    useEffect(() => {
        if (buttonRef.current) {
            buttonRef.current.className = expanded ? styles.toggleButtonActive : styles.toggleButton;
        }
    }, [expanded]);

    return null;
};

interface Rect {
    left: number;
    top: number;
}

/** Pinned panel shown above the money field while expanded. */
const FinancePanel: FC = () => {
    const rect = useMoneyFieldRect();

    if (!rect) return null;

    return (
        <PortalComp>
            <div
                className={panelStyles.panel}
                style={{
                    left: `${Math.max(rect.left, 8)}px`,
                    bottom: `${window.innerHeight - rect.top + 12}px`,
                }}
            >
                <FinanceHeader />
                <CurrentTrend />
                <BudgetSections />
            </div>
        </PortalComp>
    );
};

/** Anchors the panel above the money field. The bottom toolbar keeps a fixed
 *  position during gameplay, so resize events are the only drift to follow;
 *  the retry interval stops as soon as the field is located once. */
function useMoneyFieldRect(): Rect | null {
    const [rect, setRect] = useState<Rect | null>(null);

    useEffect(() => {
        let found = false;
        const find = () => {
            let best: Element | null = null;
            let bestTop = -1;
            document.querySelectorAll('img[src*="Money.svg"]').forEach(img => {
                const r = img.getBoundingClientRect();
                if (r.width > 0 && r.top > bestTop) {
                    bestTop = r.top;
                    best = img;
                }
            });
            if (!best) return;
            found = true;
            const field = (best as Element).closest('[class*="field_"]') ?? best;
            const r = field.getBoundingClientRect();
            setRect(prev =>
                prev
                    && Math.abs(prev.left - r.left) < 0.5
                    && Math.abs(prev.top - r.top) < 0.5
                    ? prev
                    : { left: r.left, top: r.top },
            );
        };
        find();
        const timer = window.setInterval(() => {
            if (found) {
                window.clearInterval(timer);
                return;
            }
            find();
        }, 500);
        window.addEventListener("resize", find);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("resize", find);
        };
    }, []);

    return rect;
}

const FinanceHeader = () => {
    return (
        <div className={panelStyles.header}>
            <div className={panelStyles.headerTitle}>
                <LocText entry={loc?.Main?.TOOLTIP_TITLE_MONEY} fallback="Money" />
            </div>
            <div className={panelStyles.headerDescription}>
                <LocText entry={loc?.Main?.TOOLTIP_DESCRIPTION_MONEY} fallback="" />
            </div>
        </div>
    );
};

const CurrentTrend = () => {
    const unlimited = useBindingValue(toolbarBottom?.unlimitedMoney$, false);
    const moneyDelta = useBindingValue(toolbarBottom?.moneyDelta$, 0);

    if (unlimited) return null;

    return (
        <div className={panelStyles.trendRow}>
            <span className={panelStyles.trendLabel}>
                <LocText entry={loc?.Toolbar?.CURRENT_TREND} fallback="Current trend" />
            </span>
            <span className={moneyDelta >= 0 ? panelStyles.positive : panelStyles.negative}>
                <NumberComp value={moneyDelta} unit={"moneyPerHour"} signed />
            </span>
        </div>
    );
};

const BudgetSections = () => {
    const incomeItems = useBindingValue<BudgetItem[]>(incomeItems$, []);
    const incomeValues = useBindingValue<number[]>(incomeValues$, []);
    const expenseItems = useBindingValue<BudgetItem[]>(expenseItems$, []);
    const expenseValues = useBindingValue<number[]>(expenseValues$, []);
    const totalIncome = useBindingValue<number>(totalIncome$, 0);
    const totalExpenses = useBindingValue<number>(totalExpenses$, 0);

    return (
        <>
            <BudgetSection
                kind="income"
                titleEntry={loc?.EconomyPanel?.INCOME_SECTION_TITLE}
                titleFallback="Income"
                items={incomeItems}
                values={incomeValues}
                total={totalIncome}
            />
            <BudgetSection
                kind="expense"
                titleEntry={loc?.EconomyPanel?.EXPENSES_SECTION_TITLE}
                titleFallback="Expenses"
                items={expenseItems}
                values={expenseValues}
                total={totalExpenses}
            />
        </>
    );
};

interface BudgetSectionProps {
    kind: "income" | "expense";
    titleEntry?: LocEntry;
    titleFallback: string;
    items: BudgetItem[];
    values: number[];
    total: number;
}

const BudgetSection: FC<BudgetSectionProps> = ({ kind, titleEntry, titleFallback, items, values, total }) => {
    const activeItems = items.filter(item => item.active);

    return (
        <div className={panelStyles.section}>
            <div className={panelStyles.sectionHeader}>
                <span className={panelStyles.sectionTitle}>
                    <LocText entry={titleEntry} fallback={titleFallback} />
                </span>
                <span className={kind === "income" ? panelStyles.positive : panelStyles.negative}>
                    <NumberComp value={total} unit={"money"} />
                </span>
            </div>
            {activeItems.map(item => {
                const value = getItemValue ? getItemValue(item, values) : 0;
                return (
                    <div className={panelStyles.itemRow} key={item.id}>
                        <span className={panelStyles.itemName}>
                            <span
                                className={panelStyles.itemLegend}
                                style={{ backgroundColor: toCssColor(item.color) }}
                            />
                            <LocText
                                entry={loc?.EconomyPanel?.BUDGET_ITEM}
                                hash={item.id}
                                showIdOnFail={false}
                                fallback={item.id}
                            />
                        </span>
                        <span className={panelStyles.itemValue}>
                            <NumberComp value={value} unit={"money"} />
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

function toCssColor(color: { r: number; g: number; b: number; a?: number } | undefined): string {
    if (!color) return "transparent";
    const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
    return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${color.a ?? 1})`;
}
