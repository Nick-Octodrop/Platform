import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetRoute, resolveAppTarget, resolveRouteTarget } from "./appShellUtils.js";

test("resolveAppTarget uses app.home page target", () => {
  const result = resolveAppTarget("page:home", null);
  assert.equal(result.error, null);
  assert.deepEqual(result.parsed, { type: "page", id: "home" });
});

test("resolveAppTarget uses app.home view target", () => {
  const result = resolveAppTarget("view:job.list", null);
  assert.equal(result.error, null);
  assert.deepEqual(result.parsed, { type: "view", id: "job.list" });
});

test("resolveAppTarget respects target param override", () => {
  const result = resolveAppTarget("page:home", "view:override");
  assert.equal(result.error, null);
  assert.deepEqual(result.parsed, { type: "view", id: "override" });
});

test("resolveAppTarget reports missing home", () => {
  const result = resolveAppTarget(null, null);
  assert.equal(result.error, "MISSING_HOME");
  assert.equal(result.parsed, null);
});

test("resolveAppTarget reports invalid target", () => {
  const result = resolveAppTarget("bad-target", null);
  assert.equal(result.error, "INVALID_TARGET");
  assert.equal(result.parsed, null);
});

test("buildTargetRoute builds page route", () => {
  const route = buildTargetRoute("foo", "page:home");
  assert.equal(route, "/apps/foo/page/home");
});

test("buildTargetRoute builds view route", () => {
  const route = buildTargetRoute("foo", "view:bar.list");
  assert.equal(route, "/apps/foo/view/bar.list");
});

test("resolveRouteTarget prefers page id", () => {
  const result = resolveRouteTarget({ pageId: "home", viewId: "list" });
  assert.deepEqual(result.parsed, { type: "page", id: "home" });
});

test("resolveRouteTarget handles view id", () => {
  const result = resolveRouteTarget({ pageId: null, viewId: "list" });
  assert.deepEqual(result.parsed, { type: "view", id: "list" });
});
