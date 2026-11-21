import { useEffect, useRef } from "react";
import type { FC } from "react";

import styles from "./pinned-finance-tooltip.module.scss";
import { findMoneyField } from "./money-anchor";

const ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>';

const BUTTON_ATTRIBUTE = "data-pft-toggle";

/** Cheap ownership check; the DOM scan only follows a dropped node. */
const REATTACH_MS = 2000;

export interface ToolbarButtonManagerProps {
    expanded: boolean;
    onToggle: () => void;
}

/**
 * Injects a native toggle button into the vanilla money field so it gets normal
 * toolbar hit-testing. Re-attaches itself when React rebuilds the toolbar DOM.
 * Uses no host runtime APIs, so it cannot fail.
 */
export const ToolbarButtonManager: FC<ToolbarButtonManagerProps> = ({ expanded, onToggle }) => {
    const buttonRef = useRef<HTMLDivElement | null>(null);
    const onToggleRef = useRef(onToggle);
    onToggleRef.current = onToggle;

    useEffect(() => {
        const attach = () => {
            const field = findMoneyField();
            if (!field) return;

            const foreign = field.querySelector(`[${BUTTON_ATTRIBUTE}]`);
            if (foreign && foreign !== buttonRef.current) {
                // Another mounted toolbar wrapper already owns the toggle. Yielding
                // keeps a single button; the 2s check takes over once that owner
                // unmounts and removes its node.
                return;
            }

            let button = buttonRef.current;
            if (!button) {
                button = document.createElement("div");
                button.setAttribute(BUTTON_ATTRIBUTE, "");
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

        attach();
        // Steady state costs one isConnected check every two seconds; the DOM
        // query and re-attach only run when the toolbar was rebuilt.
        const timer = window.setInterval(() => {
            if (buttonRef.current?.isConnected) return;
            attach();
        }, REATTACH_MS);
        window.addEventListener("resize", attach);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("resize", attach);
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
