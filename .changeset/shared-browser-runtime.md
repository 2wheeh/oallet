---
"@oallet/playwright": patch
---

Use mipd and uuid in the injected browser runtime for provider discovery and UUID generation, including on HTTP pages.

Announce providers after registration initializes their connection state so restored disconnected wallets report the correct state from the first announcement. Emit an initial connect event for connected wallets to preserve Wagmi reconnection when provider registration finishes after app startup.
