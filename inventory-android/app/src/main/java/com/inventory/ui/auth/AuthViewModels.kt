package com.inventory.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.AuthRepository
import com.inventory.data.repository.EntitlementsRepository
import com.inventory.data.repository.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class SplashDestination {
    object SerialActivation : SplashDestination()
    object AndroidDisabled : SplashDestination()
    object Login : SplashDestination()
    object Dashboard : SplashDestination()
}

/**
 * Pure, unit-testable splash routing. Fail-open on entitlements:
 * `androidEnabled == null` (unknown) or `true` never blocks — only an explicit
 * `false` routes to [SplashDestination.AndroidDisabled].
 */
fun decideSplashDestination(
    hasSerial: Boolean,
    androidEnabled: Boolean?,
    hasSession: Boolean
): SplashDestination {
    if (!hasSerial) return SplashDestination.SerialActivation
    if (androidEnabled == false) return SplashDestination.AndroidDisabled
    return if (hasSession) SplashDestination.Dashboard else SplashDestination.Login
}

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val rememberMe: Boolean = true,
    val isLoading: Boolean = false,
    val error: String? = null,
    val loggedIn: Boolean = false
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsernameChange(value: String) {
        _state.value = _state.value.copy(username = value, error = null)
    }

    fun onPasswordChange(value: String) {
        _state.value = _state.value.copy(password = value, error = null)
    }

    fun onRememberChange(value: Boolean) {
        _state.value = _state.value.copy(rememberMe = value)
    }

    fun login() {
        val current = _state.value
        viewModelScope.launch {
            _state.value = current.copy(isLoading = true, error = null)
            when (val result = authRepository.login(current.username, current.password, current.rememberMe)) {
                is ApiResult.Success -> _state.value = _state.value.copy(isLoading = false, loggedIn = true)
                is ApiResult.Offline -> _state.value = _state.value.copy(isLoading = false, error = "لا يوجد اتصال بالإنترنت")
                is ApiResult.Error -> _state.value = _state.value.copy(isLoading = false, error = result.message)
            }
        }
    }
}

@HiltViewModel
class SplashViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionManager: SessionManager,
    private val entitlementsRepository: EntitlementsRepository
) : ViewModel() {
    private val _destination = MutableStateFlow<SplashDestination?>(null)
    val destination: StateFlow<SplashDestination?> = _destination.asStateFlow()

    init {
        viewModelScope.launch {
            try {
                delay(800)
                val hasSerial = sessionManager.hasActivatedSerial()
                if (!hasSerial) {
                    _destination.value = SplashDestination.SerialActivation
                    return@launch
                }
                // Best-effort entitlement refresh. refresh() already never throws,
                // but belt-and-braces: even a surprise crash here must not break the
                // splash flow — we just fall through to whatever is cached.
                try {
                    entitlementsRepository.refresh()
                } catch (_: Exception) { /* keep cached values, fail-open */ }

                val androidEnabled = sessionManager.androidEnabled.first()
                val hasSession = authRepository.hasRememberedSession()
                _destination.value = decideSplashDestination(hasSerial, androidEnabled, hasSession)
            } catch (e: Exception) {
                _destination.value = SplashDestination.Login
            }
        }
    }
}
