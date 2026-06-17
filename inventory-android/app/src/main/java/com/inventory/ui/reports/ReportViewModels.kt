package com.inventory.ui.reports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.ReportRepository
import com.inventory.domain.model.CustomerDebt
import com.inventory.domain.model.DashboardReport
import com.inventory.domain.model.InventoryValuation
import com.inventory.domain.model.SalesReport
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardReportUiState(
    val report: DashboardReport? = null,
    val error: String? = null
)

@HiltViewModel
class DashboardReportViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(DashboardReportUiState())
    val state = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.dashboard()) {
                is ApiResult.Success -> _state.value = DashboardReportUiState(result.data)
                is ApiResult.Error -> _state.value = DashboardReportUiState(error = result.message)
                ApiResult.Offline -> _state.value = DashboardReportUiState(error = "لا يوجد اتصال")
            }
        }
    }
}

data class ReportsUiState(
    val from: String = "",
    val to: String = "",
    val groupBy: String = "day",
    val sales: SalesReport? = null,
    val inventory: InventoryValuation? = null,
    val debts: List<CustomerDebt> = emptyList(),
    val debtFilter: Int = 0,
    val error: String? = null
)

@HiltViewModel
class ReportsViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(ReportsUiState())
    val state = _state.asStateFlow()

    init {
        refreshSales()
        refreshInventory()
        refreshDebts()
    }

    fun setFrom(value: String) { _state.value = _state.value.copy(from = value) }
    fun setTo(value: String) { _state.value = _state.value.copy(to = value) }
    fun setGroupBy(value: String) { _state.value = _state.value.copy(groupBy = value); refreshSales() }
    fun setDebtFilter(days: Int) { _state.value = _state.value.copy(debtFilter = days); refreshDebts() }

    fun refreshSales() {
        viewModelScope.launch {
            val current = _state.value
            when (val result = repository.sales(current.from.takeUnless { it.isBlank() }, current.to.takeUnless { it.isBlank() }, current.groupBy)) {
                is ApiResult.Success -> _state.value = _state.value.copy(sales = result.data, error = null)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(error = "لا يوجد اتصال")
            }
        }
    }

    fun refreshInventory() {
        viewModelScope.launch {
            when (val result = repository.inventory()) {
                is ApiResult.Success -> _state.value = _state.value.copy(inventory = result.data, error = null)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(error = "لا يوجد اتصال")
            }
        }
    }

    fun refreshDebts() {
        viewModelScope.launch {
            val minDays = _state.value.debtFilter
            when (val result = repository.debts(minDays)) {
                is ApiResult.Success -> _state.value = _state.value.copy(debts = result.data, error = null)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message)
                ApiResult.Offline -> _state.value = _state.value.copy(error = "لا يوجد اتصال")
            }
        }
    }
}
