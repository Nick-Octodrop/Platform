const guards = new Set();
let activeRun = null;

export function registerFormNavigationGuard(guard) {
  if (typeof guard !== "function") return () => {};
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function hasFormNavigationGuard() {
  return guards.size > 0;
}

export async function runFormNavigationGuard() {
  if (guards.size === 0) return true;
  if (activeRun) return activeRun;

  activeRun = (async () => {
    const activeGuards = Array.from(guards).reverse();
    for (const guard of activeGuards) {
      if (!guards.has(guard)) continue;
      const allowed = await guard();
      if (allowed === false) return false;
    }
    return true;
  })()
    .catch((err) => {
      console.warn("form_navigation_guard_failed", err);
      return false;
    })
    .finally(() => {
      activeRun = null;
    });

  return activeRun;
}
