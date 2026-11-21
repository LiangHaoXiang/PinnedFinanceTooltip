import { Component, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { ModuleRegistry, ModuleRegistryExtend } from "cs2/modding";
import type { ValueBinding } from "cs2/api";
import { game } from "cs2/bindings";

import { FinancePanel } from "./finance-panel";
import { ToolbarButtonManager } from "./toolbar-button";
import { getLoc, setLoc } from "./localization";
import type { LocDictionary } from "./localization";
import { describeFinanceBindings, getFinanceBindings } from "./finance-bindings";
import { useBindingValue } from "./use-binding-value";

/**
 * Screens during which the pinned panel collapses: pause menu (ESC), save, load,
 * new game and options. The numeric fallbacks match 1.6.2f1 and are only used
 * when the host enum cannot be read.
 */
const CLOSING_SCREEN_FALLBACKS = [10, 11, 12, 13, 14];

let closingScreens: number[] | null = null;

function getActiveGameScreenBinding(): ValueBinding<number> | undefined {
    const namespace = game as unknown as Record<string, unknown> | undefined;
    const binding = namespace?.activeGameScreen$;
    return binding ? (binding as ValueBinding<number>) : undefined;
}

function getClosingScreens(): number[] {
    if (closingScreens) return closingScreens;
    const screens = (game as unknown as Record<string, unknown> | undefined)?.GameScreen as Record<string, unknown> | undefined;
    const values = screens
        ? [screens.pauseMenu, screens.saveGame, screens.loadGame, screens.newGame, screens.options].filter(
              (value): value is number => typeof value === "number",
          )
        : [];
    closingScreens = values.length > 0 ? values : CLOSING_SCREEN_FALLBACKS;
    return closingScreens;
}

export function registerPinnedFinanceTooltip(registry: ModuleRegistry): void {
    try {
        setLoc((registry.get("game-ui/common/localization/loc.generated.ts", "Loc") ?? null) as LocDictionary | null);
    } catch {
        setLoc(null);
    }

    // Gameface only forwards error-level console output to Player.log, so the
    // startup diagnostic is a single explicit "not an error" line. The payload is
    // stringified because an object argument logs as "[object Object]".
    console.error(
        "[PFT] info: module loaded (not an error)",
        JSON.stringify({
            bindings: describeFinanceBindings(getFinanceBindings()),
            activeGameScreen: !!getActiveGameScreenBinding(),
            loc: !!getLoc(),
        }),
    );

    // NOTE: extending the money field itself is not possible in this game build - its
    // module export compiles to a const binding, so the module registry override setter
    // throws. The game renders one of three toolbar variants (new / legacy / console
    // gamepad UI); all three export var bindings and render the same MoneyField, so a
    // single wrapper works for each and only the active one is mounted at a time.
    const extendTargets: Array<[string, string]> = [
        ["game-ui/game/components/toolbar/toolbar.tsx", "Toolbar"],
        ["game-ui/game/components/toolbar/toolbar-legacy.tsx", "ToolbarLegacy"],
        ["game-ui/game/components/toolbar/console-toolbar.tsx", "ConsoleToolbar"],
    ];
    for (const [modulePath, exportName] of extendTargets) {
        try {
            registry.extend(modulePath, exportName, extendToolbar);
        } catch (error) {
            console.error(`[PinnedFinanceTooltip] extend ${exportName} failed:`, error);
        }
    }
}

const extendToolbar: ModuleRegistryExtend = (Toolbar: ComponentType<any>) => {
    return function PinnedFinanceTooltipToolbar(this: unknown, props: Record<string, any>) {
        const [expanded, setExpanded] = useState(false);
        const toggle = () => setExpanded(value => !value);

        // Collapse as soon as the player leaves the live game view. Event-driven, no polling.
        const activeScreen = useBindingValue(getActiveGameScreenBinding(), Number.NaN);
        useEffect(() => {
            if (getClosingScreens().indexOf(activeScreen) >= 0) {
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
