# Guardian competition positioning and pilot strategy

> Status: recommended commercial/pilot assumptions for validation. This document does not claim signed customers, security partners, police/EMS integrations or legal approval.

## One-line positioning

Guardian is an offline-first personal-safety and emergency-intelligence platform that combines deliberate SOS, duress protection, Trusted Circle escalation, journey intelligence, encrypted evidence, explainable multi-signal risk analysis and coordinated human response.

## Why it is more than a panic button

| Capability | Basic panic app | Family location app | Security response app | Guardian target |
|---|---|---|---|---|
| Deliberate SOS | Common | Sometimes | Common | Yes |
| Offline local SOS persistence | Varies | Varies | Varies | Core design |
| Duress cancellation | Uncommon | Not core | Varies | Core design |
| Journey protection | Varies | Common | Varies | Yes |
| Explainable multi-signal intelligence | Limited | Limited | Varies | Yes |
| Trusted-contact delivery receipts/ack | Varies | Varies | Varies | Yes |
| Encrypted incident evidence | Uncommon | Not core | Varies | Yes |
| Monitoring incident command | Usually no | Usually no | Yes | Yes |
| Responder lifecycle/ETA | Usually no | Usually no | Yes | Yes |
| Search prediction separated from confirmed location | Usually no | Usually no | Varies | Yes |
| AI allowed to cancel explicit SOS | N/A | N/A | Varies | Never |

Do not turn this table into named competitor claims without a fresh market check immediately before the competition.

## Recommended first beachhead

Start with a controlled, high-value group rather than "everyone":

**Primary pilot:** mobile/lone workers and drivers who spend long periods away from a fixed workplace, including delivery/e-hailing/fleet contexts.

Why:
- clear safety problem;
- Android-heavy device base is compatible with the current launch scope;
- journeys and responder workflows are directly relevant;
- organisations can sponsor/operate monitoring;
- measurable pilot outcomes are available.

Consumer/family, campuses, mines and security-company licensing remain expansion paths.

## Provisional commercial model

Validate willingness to pay before final pricing.

- **Guardian Personal** — self-managed SOS, Trusted Circle, Journey Protection.
- **Guardian Premium** — monitoring/response services where a partner operating model exists.
- **Guardian Family** — multiple protected members/Guardians.
- **Guardian Enterprise** — organisation users, policies, reports and control-room integration.
- **Guardian Security** — licensed control-room/responder tooling for approved security partners.

Pricing should be derived from pilot cost-to-serve, provider costs, monitoring labour, responder partner economics and customer interviews. Do not present invented final prices as validated.

## Monitoring operating model

Recommended pilot model:

1. Guardian software provides the incident workflow.
2. A trained control-room operator claims/acknowledges incidents.
3. Trusted Guardians receive their authorised view.
4. Approved responders/security partners receive assigned incidents.
5. Emergency services are contacted through the normal lawful process unless a formal integration exists.

Possible commercial deployment models:
- customer-owned control room;
- licensed private-security control room;
- Guardian-operated centre after operating/compliance capability is established;
- hybrid partner model.

## Responder model

Responder participation should require:
- verified account;
- organisation/team association in commercial deployments;
- availability state;
- region;
- capabilities;
- vehicle/contact details where relevant;
- incident access only after assignment;
- auditable status/location updates.

Do not advertise police/EMS dispatch integration without an agreement.

## Controlled pilot

Recommended initial structure:

- 30–50 protected users;
- 2–4 trained monitoring operators;
- at least one approved response/monitoring partner;
- 6–8 weeks;
- Android-first;
- multiple OEM families;
- TEST drills before any live pilot phase.

Track:
- local SOS reliability;
- server arrival;
- operator acknowledgement;
- Guardian provider delivery/acknowledgement;
- responder dispatch/acceptance/arrival;
- offline recovery;
- evidence upload completion;
- false-alarm outcome;
- Safe Word FAR/FRR in controlled testing;
- user/operator feedback.

Use `services/api/scripts/pilot-kpi-report.mjs` for server-side TEST workflow timings.

## Competition demonstration

Show one complete story:

```text
Protected journey
   ↓
deliberate TEST SOS
   ↓
offline-first save
   ↓
monitoring incident
   ↓
Guardian Safety Intelligence explains risk
   ↓
Trusted Guardian acknowledgement
   ↓
responder dispatch + ETA
   ↓
evidence/search view
   ↓
person located / resolution
   ↓
report + audit
```

The strongest technical message is not "AI detects crime." It is:

> Explicit SOS always works independently; intelligence adds context, prioritisation, explainability and coordination around the emergency.

## Defensibility / IP review topics

Document and discuss with qualified IP counsel before broad disclosure where appropriate:
- explicit-trigger bypass of probabilistic inference;
- device-bound emergency credential and offline emergency continuity;
- duress continuity/state divergence;
- multi-signal safety fusion and explainable incident risk;
- Trusted Circle delivery/acknowledgement state model;
- search-corridor generation from last-confirmed movement;
- evidence priority/continuity model;
- responder/monitoring coordination architecture.

This is an invention-disclosure checklist, not a patentability opinion.

## Evidence to obtain before competition/funding claims

Prefer:
- signed pilot/interest letters;
- documented user interviews;
- controlled drill results;
- real TEST KPI report;
- Safe Word benchmark report;
- provider E2E report;
- device-matrix report;
- independent security review/pentest summary;
- screenshots/video of the deterministic competition demo.

Do not substitute repository code for external validation.

## Judge answers

**What happens without internet?**  
The handset stores the SOS locally first and retries when connectivity returns. The pilot must demonstrate this on real devices.

**Can AI block an emergency?**  
No. Explicit SOS is on the deterministic safety path. AI cannot cancel, suppress or downgrade it.

**Is the current AI trained machine learning?**  
The production threat engine is currently explainable deterministic safety intelligence with a shadow comparison path. Neural Safe Word/evidence/behaviour models are gated behind validation.

**How do you reduce false alarms?**  
Deliberate trigger design, configurable controls, test mode, cancellation/duress separation, human monitoring and an explicit false-alarm outcome used for measurement.

**How is privacy protected?**  
On-device/offline processing where practical, RBAC, encrypted evidence, retention/legal hold controls, audit logs and explicit sharing permissions. Formal POPIA/legal review remains a launch gate.

**What is the moat?**  
The integrated safety architecture: offline continuity, multi-signal intelligence, evidence, Trusted Circle, monitoring and responder coordination—not a single AI model or panic button.

**Who pays?**  
Validate Personal/Family subscriptions and B2B/B2B2C enterprise/security licensing during the pilot; do not present final pricing until validated.
