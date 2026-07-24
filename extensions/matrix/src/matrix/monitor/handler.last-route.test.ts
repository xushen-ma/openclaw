// Matrix tests cover last-route update decisions without touching SQLite-backed session state.
import { describe, expect, it } from "vitest";
import { shouldUpdateMatrixInboundLastRoute } from "./handler.js";

describe("shouldUpdateMatrixInboundLastRoute", () => {
  it("updates last route for direct messages routed to the main session", () => {
    expect(
      shouldUpdateMatrixInboundLastRoute({
        isDirectMessage: true,
        mainSessionKey: "agent:ops:main",
        route: {
          lastRoutePolicy: "main",
          mainSessionKey: "agent:ops:main",
        },
        sessionKey: "agent:ops:main",
      }),
    ).toBe(true);
  });

  it("does not update last route for room-scoped DM sessions", () => {
    expect(
      shouldUpdateMatrixInboundLastRoute({
        isDirectMessage: true,
        mainSessionKey: "agent:ops:main",
        route: {
          lastRoutePolicy: "session",
          mainSessionKey: "agent:ops:main",
        },
        sessionKey: "agent:ops:matrix:direct:!dm:example.org",
      }),
    ).toBe(false);
  });

  it("does not update last route for group messages", () => {
    expect(
      shouldUpdateMatrixInboundLastRoute({
        isDirectMessage: false,
        mainSessionKey: "agent:ops:main",
        route: {
          lastRoutePolicy: "main",
          mainSessionKey: "agent:ops:main",
        },
        sessionKey: "agent:ops:main",
      }),
    ).toBe(false);
  });
});
