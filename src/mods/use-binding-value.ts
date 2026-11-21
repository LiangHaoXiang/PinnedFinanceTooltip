import { useEffect, useState } from "react";
import type { ValueBinding } from "cs2/api";

/** Subscribes with a stable hook count; unregistered or broken bindings yield the fallback. */
export function useBindingValue<T>(binding: ValueBinding<T> | undefined, fallback: T): T {
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
        } catch (error) {
            console.error("[PinnedFinanceTooltip] binding subscribe failed:", error);
            return;
        }
    }, [binding]);

    return value;
}
