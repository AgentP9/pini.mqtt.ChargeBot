# Sprint 4 — Storage integrity and recovery

## Startup behavior

ChargeBot validates the persisted process history on startup. If the file exists
but is malformed or fails validation, startup fails rather than silently
replacing it with an empty array. This protects history from accidental loss.

## Last-known-good backup

Before each process-history replacement, ChargeBot validates the existing
primary and rotates up to five snapshots in the same `DATA_DIR`:
`charging-processes.json.bak` (newest previous version), then `.bak.1`
through `.bak.4` (oldest). The backup is the *previous* version, not
necessarily the latest saved history. The backup is
not automatically restored: automatic fallback could silently discard newer
events. Both the primary and backup should be included in external backups.

## Manual recovery

1. Stop ChargeBot and disable any restart policy while investigating.
2. Copy the complete `DATA_DIR` to a safe location before modifying anything.
3. Run `cd backend && node recovery-cli.js list` (with the same `DATA_DIR`
   as the service). Inspect valid snapshots and any external backup.
4. While the service is **stopped**, run
   `node recovery-cli.js restore 0 --confirm-offline` to restore the newest
   validated snapshot, or choose another listed index. The previous primary
   is preserved with a `.pre-restore-<timestamp>` suffix. The CLI cannot
   detect a running server; stopping it is the operator's responsibility.
5. Start ChargeBot, check logs, and compare restored session counts and IDs.
6. If newer sessions were lost, reconcile them deliberately before enabling
   unattended automatic shutdown.

## Limitations

- A backup is not a substitute for volume snapshots or off-host backups.
- The primary and backup reside on the same filesystem.
- Backup updates and primary replacement are individually atomic renames,
  not one atomic transaction spanning both files.
- Manual recovery is required for a corrupt primary.
- Real production history and physical MQTT devices have not been tested.
