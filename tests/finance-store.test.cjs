// Offline regression for the coalescing finance store and the panel row budget.
// Same harness as ssp-ui/tests: transpile the real TypeScript, run it in a vm
// context with a deterministic clock and fake host bindings, no game required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

let clock = 0;
let timers = [];
let nextTimer = 1;

const setTimer = (fn, ms) => {
    const id = nextTimer++;
    timers.push({ id, at: clock + ms, fn });
    return id;
};
const clearTimer = id => {
    timers = timers.filter(timer => timer.id !== id);
};
function tick(ms) {
    const end = clock + ms;
    for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const timer = timers.shift();
        clock = timer.at;
        timer.fn();
    }
    clock = end;
}

function loadModule(file) {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "mods", file), "utf8");
    const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require: id => {
            throw new Error(`unexpected runtime require in ${file}: ${id}`);
        },
        setTimeout: setTimer,
        clearTimeout: clearTimer,
        console: { log() {}, error() {} },
    };
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(output, sandbox, { filename: file });
    return sandbox.module.exports;
}

function fakeBinding(initial) {
    const state = { value: initial, listeners: new Set() };
    return {
        get value() {
            return state.value;
        },
        subscribe(listener) {
            state.listeners.add(listener);
            return {
                dispose() {
                    state.listeners.delete(listener);
                },
            };
        },
        dispose() {},
        push(value) {
            state.value = value;
            for (const listener of Array.from(state.listeners)) listener(value);
        },
        get listenerCount() {
            return state.listeners.size;
        },
    };
}

const { createFinanceStore, FLUSH_MS } = loadModule("finance-store.ts");
const {
    computeRowBudget,
    clampPanelLeft,
    distributeRows,
    MIN_ROWS,
    MAX_ROWS,
    PANEL_CHROME_REM,
    PANEL_ROW_REM,
    PANEL_MAX_WIDTH_REM,
    PANEL_EDGE_PX,
} = loadModule("layout.ts");

// --- store: initial values straight from the bindings -----------------------
{
    const store = createFinanceStore({ totalIncome: fakeBinding(42), unlimitedMoney: fakeBinding(true) });
    assert.equal(store.getSnapshot().totalIncome, 42, "initial snapshot reads the binding");
    assert.equal(store.getSnapshot().unlimitedMoney, true);
    assert.equal(store.getSnapshot().incomeItems.length, 0, "missing bindings start empty");
    store.stop();
}

// --- store: one flush per window, not one per binding callback --------------
const bindings = {
    incomeItems: fakeBinding([]),
    incomeValues: fakeBinding([]),
    expenseItems: fakeBinding([]),
    expenseValues: fakeBinding([]),
    totalIncome: fakeBinding(0),
    totalExpenses: fakeBinding(0),
    moneyDelta: fakeBinding(0),
    unlimitedMoney: fakeBinding(false),
    getItemValue: (item, values) => values[item.index],
};
const store = createFinanceStore(bindings);
let flushes = 0;
store.subscribe(() => {
    flushes += 1;
});
store.start();

bindings.totalIncome.push(10);
bindings.moneyDelta.push(5);
bindings.incomeValues.push([1, 2]);
assert.equal(flushes, 0, "nothing is delivered before the window closes");
tick(FLUSH_MS - 1);
assert.equal(flushes, 0, "the window is not shortened");
tick(1);
assert.equal(flushes, 1, "three updates in one window collapse into one flush");
assert.equal(store.getSnapshot().totalIncome, 10);
assert.equal(store.getSnapshot().moneyDelta, 5);
assert.equal(JSON.stringify(store.getSnapshot().incomeValues), "[1,2]");

// --- store: a later update must not extend the open window ------------------
bindings.totalIncome.push(20);
tick(100);
bindings.totalIncome.push(30);
tick(FLUSH_MS - 100 - 1);
assert.equal(flushes, 1, "a second update must not push the flush back");
tick(1);
assert.equal(flushes, 2, "the flush lands at the original deadline");
assert.equal(store.getSnapshot().totalIncome, 30, "the flushed snapshot carries the newest value");

// --- store: an identical value does not schedule work ----------------------
bindings.totalIncome.push(30);
tick(FLUSH_MS * 2);
assert.equal(flushes, 2, "pushing the same value must not repaint");
assert.equal(timers.length, 0, "no timer is left pending");

// --- store: stop() disposes bindings and timers ----------------------------
store.stop();
assert.equal(bindings.totalIncome.listenerCount, 0, "stop disposes every binding subscription");
assert.equal(bindings.moneyDelta.listenerCount, 0);
bindings.totalIncome.push(40);
tick(FLUSH_MS * 2);
assert.equal(flushes, 2, "no delivery after stop");
assert.equal(timers.length, 0, "no timer survives stop");

// --- store: start() is reference counted ----------------------------------
{
    const ref = { totalIncome: fakeBinding(0) };
    const counted = createFinanceStore(ref);
    counted.start();
    counted.start();
    counted.stop();
    assert.equal(ref.totalIncome.listenerCount, 1, "a nested mount keeps the subscription alive");
    counted.stop();
    assert.equal(ref.totalIncome.listenerCount, 0, "the last stop disposes it");
}

// --- store: hostile host data never reaches the panel as NaN ---------------
{
    const hostile = createFinanceStore({
        getItemValue: () => undefined,
    });
    assert.equal(hostile.itemValue({ index: 0 }, []), 0, "undefined item value becomes 0");
    const thrower = createFinanceStore({
        getItemValue: () => {
            throw new Error("host error");
        },
    });
    assert.equal(thrower.itemValue({ index: 0 }, []), 0, "a throwing getItemValue becomes 0");
    const valid = createFinanceStore({ getItemValue: (item, values) => values[item.index] });
    assert.equal(valid.itemValue({ index: 1 }, [7, 9]), 9);
    assert.equal(valid.itemValue({ index: 5 }, [7, 9]), 0, "short arrays fall back to 0, not NaN");
}

// --- layout: row budget ----------------------------------------------------
assert.equal(computeRowBudget(0, 1), MIN_ROWS, "no room keeps the minimum");
assert.equal(computeRowBudget(250, 1), 5);
assert.equal(computeRowBudget(400, 1), 13);
assert.equal(computeRowBudget(1000, 1), MAX_ROWS, "large screens are capped");
assert.equal(computeRowBudget(800, 2), 13, "interface scale is applied");
assert.equal(computeRowBudget(Number.NaN, 0), MIN_ROWS, "garbage measurements keep the minimum");
assert.ok(computeRowBudget(600, 1) * PANEL_ROW_REM + PANEL_CHROME_REM <= 600, "budget never exceeds the measured space");

// --- layout: budget split across the two sections --------------------------
const empty = distributeRows(0, 0, 20);
assert.equal(empty.income.shown + empty.expense.shown, 0);
assert.equal(empty.income.hidden + empty.expense.hidden, 0);

const fits = distributeRows(5, 3, 20);
assert.equal(fits.income.shown, 5);
assert.equal(fits.expense.shown, 3);
assert.equal(fits.income.hidden, 0);
assert.equal(fits.expense.hidden, 0);

const crowded = distributeRows(30, 30, 20);
assert.equal(crowded.income.shown + crowded.expense.shown, 20, "crowded sections use exactly the budget");
assert.ok(crowded.income.shown >= 3 && crowded.expense.shown >= 3, "both sections keep their minimum rows");
assert.equal(crowded.income.hidden, 30 - crowded.income.shown, "hidden counts match +N");
assert.equal(crowded.expense.hidden, 30 - crowded.expense.shown);

const incomeOnly = distributeRows(0, 30, 10);
assert.equal(incomeOnly.income.shown, 0);
assert.equal(incomeOnly.expense.shown, 10);
assert.equal(incomeOnly.expense.hidden, 20);

const proportional = distributeRows(10, 10, 9);
assert.equal(proportional.income.shown + proportional.expense.shown, 9);
assert.equal(proportional.income.shown, 5, "the remainder alternates between equal sections");
assert.equal(proportional.expense.shown, 4);

const degenerate = distributeRows(1, 1, 1);
assert.equal(degenerate.income.shown + degenerate.expense.shown, 1, "a single row still fits one item");

// --- store: sub-unit drift cannot change what is drawn ---------------------
{
    const drift = { totalIncome: fakeBinding(100.2), incomeValues: fakeBinding([10.2, 20.2]) };
    const quiet = createFinanceStore(drift);
    let painted = 0;
    quiet.subscribe(() => {
        painted += 1;
    });
    quiet.start();

    drift.totalIncome.push(100.4);
    tick(FLUSH_MS * 2);
    assert.equal(painted, 0, "a sub-unit change must not repaint the panel");
    assert.equal(quiet.getSnapshot().totalIncome, 100.4, "the newest value is kept for the next repaint");

    drift.totalIncome.push(101);
    tick(FLUSH_MS);
    assert.equal(painted, 1, "crossing a whole unit repaints");

    drift.incomeValues.push([10.4, 20.4]);
    tick(FLUSH_MS * 2);
    assert.equal(painted, 1, "sub-unit drift inside the category array must not repaint");

    drift.incomeValues.push([10.4, 21]);
    tick(FLUSH_MS);
    assert.equal(painted, 2, "a category that really changed repaints");
    quiet.stop();
}

// --- layout: horizontal clamp ---------------------------------------------
assert.equal(clampPanelLeft(100, 1280, 1), 100, "an anchor that fits is used as-is");
assert.equal(
    clampPanelLeft(1000, 1280, 1),
    1280 - PANEL_MAX_WIDTH_REM - PANEL_EDGE_PX,
    "a panel that would overflow slides left instead",
);
assert.equal(clampPanelLeft(1000, 400, 1), PANEL_EDGE_PX, "a panel wider than the screen pins to the edge");
assert.equal(clampPanelLeft(-50, 1280, 1), PANEL_EDGE_PX, "negative anchors are clamped");
assert.equal(clampPanelLeft(500, 1000, 2), 1000 - PANEL_MAX_WIDTH_REM * 2 - PANEL_EDGE_PX, "interface scale widens the panel");
assert.equal(clampPanelLeft(Number.NaN, 1280, 1), PANEL_EDGE_PX, "garbage anchors fall back to the edge");

console.log("finance-store: all assertions passed");
