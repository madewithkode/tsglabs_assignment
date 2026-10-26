# Go-live note for Swiftbox Dispatch Chord Teammate

**What it does.** It answers customers' booking messages on whichever channels you connect it to, such as WhatsApp. It asks what's being sent and from where to where, gives an exact price based on the road distance - resolved through Google maps API and a Km-based pricing, and sends the customer a one-off Paystack account to transfer to. It books a rider only when Paystack confirms the exact amount arrived. Payment receipt screenshots and "I've paid" don't count. Every job and payment appears on your Paystack dashboard with the pickup, drop-off and item.

**What it doesn't do.** Track riders, take cash on delivery, carry anything bigger than the bike box, book future dates, or change a job after payment. In those cases, and whenever it's unsure, it hands the chat to a person on your team.

**Before real customers use it:**
1. **Your own Paystack live keys,** with Pay with Transfer enabled on your account, so money settles to you. Today it runs on test keys.
2. **The channels your customers use, connected to Chord** (for example your WhatsApp Business number), and a decision on who on your team receives hand-offs. That person needs to answer within minutes during working hours.
3. **Real riders instead of the demo roster.** Today the rider is picked automatically from a sample hard-coded list(see `server/src/config.ts`).
4. **Your real rates and limits.** These are sample hard-coded defaults today.
   - **Prices, coverage and timing** (enforced by the system): `server/src/config.ts`.
     - ₦1,500 base fee + ₦300 per km of road distance, minimum ₦2,500, rounded up to the nearest ₦100
     - maximum distance of 40 km by road, Lagos State only
     - quotes valid for 30 minutes
     - pickups Monday–Saturday from 8:00am; jobs paid after 5:30pm go out the next working morning
     - the sample rider list (item 3)
   - **What riders carry, and closing time** (what the agent is told): `skill/swiftbox-dispatch/references/service-policy.md`.
     - up to 10 kg, about 50 × 50 × 50 cm
     - items worth up to ₦200,000
     - the list of items not carried
     - riders working until 7:00pm

5. **When something breaks.** If maps or Paystack are down, the agent doesn't guess. It hands every chat to a person.
6. **Refunds and disputes** stay with you. The agent never promises one.
