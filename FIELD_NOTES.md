# Deployment field notes

---

## 1. Chord shows nested tool arguments to the model as plain strings

**What happened.** In the teammate's in-app test chat in the Chord app (where each reply has a "How I did this" panel), every `create_payment` call was rejected before it reached my code, three times in a row, and then the agent handed off:

```
MCP error -32602: Input validation error: Invalid arguments for tool create_payment:
Invalid input: expected object, received string at pickup_contact
Invalid input: expected object, received string at dropoff_contact
```

In the simulator the same failure only surfaced as the agent saying *"a technical problem on my side"*.

**Finding the cause.**
- My server exposed `pickup_contact` as an object (`{name, phone}`, both required), which I confirmed through `tools/list`.
- The model itself said: *"It says it expects structured objects, but the tool's own schema lists those two fields as plain strings."*
- I added a log line that records each call's arguments *before* validation. It showed the model trying to comply first but later went ahead to JSON-encode them into strings (`"{\"name\":\"Ukanwa Obinna\",…}"`).

**Fix.** I flattened the contacts into four separate string arguments instead (`pickup_contact_name`, `pickup_contact_phone`, …).

**What I'd change.**
- Pass nested JSON Schema objects to the model as they are, or document that only flat, scalar arguments are supported.

## 2. Tool calls carry no conversation or sender context

**What happened.** I logged the headers and MCP `_meta` of every tool call across five runs. `_meta` was always `null`, and the headers were only transport-related (Cloudflare, Render) plus my bearer token. Meanwhile the model itself remembered the customer's phone number (*"I have it on file as 0703…"*).

**Why it matters.**
- **A tool can't act later on the customer's behalf.** When Paystack confirms a transfer, nothing can tell the customer; they have to come back and say "I've paid".
- **A tool can't keep state per conversation.** To stop the false apologies in note 3, I wanted `resolve_address` to say "you already found this place in this conversation". With one shared server and no conversation id, that flag would leak between customers, so customer B could skip confirming an address only customer A had confirmed.

**What I'd change.** Send the thread id, and the channel's sender id where allowed, with every tool call, e.g. in MCP `_meta`. Document what is and isn't sent.

## 3. In the simulator, the agent acts as if earlier messages' tool results are gone

**What happened.** In three simulator runs, the agent searched both addresses again, and quoted again, on almost every message. It then apologised for mistakes it hadn't made:
- *"the options I listed earlier were not from our system"*
- *"my earlier message got ahead of the search"*
- *"I'm sorry for the mix-up earlier. I've now run the addresses and price properly"*

Searching again with slightly different wording also swapped the pickup between the quote and the payment, from "Lagos House Ikeja" to "Lagos State Secretariat".

**Finding the cause.** I logged how old each id was when a tool received it. The server logs also show that the options the agent called "not from our system" came from my tool.
- **In-app test chat:** `get_quote` used address ids issued **154 s and 96 s** earlier, on previous messages.
- **Simulator:** in all three runs, every id used had been issued about **2 s** earlier, within the same message. The booking reference worked across messages only because it appears in the text the customer sees.

I can't say for sure if tool results are dropped from the simulator's context, but the behaviour fits. There was one exception: the agent once repeated `create_payment`'s account details one message later without calling anything.

**Workarounds.**
- `confirm_booking` takes the reference the customer is shown.
- `resolve_address` caches results by search text, so a second search returns the same place.
- The skill tells the model its earlier results were real, and never to talk about re-checking.

**What I'd change.**
- Keep tool calls and results in the context for channel conversations the way the in-app test chat does, or document the difference.
- Let each "How I did this" step expand to show the full arguments and the full result. Today a step shows the tool name and a result cut off partway (`{"status":"confirmed","boo…`) that can't be expanded, and it doesn't show the arguments the model sent at all. The arguments were what mattered here, I only found out what the model actually sent from my own server logs.

## 4. Paystack Dedicated Virtual Accounts are gated even in test mode

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

## 5. Google confidently resolves a whole district to its centre point

**What happened.** In the first real run, sending "Lekki" as the address came back as a single confident result: the centre point of a district spanning about 75 km across. A pickup priced from that point can be thousands of naira off.

**Finding the cause.** I compared Places results for ten Lagos queries. Place types are inconsistent (Victoria Island is an `island` with a 0.4 km viewport, while Yaba is a `neighborhood`). The size of the result's **viewport** separates the cases cleanly: Lekki 74.7 km, Ikeja 27.5 km, Surulere 9.4 km, against Lekki Phase 1 at 6.0 km and Yaba at 3.2 km.

**Fix.** A top match whose viewport is wider than 8 km returns `too_broad`, and the agent asks for a street or landmark in order to narrow down the location.

## 6. Malformed JSON got an HTML stack trace

**What happened.** A bad request body to `/mcp` on my MCP server returned Express's default HTML error page, including local file paths, which is both bad for security and for the client. It's now a standardized JSON-RPC `-32700 Parse error` that the client can work with.

