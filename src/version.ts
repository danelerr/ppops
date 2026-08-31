export const PPOPS_VERSION = "0.1.0-beta.1" as const;

// Backup schema v1 is stable across the published beta line. Keep older
// manifests readable so an upgrade cannot strand an operator's recovery data.
export const SUPPORTED_BACKUP_VERSIONS = ["0.1.0-beta.0", PPOPS_VERSION] as const;
