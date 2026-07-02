// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./socket-listener-cleanup.js";

const ruleTester = makeRuleTester({ jsx: true });

describe("socket-listener-cleanup", () => {
  it("requires socket.on listeners to have matching useEffect cleanup", () => {
    ruleTester.run("socket-listener-cleanup", rule, {
      valid: [
        {
          code: [
            "useEffect(() => {",
            "  if (!socket) return;",
            "  socket.on('campaign:updated', handleUpdated);",
            "  return () => {",
            "    socket.off('campaign:updated', handleUpdated);",
            "  };",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            "React.useEffect(() => {",
            "  socket.on('notification:new', handleNew);",
            "  return () => socket.off('notification:new', handleNew);",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            "useLayoutEffect(() => {",
            "  socket.on('notification:new', handleNew);",
            "  return () => socket.off('notification:new', handleNew);",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            "const subscribe = useCallback((socket) => {",
            "  socket.on('campaign:updated', handleUpdated);",
            "  return () => {",
            "    socket.off('campaign:updated', handleUpdated);",
            "  };",
            "}, [handleUpdated]);",
          ].join("\n"),
        },
        {
          code: [
            "useEffect(() => {",
            "  newSocket.on('connect', () => handleConnect());",
            "  newSocket.on('disconnect', () => handleDisconnect());",
            "  return () => {",
            "    newSocket.removeAllListeners();",
            "  };",
            "}, [newSocket]);",
          ].join("\n"),
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', handleUpdated);",
            "  function cleanup() {",
            "    socket.off('campaign:updated', handleUpdated);",
            "  }",
            "  return cleanup;",
            "}, [socket]);",
          ].join("\n"),
        },
        {
          code: [
            "const eventName = 'campaign:updated';",
            "useEffect(() => {",
            "  socket.on(eventName, handleUpdated);",
            "  return () => socket.off(eventName, handleUpdated);",
            "}, [socket, eventName]);",
          ].join("\n"),
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', handlers.updated);",
            "  return () => socket.off('campaign:updated', handlers.updated);",
            "}, [socket, handlers]);",
          ].join("\n"),
        },
        {
          code: "emitter.on('campaign:updated', handleUpdated);",
        },
        {
          code: "function AppHeader() { return null; }",
        },
      ],
      invalid: [
        {
          code: "socket.on('campaign:updated', handleUpdated);",
          errors: [{ messageId: "outsideEffect" }],
        },
        {
          code: [
            "useEffect(() => {",
            "  newSocket.on('connect', handleConnect);",
            "}, [newSocket]);",
          ].join("\n"),
          errors: [{ messageId: "missingCleanup" }],
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', handleUpdated);",
            "}, [socket]);",
          ].join("\n"),
          errors: [{ messageId: "missingCleanup" }],
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', handleUpdated);",
            "  return () => socket.off('campaign:updated', handleOther);",
            "}, [socket]);",
          ].join("\n"),
          errors: [{ messageId: "missingCleanup" }],
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', handleUpdated);",
            "  return () => socket.off('campaign:deleted', handleUpdated);",
            "}, [socket]);",
          ].join("\n"),
          errors: [{ messageId: "missingCleanup" }],
        },
        {
          code: [
            "useEffect(() => {",
            "  socket.on('campaign:updated', () => refresh());",
            "  return () => socket.off('campaign:updated', handleUpdated);",
            "}, [socket]);",
          ].join("\n"),
          errors: [{ messageId: "missingCleanup" }],
        },
      ],
    });
  });
});
