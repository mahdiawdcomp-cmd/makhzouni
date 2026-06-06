package com.inventory.ui.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.CatalogCustomerDto
import com.inventory.data.repository.CatalogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CatalogManagementUiState(
    val isLoading: Boolean = false,
    val customers: List<CatalogCustomerDto> = emptyList(),
    val error: String? = null,
    val actionSuccess: Boolean = false
)

@HiltViewModel
class CatalogManagementViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(CatalogManagementUiState())
    val uiState: StateFlow<CatalogManagementUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = catalogRepository.getCatalogCustomers()) {
                is ApiResult.Success -> _uiState.update { it.copy(isLoading = false, customers = result.data) }
                is ApiResult.Error   -> _uiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(isLoading = false, error = "لا يوجد اتصال بالإنترنت") }
                else                 -> _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun grantAccess(id: String, allowPrices: Boolean, showStock: Boolean) {
        viewModelScope.launch {
            when (val result = catalogRepository.grantAccess(id, allowPrices, showStock)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionSuccess = true) }
                    load()
                }
                is ApiResult.Error   -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(error = "لا يوجد اتصال بالإنترنت") }
                else                 -> Unit
            }
        }
    }

    fun patchAccess(id: String, allowPrices: Boolean? = null, showStock: Boolean? = null) {
        viewModelScope.launch {
            when (val result = catalogRepository.patchAccess(id, allowPrices, showStock)) {
                is ApiResult.Success -> load()
                is ApiResult.Error   -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(error = "لا يوجد اتصال بالإنترنت") }
                else                 -> Unit
            }
        }
    }

    fun revokeAccess(id: String) {
        viewModelScope.launch {
            when (val result = catalogRepository.revokeAccess(id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionSuccess = true) }
                    load()
                }
                is ApiResult.Error   -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Offline -> _uiState.update { it.copy(error = "لا يوجد اتصال بالإنترنت") }
                else                 -> Unit
            }
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(error = null, actionSuccess = false) }
    }
}
