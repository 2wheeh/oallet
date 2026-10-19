---
"@oallet/playwright": patch
---

Use Ox for provider event subscriptions, mipd for provider discovery, and uuid for UUID generation in the injected browser runtime, including on HTTP pages. Repeated subscriptions of the same listener now receive each event once per subscription.

Announce providers after registration initializes their connection state so restored disconnected wallets report the correct state from the first announcement. Emit an initial connect event for connected wallets to preserve Wagmi reconnection when provider registration finishes after app startup.
