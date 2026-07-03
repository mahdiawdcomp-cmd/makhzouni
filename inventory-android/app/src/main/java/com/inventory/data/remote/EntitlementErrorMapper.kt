package com.inventory.data.remote

import okhttp3.Interceptor
import okhttp3.Response
import org.json.JSONObject
import javax.inject.Inject

/**
 * Turns backend entitlement error bodies into fixed Arabic messages.
 *
 * The backend returns a 403/423 with a body like {"error":"READ_ONLY_MODE", ...}
 * or {"error":"FEATURE_NOT_ENABLED", ...} when a write is blocked by the tenant's
 * license/entitlements. This object centralizes the code→message mapping so it can
 * be reused by both the OkHttp interceptor (live requests) and the offline sync
 * worker (queued writes).
 */
object EntitlementErrorMapper {
    const val READ_ONLY_MODE = "READ_ONLY_MODE"
    const val FEATURE_NOT_ENABLED = "FEATURE_NOT_ENABLED"

    /**
     * Parses a raw JSON error body and returns the recognized entitlement code, or
     * null for ANYTHING else (malformed JSON, missing "error" field, or an
     * unrecognized code). Callers MUST treat null as "not an entitlement error,
     * handle it the normal way".
     */
    fun codeFromBody(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val code = JSONObject(body).optString("error", "").trim()
            when (code) {
                READ_ONLY_MODE -> READ_ONLY_MODE
                FEATURE_NOT_ENABLED -> FEATURE_NOT_ENABLED
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    fun messageFor(code: String): String? = when (code) {
        READ_ONLY_MODE -> "النظام بوضع المشاهدة فقط. لا يمكن الإضافة أو التعديل حالياً."
        FEATURE_NOT_ENABLED -> "هذه الميزة غير مفعلة في نسختك."
        else -> null
    }
}

/**
 * Thrown from [EntitlementInterceptor] when a live request is blocked by tenant
 * entitlements. Because it extends IOException, Retrofit propagates it as-is to the
 * calling suspend function (it happens BEFORE a Response is handed back to
 * Retrofit, so it is NOT wrapped in HttpException). Every repository's existing
 * `catch (e: Exception) { ApiResult.Error(e.message ?: ...) }` therefore surfaces
 * [message] — the ready-made Arabic sentence — with zero per-repository changes.
 */
class EntitlementException(
    val entitlementCode: String,
    message: String
) : java.io.IOException(message)

/**
 * Peeks 403/423 responses; if the body carries a recognized entitlement code, it
 * closes the response and throws [EntitlementException] carrying the Arabic
 * message. Otherwise it returns the response untouched (peekBody does not consume
 * the body, so normal error handling still works). Must be registered AFTER the
 * logging interceptor so logging still sees the raw response first.
 */
class EntitlementInterceptor @Inject constructor() : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (response.code == 403 || response.code == 423) {
            val bodyStr = response.peekBody(4096).string()
            val code = EntitlementErrorMapper.codeFromBody(bodyStr)
            val message = code?.let { EntitlementErrorMapper.messageFor(it) }
            if (code != null && message != null) {
                response.close()
                throw EntitlementException(code, message)
            }
        }
        return response
    }
}
