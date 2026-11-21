/**
 * Single source of truth for the vanilla money field anchor.
 *
 * The button used to carry its own copy of the lookup and the panel carried a
 * second one, so the two could disagree about where the field is. Everything
 * DOM-related now lives here: the icon scan, the anchor rectangle, the
 * rem-per-pixel probe and the "is the toolbar currently hidden" check.
 */

export const MONEY_ICON_SELECTOR = 'img[src*="Money.svg"]';

/** New UI, legacy UI and the console toolbar all render this money field class. */
const PRIMARY_FIELD_SELECTOR = '[class*="money-field_"]';

/** Kept as a fallback so a renamed class cannot silently remove the button. */
const FALLBACK_FIELD_SELECTOR = '[class*="field_"]';

/** How often the panel re-reads the anchor while it is open. */
export const FOLLOW_MS = 250;

export interface MoneyAnchor {
    left: number;
    top: number;
    height: number;
}

let anchor: MoneyAnchor | null = null;
let anchorVisible = false;
let remScale = 0;
let followTimer: number | null = null;
let followers = 0;
const anchorListeners = new Set<() => void>();

function notify(): void {
    for (const listener of Array.from(anchorListeners)) {
        try {
            listener();
        } catch (error) {
            console.error("[PinnedFinanceTooltip] anchor listener failed:", error);
        }
    }
}

function sameRect(a: MoneyAnchor | null, b: MoneyAnchor | null): boolean {
    if (!a || !b) return a === b;
    return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** The bottom-most visible money icon, mapped to its toolbar field. */
export function findMoneyField(): Element | null {
    let best: Element | null = null;
    let bestTop = -1;
    try {
        document.querySelectorAll(MONEY_ICON_SELECTOR).forEach(candidate => {
            const rect = candidate.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            if (rect.top <= bestTop) return;
            bestTop = rect.top;
            best = candidate;
        });
    } catch {
        return null;
    }
    if (!best) return null;
    const icon = best as Element;
    return icon.closest(PRIMARY_FIELD_SELECTOR) ?? icon.closest(FALLBACK_FIELD_SELECTOR) ?? icon;
}

function hasHiddenUiClass(): boolean {
    try {
        const body = document.body;
        const root = document.documentElement;
        const hidden = (element: HTMLElement | null) => !!element && element.classList.contains("hide-ui");
        return hidden(body) || hidden(root);
    } catch {
        return false;
    }
}

/**
 * The vanilla UI hides the whole interface by putting `hide-ui` on the root and
 * translating the toolbar out of the screen. A body-level portal escapes the
 * first mechanism, so both are checked.
 */
export function isAnchorVisible(candidate: MoneyAnchor | null): boolean {
    if (!candidate) return false;
    const viewport = typeof window === "undefined" ? 0 : window.innerHeight;
    if (viewport > 0 && candidate.top >= viewport - 8) return false;
    if (candidate.top <= 0) return false;
    return !hasHiddenUiClass();
}

export function getAnchor(): MoneyAnchor | null {
    return anchor;
}

export function getAnchorVisible(): boolean {
    return anchorVisible;
}

export function subscribeAnchor(listener: () => void): () => void {
    anchorListeners.add(listener);
    return () => {
        anchorListeners.delete(listener);
    };
}

function readAnchor(): MoneyAnchor | null {
    const field = findMoneyField();
    if (!field) return null;
    const rect = field.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { left: rect.left, top: rect.top, height: rect.height };
}

export function refreshAnchor(): void {
    const nextAnchor = readAnchor();
    const nextVisible = isAnchorVisible(nextAnchor);
    const changed = !sameRect(anchor, nextAnchor) || nextVisible !== anchorVisible;
    anchor = nextAnchor;
    anchorVisible = nextVisible;
    if (changed) notify();
}

function forgetRemScale(): void {
    remScale = 0;
}

function onResize(): void {
    forgetRemScale();
    refreshAnchor();
}

/** Starts the re-measure loop; reference counted so nested mounts are safe. */
export function followAnchor(): void {
    followers += 1;
    if (followers > 1) return;
    refreshAnchor();
    followTimer = window.setInterval(refreshAnchor, FOLLOW_MS);
    window.addEventListener("resize", onResize);
    // One extra pass after the next paint so the very first open does not wait a
    // full interval when the toolbar was still laying out during mount.
    if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => refreshAnchor());
    }
}

export function unfollowAnchor(): void {
    followers = Math.max(0, followers - 1);
    if (followers > 0) return;
    if (followTimer !== null) {
        window.clearInterval(followTimer);
        followTimer = null;
    }
    window.removeEventListener("resize", onResize);
}

/**
 * Gameface `rem` is not the html font size, so the only reliable way to convert
 * it to pixels is to measure a probe element. Cached until the next resize.
 */
export function getRemScale(): number {
    if (remScale > 0) return remScale;
    let scale = 1;
    try {
        const probe = document.createElement("div");
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.pointerEvents = "none";
        probe.style.top = "0";
        probe.style.left = "0";
        probe.style.width = "100rem";
        probe.style.height = "0";
        document.body.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        document.body.removeChild(probe);
        if (width > 0) scale = width / 100;
    } catch {
        scale = 1;
    }
    remScale = scale;
    return scale;
}
