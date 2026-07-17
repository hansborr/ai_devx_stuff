// @ts-check
import { describe, it } from "vitest";

import rule from "./no-unbounded-promise-all.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

describe("no-unbounded-promise-all", () => {
  it("reports Promise combinators over dynamically sized fan-out", () => {
    ruleTester.run("no-unbounded-promise-all", rule, {
      valid: [
        { code: "await Promise.all([loadUser(), loadCampaign()]);" },
        { code: "await Promise.allSettled([loadUser(), loadCampaign()]);" },
        { code: "await Promise.all([1, 2, 3, 4, 5].map(loadById));" },
        { code: "await Promise.all([loadUser(), ...[loadCampaign(), loadMap()]]);" },
        { code: "await Promise.all(tasks);" },
        {
          code: "const pair = [loadUser(), loadCampaign()]; await Promise.all(pair.map(load));",
        },
        {
          code: "await Promise.all([loadUser(), loadCampaign()].filter(Boolean).map(load));",
        },
        {
          code: "await Promise.all([loadUser(), loadCampaign()].slice(0, 1).map(load));",
        },
        {
          code: "function run(Promise) { return Promise.all(items.map(load)); }",
        },
        {
          code: 'const all = "race"; await Promise[all](items.map(load));',
        },
        {
          code: 'const map = "filter"; await Promise.all(items[map](predicate));',
        },
        { code: "await Promise.race(items.map(load));" },
      ],
      invalid: [
        {
          code: "await Promise.all(items.map(async (item) => load(item)));",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "return Promise['allSettled'](records.map(save));",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: 'return Promise["all"](records["map"](save));',
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "await Promise.all([...tasks]);",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "await Promise.all([loadUser(), ...items.map(load)]);",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "await Promise.all([1, 2, 3, 4, 5, 6].map(loadById));",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "const jobs = rows.map(save); await Promise.allSettled(jobs);",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "await Promise.all(rows.map(save).filter(Boolean));",
          errors: [{ messageId: "unboundedFanOut" }],
        },
        {
          code: "const jobs = rows.map(save).slice(0); await Promise.all(jobs);",
          errors: [{ messageId: "unboundedFanOut" }],
        },
      ],
    });
  });
});
