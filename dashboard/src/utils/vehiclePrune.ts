// Cloud-authoritative pruning of the local vehicle list (fixes "a deleted vehicle came back / still
// shows on login"). The hosted cloud is the source of truth for which vehicles a signed-in user has;
// the local map is a cache. After the cloud vehicle snapshot has LOADED, any local vehicle that the
// cloud no longer lists was deleted elsewhere (admin console / another device) and must be dropped —
// EXCEPT vehicles created in this session that may not have been pushed yet (protected), and tombstoned
// ids (already being removed). Pure so it's fully unit-tested; SyncModal does the storage mutation.

/**
 * Which local vehicle ids should be pruned. `localIds` = ids in the local map; `cloudIds` = ids the
 * user's cloud query returned; `protectedIds` = created-this-session (maybe unpushed); `tombstoned` =
 * locally-deleted ids. Prune a local id iff it's absent from the cloud, not protected, not tombstoned.
 */
export function vehiclesToPrune(
  localIds: Iterable<string>,
  cloudIds: ReadonlySet<string>,
  protectedIds: ReadonlySet<string>,
  tombstoned: readonly string[] = [],
): string[] {
  const tomb = new Set(tombstoned);
  const out: string[] = [];
  for (const id of localIds) {
    if (!cloudIds.has(id) && !protectedIds.has(id) && !tomb.has(id)) out.push(id);
  }
  return out;
}
