import { ModRegistrar } from "cs2/modding";
import { registerPinnedFinanceTooltip } from "mods/pinned-finance-tooltip";

const register: ModRegistrar = (moduleRegistry) => {
    registerPinnedFinanceTooltip(moduleRegistry);
};

export default register;
