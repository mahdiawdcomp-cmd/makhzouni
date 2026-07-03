package com.inventory.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EntitlementErrorMapperTest {

    @Test
    fun readOnlyModeBodyParsesToCode() {
        assertEquals(
            EntitlementErrorMapper.READ_ONLY_MODE,
            EntitlementErrorMapper.codeFromBody("""{"error":"READ_ONLY_MODE","message":"x"}""")
        )
    }

    @Test
    fun featureNotEnabledBodyParsesToCode() {
        assertEquals(
            EntitlementErrorMapper.FEATURE_NOT_ENABLED,
            EntitlementErrorMapper.codeFromBody("""{"error":"FEATURE_NOT_ENABLED"}""")
        )
    }

    @Test
    fun malformedJsonReturnsNull() {
        assertNull(EntitlementErrorMapper.codeFromBody("{not json"))
    }

    @Test
    fun missingErrorFieldReturnsNull() {
        assertNull(EntitlementErrorMapper.codeFromBody("""{"message":"nope"}"""))
    }

    @Test
    fun unrecognizedCodeReturnsNull() {
        assertNull(EntitlementErrorMapper.codeFromBody("""{"error":"SOMETHING_ELSE"}"""))
    }

    @Test
    fun nullOrBlankBodyReturnsNull() {
        assertNull(EntitlementErrorMapper.codeFromBody(null))
        assertNull(EntitlementErrorMapper.codeFromBody(""))
        assertNull(EntitlementErrorMapper.codeFromBody("   "))
    }

    @Test
    fun messageForKnownCodesIsArabic() {
        assertEquals(
            "النظام بوضع المشاهدة فقط. لا يمكن الإضافة أو التعديل حالياً.",
            EntitlementErrorMapper.messageFor(EntitlementErrorMapper.READ_ONLY_MODE)
        )
        assertEquals(
            "هذه الميزة غير مفعلة في نسختك.",
            EntitlementErrorMapper.messageFor(EntitlementErrorMapper.FEATURE_NOT_ENABLED)
        )
    }

    @Test
    fun messageForUnknownCodeIsNull() {
        assertNull(EntitlementErrorMapper.messageFor("WHATEVER"))
    }
}
