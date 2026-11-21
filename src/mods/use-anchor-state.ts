import { useEffect, useState } from "react";

import { followAnchor, getAnchor, getAnchorVisible, subscribeAnchor, unfollowAnchor } from "./money-anchor";
import type { MoneyAnchor } from "./money-anchor";

export interface AnchorState {
    anchor: MoneyAnchor | null;
    visible: boolean;
}

/**
 * Tracks the money field while `active` is true. The anchor is only followed
 * while the panel is open, so a collapsed panel costs nothing.
 */
export function useAnchorState(active: boolean): AnchorState {
    const [state, setState] = useState<AnchorState>(() => ({ anchor: getAnchor(), visible: getAnchorVisible() }));

    useEffect(() => {
        if (!active) return;
        const sync = () => setState({ anchor: getAnchor(), visible: getAnchorVisible() });
        const unsubscribe = subscribeAnchor(sync);
        followAnchor();
        sync();
        return () => {
            unsubscribe();
            unfollowAnchor();
        };
    }, [active]);

    return state;
}
