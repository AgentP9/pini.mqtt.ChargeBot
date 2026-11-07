# Sprint 1: Deployment and security

ChargeBot's HTTP API currently has **no user authentication**. The container
configuration therefore binds the frontend to **127.0.0.1:1818** by default,
preventing unintentional LAN/Internet exposure.

## LAN deployment (explicit opt-in)

If the UI must be available to other devices in the home network, set
`CHARGEBOT_BIND_ADDRESS=0.0.0.0` in the Compose environment and restrict TCP
1818 using a host firewall to trusted LAN/VPN clients only. Do **not** publish
port 1818 to the public Internet. Prefer an authenticated HTTPS reverse proxy
with access controls for remote use. If a reverse proxy runs on the Docker host,
leave the bind address at 127.0.0.1.

## Upgrade notes

The new default changes LAN accessibility. Existing deployments that relied on
`1818:80` must explicitly configure `CHARGEBOT_BIND_ADDRESS=0.0.0.0`
and apply LAN firewall rules. Auto-off preferences remain persisted across
shutdowns, but pending timers are deliberately discarded. MQTT reconnect
clears pending auto-off timers; fresh telemetry is required before shutdown
can be triggered. An offline device cannot be assumed to be safely charging.

## Release checks

- Run the GitHub Actions backend regression workflow.
- Test MQTT disconnect/reconnect, retained relay messages and process switching
  with a real Shelly before relying on unattended automatic shutoff.
- Verify Docker/Portainer networking and firewall policy.
- Check the data volume is writable and backed up.

This sprint does not introduce a frontend login. A login page alone would not
protect direct API access; authentication must be enforced server-side or at
the reverse proxy.
