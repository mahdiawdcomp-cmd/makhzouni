package com.inventory.data.repository

import android.util.Log
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.NetworkMonitor
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fetches per-tenant entitlements from GET /api/tenant-info (routed to the tenant's
 * backend by DynamicBaseUrlInterceptor, exactly like every other endpoint) and
 * caches them in SessionManager.
 *
 * FAIL-OPEN BY CONSTRUCTION: [refresh] can NEVER throw. On any failure (offline,
 * network error, parse error, timeout, non-2xx) it simply returns false and leaves
 * whatever is already cached untouched — it never overwrites cached values with
 * "unknown", so a flaky network never accidentally locks or unlocks the app.
 */
@Singleton
class EntitlementsRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val sessionManager: SessionManager,
    private val networkMonitor: NetworkMonitor,
) {
    /** @return true only when a fresh entitlement snapshot was successfully saved. */
    suspend fun refresh(): Boolean {
        if (!networkMonitor.isOnline()) return false
        return try {
            val dto = apiClient.api.getTenantInfo()
            // The backend shape may be flat or wrapped as {"data":{...}} — read off
            // whichever came back without guessing.
            val payload = dto.data ?: dto
            sessionManager.saveEntitlements(
                features = payload.features.orEmpty(),
                readOnly = payload.readOnly,
                androidEnabled = payload.platforms?.androidEnabled,
                licenseType = payload.licenseType,
                trialEndsAt = payload.trialEndsAt,
                // Prefer the entitlement-specific expiry, fall back to the generic one.
                entitlementExpiresAt = payload.entitlementExpiresAt ?: payload.expiresAt,
                checkedAt = Instant.now().toString(),
            )
            true
        } catch (e: Exception) {
            Log.w("EntitlementsRepository", "tenant-info refresh failed (keeping cached values): ${e.message}")
            false
        }
    }
}
