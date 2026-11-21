import { useEffect, useState } from "react";

import { followAnchor, getAnchor, getAnchorVisible, subscribeAnchor, unfollowAnchor } from "./money-anchor";
import type { MoneyAnchor } from "./money-anchor";

export interface AnchorState {
    anchor: MoneyAnchor | null;
    visible: boolean;
}

/**
 * Tracks the money field for as long as the caller is mounted. The panel only
 * mounts while expanded, so a collapsed panel costs nothing.
 */
export function useAnchorState(): AnchorState {
    const [state, setState] = useState<AnchorState>(() => ({ anchor: getAnchor(), visible: getAnchorVisible() }));

    useEffect(() => {
        const sync = () => setState({ anchor: getAnchor(), visible: getAnchorVisible() });
        const unsubscribe = subscribeAnchor(sync);
        followAnchor();
        sync();
        return () => {
            unsubscribe();
            unfollowAnchor();
        };
    }, []);

    return state;
}
