# Fix Plan: Discord Listener Registration Race Condition

## Root Cause

`GatewayPlugin.registerClient()` calls `this.connect()` immediately when the Client is constructed, starting the WebSocket connection **before** listeners like `DiscordMessageListener` are registered. If messages arrive during this window, they are dispatched to an incomplete listeners array and the handler never fires.

## Current Flow (BROKEN)

1. `new Client(..., [GatewayPlugin])` — triggers `GatewayPlugin.registerClient()` → `this.connect()`
2. Gateway starts connecting, may receive messages
3. Async work: deploy commands, fetch bot user
4. **LATE:** `registerDiscordListener(client.listeners, new DiscordMessageListener(...))`

## Fixed Flow

1. Pre-create all listeners (message, reaction, thread, presence) with `botUserId: undefined`
2. Pass listeners array to `new Client()` constructor
3. Gateway connects with listeners already registered
4. Later: fetch `botUserId`, update it if needed (or accept it being undefined for early messages)

## Implementation

- Move listener creation logic from after-Client to before-Client
- Accept that `botUserId` may be undefined for early filtering (acceptable tradeoff)
- Update `botUserId` in listener instances after fetch if needed (minimal value)

## Testing

- Restart Pollen monitor
- Send a DM immediately after connect
- Verify ingress log fires and handler processes message
