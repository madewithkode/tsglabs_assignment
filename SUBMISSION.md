# Submission

**Role:** Forward-Deployed Engineer

**Problem.** Swiftbox Dispatch is a hypothetical Lagos bike courier that takes every booking over WhatsApp. Today a dispatcher works out(and quotes) everything by hand, roughly following these steps - Google Maps distance lookups, kilometres times the rate, a reply, then a wait for a transfer screenshot that they check by eye.

Slow quotes easily lose impatient customers, straight-line distance instead of actual road distance calculations undercharge the long runs that cost most, and fake or edited payment screenshots mean rides that never get paid for. This Chord teammate works out the details and quotes from the actual road distance in seconds, issues a Paystack transfer account for exactly that price, and books a rider only once it confirms from Paystack that the money landed.

**Deliberately left out:** live rider tracking, vans and bulky items, cash on delivery, scheduling for a future date, and changes after payment. Those hand off to a person.

**Nice to Have**: Automated payment confirmations via webhooks, this way we dont rely on the customer saying they've paid before we check.
