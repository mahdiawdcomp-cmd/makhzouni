package com.inventory.ui.reports

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.EndOfDayReportDto
import com.inventory.data.remote.dto.ProfitReportDto
import com.inventory.data.remote.dto.StoreBrainReportDto
import com.inventory.data.remote.dto.TopCustomerDto
import com.inventory.data.repository.InvoiceRepository
import com.inventory.data.repository.ReportRepository
import com.inventory.data.repository.VoucherRepository
import com.inventory.domain.model.CustomerDebt
import com.inventory.domain.model.DashboardReport
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InventoryValuation
import com.inventory.domain.model.SalesReport
import com.inventory.domain.model.Voucher
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PROFIT REPORT ("الأرباح")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
data class ProfitReportUiState(
    val from: String = "",
    val to: String = "",
    val groupBy: String = "day",
    val report: ProfitReportDto? = null,
    val error: String? = null,
    val loading: Boolean = false
)

@HiltViewModel
class ProfitReportViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(ProfitReportUiState())
    val state = _state.asStateFlow()

    init { refresh() }

    fun setFrom(value: String) { _state.value = _state.value.copy(from = value) }
    fun setTo(value: String) { _state.value = _state.value.copy(to = value) }
    fun setGroupBy(value: String) { _state.value = _state.value.copy(groupBy = value); refresh() }

    fun refresh() {
        viewModelScope.launch {
            val current = _state.value
            _state.value = current.copy(loading = true)
            when (val result = repository.profit(current.from.takeUnless { it.isBlank() }, current.to.takeUnless { it.isBlank() }, current.groupBy)) {
                is ApiResult.Success -> _state.value = _state.value.copy(report = result.data, error = null, loading = false)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message, loading = false)
                else -> _state.value = _state.value.copy(error = "لا يوجد اتصال", loading = false)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOP CUSTOMERS ("أفضل الزبائن")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
data class TopCustomersUiState(
    val customers: List<TopCustomerDto> = emptyList(),
    val error: String? = null,
    val loading: Boolean = false
)

@HiltViewModel
class TopCustomersViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(TopCustomersUiState())
    val state = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            when (val result = repository.topCustomers(null, null, 20)) {
                is ApiResult.Success -> _state.value = TopCustomersUiState(customers = result.data)
                is ApiResult.Error -> _state.value = TopCustomersUiState(error = result.message)
                else -> _state.value = TopCustomersUiState(error = "لا يوجد اتصال")
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  END OF DAY ("نهاية اليوم")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
data class EndOfDayUiState(
    val date: String = "",
    val report: EndOfDayReportDto? = null,
    val error: String? = null,
    val loading: Boolean = false
)

@HiltViewModel
class EndOfDayViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(EndOfDayUiState())
    val state = _state.asStateFlow()

    init { refresh() }

    fun setDate(value: String) { _state.value = _state.value.copy(date = value); refresh() }

    fun refresh() {
        viewModelScope.launch {
            val current = _state.value
            _state.value = current.copy(loading = true)
            when (val result = repository.endOfDay(current.date.takeUnless { it.isBlank() })) {
                is ApiResult.Success -> _state.value = _state.value.copy(report = result.data, error = null, loading = false)
                is ApiResult.Error -> _state.value = _state.value.copy(error = result.message, loading = false)
                else -> _state.value = _state.value.copy(error = "لا يوجد اتصال", loading = false)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STORE BRAIN ("عقل المحل")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
data class StoreBrainUiState(
    val report: StoreBrainReportDto? = null,
    val error: String? = null,
    val loading: Boolean = false
)

@HiltViewModel
class StoreBrainViewModel @Inject constructor(
    private val repository: ReportRepository
) : ViewModel() {
    private val _state = MutableStateFlow(StoreBrainUiState())
    val state = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            when (val result = repository.storeBrain(null, null)) {
                is ApiResult.Success -> _state.value = StoreBrainUiState(report = result.data)
                is ApiResult.Error -> _state.value = StoreBrainUiState(error = result.message)
                else -> _state.value = StoreBrainUiState(error = "لا يوجد اتصال")
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ARCHIVE ("الأرشيف") — cancelled invoices & vouchers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
data class ArchiveUiState(
    val subTab: ArchiveSubTab = ArchiveSubTab.INVOICES,
    val invoices: List<Invoice> = emptyList(),
    val vouchers: List<Voucher> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)

enum class ArchiveSubTab { INVOICES, VOUCHERS }

@HiltViewModel
class ArchiveViewModel @Inject constructor(
    private val invoiceRepository: InvoiceRepository,
    private val voucherRepository: VoucherRepository
) : ViewModel() {
    private val _state = MutableStateFlow(ArchiveUiState())
    val state = _state.asStateFlow()

    init { loadInvoices() }

    fun setSubTab(tab: ArchiveSubTab) {
        _state.value = _state.value.copy(subTab = tab)
        if (tab == ArchiveSubTab.INVOICES && _state.value.invoices.isEmpty()) loadInvoices()
        if (tab == ArchiveSubTab.VOUCHERS && _state.value.vouchers.isEmpty()) loadVouchers()
    }

    private fun loadInvoices() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            when (val result = invoiceRepository.cancelledInvoices()) {
                is ApiResult.Success -> _state.value = _state.value.copy(invoices = result.data, loading = false, error = null)
                is ApiResult.Error -> _state.value = _state.value.copy(loading = false, error = result.message)
                else -> _state.value = _state.value.copy(loading = false, error = "لا يوجد اتصال")
            }
        }
    }

    private fun loadVouchers() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            voucherRepository.cancelledVouchers().fold(
                onSuccess = { _state.value = _state.value.copy(vouchers = it, loading = false, error = null) },
                onFailure = { _state.value = _state.value.copy(loading = false, error = it.message ?: "تعذر تحميل السندات") }
            )
        }
    }

    fun restoreVoucher(id: String) {
        viewModelScope.launch {
            voucherRepository.restoreVoucher(id).onSuccess { loadVouchers() }
        }
    }
}
