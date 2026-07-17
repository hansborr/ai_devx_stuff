// @ts-check
import { describe, it } from "vitest";

import rule from "./no-effect-misuse.js";
import { jsxRuleTester } from "./rule-tester.js";

const ruleTester = jsxRuleTester;

describe("no-effect-misuse", () => {
  it("allows effects that synchronize with external systems", () => {
    ruleTester.run("no-effect-misuse", rule, {
      valid: [
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  window.addEventListener("resize", onResize);',
            '  return () => window.removeEventListener("resize", onResize);',
            "}, [onResize]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect, useState } from "react";',
            "const [, setOnline] = useState(false);",
            "useEffect(() => {",
            "  const unsubscribe = socket.subscribe(() => setOnline(true));",
            "  return unsubscribe;",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useLayoutEffect, useState } from "react";',
            "const [, setWidth] = useState(0);",
            "useLayoutEffect(() => {",
            "  setWidth(element.getBoundingClientRect().width);",
            "}, [element]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect, useState } from "react";',
            "const [, setValue] = useState(0);",
            "function refresh() { setValue(1); }",
            "useEffect(refresh, [refresh]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "function example(useEffect) {",
            "  useEffect(() => fetch('/local'), []);",
            "}",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "other-library";',
            "useEffect(() => fetch('/local'), []);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  const handler = () => fetch("/on-subscription-event");',
            "  return external.subscribe(handler);",
            "}, [external]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  const handler = () => fetch("/on-browser-event");',
            '  window.addEventListener("online", handler);',
            '  return () => window.removeEventListener("online", handler);',
            "}, []);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  socket.on("refresh", () => fetch("/on-socket-event"));',
            "  return () => socket.off('refresh');",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  void navigator.permissions.query({ name: "geolocation" });',
            "}, []);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            "  void client.campaign.list.query();",
            "  void client.campaign.list['query']();",
            "}, [client]);",
          ].join("\n"),
        },
        {
          code: [
            'import { useEffect } from "react";',
            "const window = { fetch() {} };",
            "useEffect(() => {",
            '  window.fetch("/local-helper");',
            "}, []);",
          ].join("\n"),
        },
      ],
      invalid: [],
    });
  });

  it("reports imperative fetching inside React effects", () => {
    ruleTester.run("no-effect-misuse", rule, {
      valid: [],
      invalid: [
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  void fetch("/api/campaigns");',
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useLayoutEffect } from "react";',
            "useLayoutEffect(() => {",
            '  void fetch("/api/layout-data");',
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  void globalThis.fetch("/api/current-user");',
            '  void window.fetch("/api/campaigns");',
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }, { messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useEffect as synchronize } from "react";',
            "synchronize(() => queryClient.fetchQuery(options), [queryClient, options]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import * as React from "react";',
            "React.useEffect(() => {",
            "  queryClient.prefetchQuery(options);",
            "}, [queryClient, options]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import React from "react";',
            "React.useEffect(() => {",
            "  const load = () => queryClient.ensureQueryData(options);",
            "  void load();",
            "}, [queryClient, options]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { createTRPCClient } from "@trpc/client";',
            'import { useEffect } from "react";',
            "const client = createTRPCClient({ links: [] });",
            "useEffect(() => {",
            "  void client.campaign.list.query();",
            "}, [client]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { trpcClient, useTRPCClient } from "@/lib/trpc.js";',
            'import { useEffect } from "react";',
            "const contextClient = useTRPCClient();",
            "useEffect(() => {",
            "  void trpcClient.auth.me.query();",
            "  void contextClient.campaign.list.query();",
            "}, [contextClient]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }, { messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useTRPCClient } from "@/lib/trpc.js";',
            'import { useEffect } from "react";',
            "const client = useTRPCClient();",
            "const alias = client;",
            "const auth = alias.auth;",
            "useEffect(() => {",
            "  void auth.me.query();",
            "}, [auth]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useTRPCClient } from "@/lib/trpc.js";',
            'import { useEffect } from "react";',
            "const { auth } = useTRPCClient();",
            "useEffect(() => {",
            "  void auth.me.query();",
            "}, [auth]);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { trpcClient } from "@/lib/trpc.js";',
            'import { useEffect } from "react";',
            "function fetchCurrentUser() {",
            "  return trpcClient.auth.me.query();",
            "}",
            "useEffect(() => {",
            "  void fetchCurrentUser();",
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { fetchCurrentUser } from "../lib/trpc.js";',
            'import { useEffect } from "react";',
            "useEffect(() => {",
            "  void fetchCurrentUser();",
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { trpcClient } from "@/lib/trpc.js";',
            'import { useEffect } from "react";',
            "useEffect(() => {",
            "  void refreshMutation.mutateAsync().then(() => trpcClient.auth.me.query());",
            "  void refreshMutation.mutateAsync().catch(() => trpcClient.auth.me.query());",
            "  void refreshMutation.mutateAsync().finally(() => trpcClient.auth.me.query());",
            "}, [refreshMutation]);",
          ].join("\n"),
          errors: [
            { messageId: "fetchInEffect" },
            { messageId: "fetchInEffect" },
            { messageId: "fetchInEffect" },
          ],
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            '  setTimeout(() => fetch("/debounced"), 100);',
            '  setInterval(() => fetch("/polled"), 1_000);',
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }, { messageId: "fetchInEffect" }],
        },
        {
          code: [
            'import { useEffect } from "react";',
            "useEffect(() => {",
            "  (() => fetch('/iife'))();",
            "}, []);",
          ].join("\n"),
          errors: [{ messageId: "fetchInEffect" }],
        },
      ],
    });
  });

  it("reports effects whose only work is deriving or resetting React state", () => {
    ruleTester.run("no-effect-misuse", rule, {
      valid: [],
      invalid: [
        {
          code: [
            'import { useEffect, useState } from "react";',
            "const [, setFullName] = useState('');",
            "useEffect(() => setFullName(firstName + ' ' + lastName), [firstName, lastName]);",
          ].join("\n"),
          errors: [{ messageId: "derivedStateEffect" }],
        },
        {
          code: [
            'import { useEffect as synchronize, useState as state } from "react";',
            "const [, updateOpen] = state(false);",
            "synchronize(() => {",
            "  if (dialogOpen) updateOpen(false);",
            "}, [dialogOpen]);",
          ].join("\n"),
          errors: [{ messageId: "derivedStateEffect" }],
        },
        {
          code: [
            'import * as React from "react";',
            "const [, setValue] = React.useState(0);",
            "React.useEffect(() => {",
            "  if (!open) return;",
            "  setValue(input);",
            "}, [open, input]);",
          ].join("\n"),
          errors: [{ messageId: "derivedStateEffect" }],
        },
      ],
    });
  });
});
