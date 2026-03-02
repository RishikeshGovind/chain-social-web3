# DSAR Runbook

## Intake

- Channels: privacy email + authenticated endpoint `POST /api/privacy/request`.
- Required fields: request type, identity, contact channel, scope.

## Identity Verification

- For wallet users: verify authenticated wallet session.
- For email channel: challenge-response verification before processing.

## Fulfillment Steps

1. Open ticket and assign owner.
2. Export off-chain data: `GET /api/privacy/export`.
3. If delete request is valid, execute `DELETE /api/privacy/delete`.
4. Update DSAR status in admin endpoint.
5. Send completion notice with scope limitations (on-chain immutability disclaimer).

## SLA Targets

- Acknowledge: within 72 hours.
- Complete: within statutory timeline (typically 30 days unless extended by law).

## Audit

- Log each step in compliance audit events.
- Keep evidence packet per completed request.
