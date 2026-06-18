package com.inventory.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.AuthRepository
import com.inventory.data.repository.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class SplashDestination {
    object SerialActivation : SplashDestination()
    object Login : SplashDestination()
    object Dashboard : SplashDestination()
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
    private val sessionManager: SessionManager
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
                val hasSession = authRepository.hasRememberedSession()
                _destination.value = if (hasSession) SplashDestination.Dashboard else SplashDestination.Login
            } catch (e: Exception) {
                _destination.value = SplashDestination.Login
            }
        }
    }
}
