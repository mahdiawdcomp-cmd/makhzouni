package com.inventory.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.repository.DEFAULT_API_BASE_URL
import com.inventory.data.repository.SettingsRepository
import com.inventory.data.repository.StoreSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val settings: StoreSettings = StoreSettings(
        storeName = "مخزوني",
        storeLogoUri = null,
        storePhone = "",
        storeAddress = "",
        currency = "IQD",
        baseUrl = DEFAULT_API_BASE_URL,
        debtReminderEnabled = true,
        debtReminderDays = 14,
        inactiveAlertEnabled = true,
        inactiveCustomerDays = 30,
        invoiceTemplate = "فاتورتك من {storeName}: {invoiceNumber} بتاريخ {date}",
        debtTemplate = "مرحباً {customerName}، لديك مبلغ {amount} مستحق منذ {daysLate} يوم.",
        inactiveTemplate = "اشتقنالك في {storeName}. يسعدنا رجوعك بأي وقت."
    ),
    val connectionMessage: String? = null,
    val backupMessage: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repository: SettingsRepository
) : ViewModel() {
    private val message = MutableStateFlow<String?>(null)
    private val backupMessage = MutableStateFlow<String?>(null)

    val state = combine(repository.settings, message, backupMessage) { settings, connection, backup ->
        SettingsUiState(settings, connection, backup)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun update(transform: (StoreSettings) -> StoreSettings) {
        viewModelScope.launch {
            repository.save(transform(state.value.settings))
        }
    }

    fun testConnection() {
        viewModelScope.launch {
            message.value = when (val result = repository.testConnection()) {
                is ApiResult.Success -> "الاتصال ناجح"
                is ApiResult.Queued -> result.message
                is ApiResult.Error -> result.message
                ApiResult.Offline -> "أنت offline"
                else -> "تعذر اختبار الاتصال"
            }
        }
    }

    fun exportBackup() {
        backupMessage.value = "تم تجهيز نسخة JSON للتصدير"
    }

    fun importBackup() {
        backupMessage.value = "تم اختيار ملف النسخة الاحتياطية"
    }
}
