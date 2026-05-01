import { createBrowserHistory } from "@remix-run/router";
import { hasFormNavigationGuard, runFormNavigationGuard } from "./formNavigationGuard.js";

const baseHistory = createBrowserHistory({ v5Compat: true });
let navigationSequence = 0;
let bypassDepth = 0;
let restorePopDelta = null;
let proceedPopDelta = null;
let resolvePopRestore = null;

function sameHref(to) {
  try {
    return baseHistory.createHref(to) === baseHistory.createHref(baseHistory.location);
  } catch {
    return false;
  }
}

async function runGuardedNavigation(sequence, navigate) {
  const allowed = await runFormNavigationGuard();
  if (!allowed || sequence !== navigationSequence) return;
  bypassDepth += 1;
  try {
    navigate();
  } finally {
    bypassDepth -= 1;
  }
}

async function runGuardedPopNavigation(sequence, restoreComplete, delta) {
  const allowed = await runFormNavigationGuard();
  await restoreComplete;
  if (!allowed || sequence !== navigationSequence) return;
  proceedPopDelta = delta;
  baseHistory.go(delta);
}

function guardNavigation(to, navigate) {
  if (bypassDepth > 0 || !hasFormNavigationGuard() || sameHref(to)) {
    navigate();
    return;
  }
  const sequence = ++navigationSequence;
  void runGuardedNavigation(sequence, navigate);
}

function guardHistoryDelta(delta, navigate) {
  if (bypassDepth > 0 || !hasFormNavigationGuard() || !delta) {
    navigate();
    return;
  }
  const sequence = ++navigationSequence;
  void (async () => {
    const allowed = await runFormNavigationGuard();
    if (!allowed || sequence !== navigationSequence) return;
    proceedPopDelta = delta;
    navigate();
  })();
}

export const guardedBrowserHistory = {
  get action() {
    return baseHistory.action;
  },
  get location() {
    return baseHistory.location;
  },
  createHref(to) {
    return baseHistory.createHref(to);
  },
  createURL(to) {
    return baseHistory.createURL(to);
  },
  encodeLocation(to) {
    return baseHistory.encodeLocation(to);
  },
  listen(listener) {
    return baseHistory.listen((update) => {
      if (update.action === "POP" && restorePopDelta != null && update.delta === restorePopDelta) {
        restorePopDelta = null;
        resolvePopRestore?.();
        resolvePopRestore = null;
        return;
      }
      if (update.action === "POP" && proceedPopDelta != null && update.delta === proceedPopDelta) {
        proceedPopDelta = null;
        listener(update);
        return;
      }
      if (update.action !== "POP" || bypassDepth > 0 || !hasFormNavigationGuard() || !update.delta) {
        listener(update);
        return;
      }

      const delta = update.delta;
      const sequence = ++navigationSequence;
      const restoreComplete = new Promise((resolve) => {
        resolvePopRestore = resolve;
        setTimeout(resolve, 250);
      });
      restorePopDelta = -delta;
      baseHistory.go(-delta);
      void runGuardedPopNavigation(sequence, restoreComplete, delta);
    });
  },
  push(to, state) {
    guardNavigation(to, () => baseHistory.push(to, state));
  },
  replace(to, state) {
    guardNavigation(to, () => baseHistory.replace(to, state));
  },
  go(delta) {
    guardHistoryDelta(delta, () => baseHistory.go(delta));
  },
};
