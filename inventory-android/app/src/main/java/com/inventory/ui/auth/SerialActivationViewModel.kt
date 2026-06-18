package com.inventory.ui.auth

import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.repository.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import android.app.Application
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject

data class SerialActivationState(
    val serial: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val activated: Boolean = false
)

private val SUPER_ADMIN_ACTIVATE_URL: String
    get() = com.inventory.BuildConfig.SUPER_ADMIN_API_URL + "/api/activate"

@HiltViewModel
class SerialActivationViewModel @Inject constructor(
    application: Application,
    private val sessionManager: SessionManager
) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(SerialActivationState())
    val state: StateFlow<SerialActivationState> = _state.asStateFlow()

    fun onSerialChange(value: String) {
        _state.value = _state.value.copy(serial = value.uppercase().take(19), error = null)
    }

    fun activate() {
        val serial = _state.value.serial.trim()
        if (serial.isBlank()) return

        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            try {
                val deviceId = Settings.Secure.getString(
                    getApplication<Application>().contentResolver,
                    Settings.Secure.ANDROID_ID
                )
                val result = callActivateApi(serial, deviceId)
                if (result == null) {
                    _state.value = _state.value.copy(isLoading = false, error = "تعذر الاتصال بالخادم. تحقق من الإنترنت.")
                    return@launch
                }

                // Save backendUrl + features into SessionManager
                sessionManager.saveActivation(
                    serial = serial,
                    backendUrl = result.backendUrl,
                    features = result.features,
                    expiresAt = result.expiresAt
                )
                _state.value = _state.value.copy(isLoading = false, activated = true)

            } catch (e: ActivationException) {
                _state.value = _state.value.copy(isLoading = false, error = e.message)
            } catch (e: Exception) {
                _state.value = _state.value.copy(isLoading = false, error = "خطأ: ${e.message}")
            }
        }
    }

    private data class ActivationResult(
        val backendUrl: String,
        val features: List<String>,
        val expiresAt: String?
    )

    private class ActivationException(message: String) : Exception(message)

    private fun callActivateApi(serial: String, deviceId: String?): ActivationResult? {
        return try {
            val url = URL(SUPER_ADMIN_ACTIVATE_URL)
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            conn.doOutput = true

            val body = JSONObject().apply {
                put("serial", serial)
                if (deviceId != null) put("deviceId", deviceId)
            }.toString()
            conn.outputStream.use { it.write(body.toByteArray()) }

            val responseCode = conn.responseCode
            val responseBody = if (responseCode in 200..299) {
                conn.inputStream.bufferedReader().readText()
            } else {
                val errBody = conn.errorStream?.bufferedReader()?.readText() ?: ""
                val errMsg = try {
                    JSONObject(errBody).optString("error", "رقم السيريل غير صحيح أو منتهي الصلاحية")
                } catch (_: Exception) {
                    "رقم السيريل غير صحيح أو منتهي الصلاحية"
                }
                throw ActivationException(errMsg)
            }

            val json = JSONObject(responseBody)
            val sub = json.optJSONObject("subscription")
            val featuresArray = sub?.optJSONArray("features")
            val features = mutableListOf<String>()
            if (featuresArray != null) {
                for (i in 0 until featuresArray.length()) features.add(featuresArray.getString(i))
            }
            ActivationResult(
                backendUrl = json.getString("backendUrl"),
                features = features,
                expiresAt = sub?.optString("expiresAt")?.takeIf { it.isNotBlank() && it != "null" }
            )
        } catch (e: ActivationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }
}
