## Guardian change

### Safety invariants
- [ ] Explicit SOS is never blocked, downgraded or cancelled by AI.
- [ ] Emergency credentials remain device-bound.
- [ ] TEST incidents are excluded from live metrics.
- [ ] Contact loss is not described as proof of harm/crime.
- [ ] Camera/microphone/location use remains visible and permission-controlled.

### Validation
- [ ] Backend/shared tests pass.
- [ ] Monitoring tests/build pass.
- [ ] Android unit tests/lint/debug build pass.
- [ ] Prisma migration reviewed for backward safety.
- [ ] Security workflow reviewed.
- [ ] Release notes identify any external validation still required.

### Production-sensitive changes
- [ ] Auth/RBAC reviewed.
- [ ] Evidence/retention/chain of custody reviewed.
- [ ] Notification/escalation behavior reviewed.
- [ ] Privacy/POPIA impact reviewed.
