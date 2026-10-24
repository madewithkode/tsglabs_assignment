# Deployment field notes

---

## 1. Paystack Dedicated Virtual Accounts are gated even in test mode

**What happened.** My first design decision was to give each customer a permanent DVA. But on trying this out, the first call failed:

```
GET /dedicated_account/available_providers   (and POST /dedicated_account)
{"status":false,"message":"Dedicated NUBAN is not available for your business",
 "meta":{"nextStep":"You can send us an email at support@paystack.com to make a request for the service"},
 "type":"api_error","code":"feature_unavailable"}
```

**Finding the cause.** The error is business-level, so a test key doesn't get around it. The docs say DVA is for registered Nigerian businesses. They don't say the gate also applies in test mode.

**Workaround.** I switched to **Pay with Transfer through the Charge API** (`bank_transfer`). It issues a one-off account per transaction in test mode with no approval needed. That also fits the job better: one account per order, for the exact amount, with an expiry, and Paystack matches the payment to the order itself.

**What I'd change.** In the docs, it might be nice to say clearly that DVA needs enabling/express approval from the team even in test mode, and point to Pay with Transfer as the no-approval alternative.

## 2. Google confidently resolves a whole district to its centre point

**What happened.** In the first real run, sending "Lekki" as the address came back as a single confident result: the centre point of a district spanning about 75 km across. A pickup priced from that point can be thousands of naira off.

**Finding the cause.** I compared Places results for ten Lagos queries. Place types are inconsistent (Victoria Island is an `island` with a 0.4 km viewport, while Yaba is a `neighborhood`). The size of the result's **viewport** separates the cases cleanly: Lekki 74.7 km, Ikeja 27.5 km, Surulere 9.4 km, against Lekki Phase 1 at 6.0 km and Yaba at 3.2 km.

**Fix.** A top match whose viewport is wider than 8 km returns `too_broad`, and the agent asks for a street or landmark in order to narrow down the location.

## 3. Malformed JSON got an HTML stack trace

**What happened.** A bad request body to `/mcp` on my MCP server returned Express's default HTML error page, including local file paths, which is both bad for security and for the client. It's now a standardized JSON-RPC `-32700 Parse error` that the client can work with.

