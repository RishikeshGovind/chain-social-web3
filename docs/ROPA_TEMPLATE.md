# RoPA Template (Record of Processing Activities)

Maintain one row per processing activity.

| Activity ID | Processing Purpose | Data Categories | Data Subjects | Legal Basis | Processor/Recipient | Storage Region | Transfer Mechanism | Retention | Security Controls | Owner |
|---|---|---|---|---|---|---|---|---|---|---|
| ROPA-001 | Account authentication | Wallet address, auth tokens, IP logs | Users | Contract / Legitimate Interest | Privy, hosting provider | EU/US | SCC where applicable | 30d logs, short token TTL | httpOnly secure cookies, access controls | Security |
| ROPA-002 | Social posting service | Public post content, media URIs | Users | Contract | Lens/indexers + app DB | Multi-region | SCC / adequacy | Business need | API auth, anti-abuse, moderation | Product |

## Instructions

- Update on each new feature affecting personal data.
- Link each row to architecture diagram and system owner.
- Keep evidence of transfer mechanism and DPA in compliance repository.
