# STEX inference service

This service will be developed as a local OpenRouter gateway and later moved
to the dedicated GCP machine. It is the only component allowed to hold a
provider credential or make a provider request.

The first implementation must establish, before any proxy endpoint:

1. an authenticated calling principal;
2. a user-scoped credential resolver that never returns a key to an app;
3. a typed request and response contract;
4. budgets, cancellation and durable request outcomes; and
5. local fake-provider tests.

Until those contracts exist, this directory deliberately contains no fake
"OpenRouter integration." A health endpoint or a model list without the
credential and request authorities would be decorative infrastructure.
