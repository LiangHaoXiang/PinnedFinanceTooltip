import type { FC } from "react";
import { LocalizedNumber$1 as LocalizedNumber } from "cs2/l10n";

const formatNumber = (value: number) => Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Used only when the host localization component is unavailable. */
export const FallbackNumber: FC<{ value: number; unit?: unknown; signed?: boolean }> = ({ value, unit, signed }) => {
    const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
    const suffix = unit === "moneyPerHour" ? "/h" : "";
    return <>{`${sign}${formatNumber(value)}${suffix}`}</>;
};

export const NumberComp: FC<{ value: number; unit?: unknown; signed?: boolean }> =
    (LocalizedNumber as unknown as FC<{ value: number; unit?: unknown; signed?: boolean }>) ?? FallbackNumber;

export function toCssColor(color: { r: number; g: number; b: number; a?: number } | undefined): string {
    if (!color) return "transparent";
    const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
    return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${color.a ?? 1})`;
}
