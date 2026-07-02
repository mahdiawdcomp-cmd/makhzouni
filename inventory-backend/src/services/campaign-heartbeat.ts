// Tiny in-memory heartbeat for the per-minute campaign cron tick. Used by the
// system-health service to tell if the scheduler is still alive. In-memory by
// design — after a restart it reads null (health shows "unknown") until the
// first tick, which is correct.
let _lastCampaignTickAt: number | null = null;

export function markCampaignTick() {
  _lastCampaignTickAt = Date.now();
}

export function getLastCampaignTickAt(): number | null {
  return _lastCampaignTickAt;
}
