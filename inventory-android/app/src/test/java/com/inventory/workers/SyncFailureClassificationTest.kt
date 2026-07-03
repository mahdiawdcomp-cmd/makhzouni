package com.inventory.workers

import com.inventory.data.remote.EntitlementErrorMapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncFailureClassificationTest {

    @Test
    fun code423BlocksAsReadOnlyEvenWithUnparseableBody() {
        val c = classifySyncFailure(423, entitlementCode = null, body = "<html>oops</html>")
        assertEquals("BLOCKED", c.status)
        assertFalse(c.retryable)
        assertEquals(EntitlementErrorMapper.READ_ONLY_MODE, c.lastError)
    }

    @Test
    fun code403WithFeatureNotEnabledBlocksWithThatCode() {
        val c = classifySyncFailure(403, entitlementCode = EntitlementErrorMapper.FEATURE_NOT_ENABLED, body = "{}")
        assertEquals("BLOCKED", c.status)
        assertFalse(c.retryable)
        assertEquals(EntitlementErrorMapper.FEATURE_NOT_ENABLED, c.lastError)
    }

    @Test
    fun code403WithUnrelatedBodyKeepsLegacyBlockedBehavior() {
        val c = classifySyncFailure(403, entitlementCode = null, body = "Forbidden")
        assertEquals("BLOCKED", c.status)
        assertFalse(c.retryable)
        assertEquals("HTTP 403: Forbidden", c.lastError)
    }

    @Test
    fun code500IsRetryableFailed() {
        val c = classifySyncFailure(500, entitlementCode = null, body = "boom")
        assertEquals("FAILED", c.status)
        assertTrue(c.retryable)
    }

    @Test
    fun code429IsRetryableFailed() {
        val c = classifySyncFailure(429, entitlementCode = null, body = "slow down")
        assertEquals("FAILED", c.status)
        assertTrue(c.retryable)
    }

    @Test
    fun code400IsNonRetryableBlocked() {
        val c = classifySyncFailure(400, entitlementCode = null, body = "bad")
        assertEquals("BLOCKED", c.status)
        assertFalse(c.retryable)
    }
}
