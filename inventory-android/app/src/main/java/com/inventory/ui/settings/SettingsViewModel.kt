package com.inventory.ui.settings

import android.os.Environment
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.InventoryApi
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.LicenseStatusDto
import com.inventory.data.repository.DEFAULT_API_BASE_URL
import com.inventory.data.repository.SettingsRepository
import com.inventory.data.repository.StoreSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
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
        inactiveTemplate = "اشتقنالك في {storeName}. يسعدنا رجوعك بأي وقت.",
        appTheme = "PROFESSIONAL"
    ),
    val connectionMessage: String? = null,
    val backupMessage: String? = null,
    val licenseStatus: LicenseStatusDto? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repository: SettingsRepository,
    private val api: InventoryApi
) : ViewModel() {
    private val message       = MutableStateFlow<String?>(null)
    private val backupMessage = MutableStateFlow<String?>(null)
    private val licenseStatus = MutableStateFlow<LicenseStatusDto?>(null)

    val state = combine(repository.settings, message, backupMessage, licenseStatus) { settings, connection, backup, license ->
        SettingsUiState(settings, connection, backup, license)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    // ── مخزن المحل الافتراضي للبيع — backend-shared setting (GET/PUT /settings), separate from
    // the local per-device StoreSettings above. Own small state so it doesn't need to join the
    // combine() above (already at its practical arity limit).
    private val _branches = MutableStateFlow<List<BranchDto>>(emptyList())
    val branches: StateFlow<List<BranchDto>> = _branches.asStateFlow()

    private val _shopWarehouseId = MutableStateFlow<String?>(null)
    val shopWarehouseId: StateFlow<String?> = _shopWarehouseId.asStateFlow()

    private val _shopWarehouseLoading = MutableStateFlow(false)
    val shopWarehouseLoading: StateFlow<Boolean> = _shopWarehouseLoading.asStateFlow()

    private val _shopWarehouseSaving = MutableStateFlow(false)
    val shopWarehouseSaving: StateFlow<Boolean> = _shopWarehouseSaving.asStateFlow()

    private val _shopWarehouseMessage = MutableStateFlow<String?>(null)
    val shopWarehouseMessage: StateFlow<String?> = _shopWarehouseMessage.asStateFlow()

    init {
        loadLicenseStatus()
        loadShopWarehouseSettings()
    }

    fun loadShopWarehouseSettings() {
        viewModelScope.launch {
            _shopWarehouseLoading.value = true
            when (val result = repository.loadBranches()) {
                is ApiResult.Success -> _branches.value = result.data
                is ApiResult.Error -> _shopWarehouseMessage.value = "✗ ${result.message}"
                else -> Unit
            }
            when (val result = repository.getShopWarehouseId()) {
                is ApiResult.Success -> _shopWarehouseId.value = result.data
                is ApiResult.Error -> _shopWarehouseMessage.value = "✗ ${result.message}"
                else -> Unit
            }
            _shopWarehouseLoading.value = false
        }
    }

    /** warehouseId == "" clears the setting (no default warehouse configured). */
    fun saveShopWarehouseId(warehouseId: String) {
        viewModelScope.launch {
            _shopWarehouseSaving.value = true
            _shopWarehouseMessage.value = null
            when (val result = repository.updateShopWarehouseId(warehouseId)) {
                is ApiResult.Success -> {
                    _shopWarehouseId.value = result.data
                    _shopWarehouseMessage.value = "✓ تم حفظ مخزن المحل الافتراضي"
                }
                is ApiResult.Error -> _shopWarehouseMessage.value = "✗ ${result.message}"
                ApiResult.Offline -> _shopWarehouseMessage.value = "✗ لا يوجد اتصال بالإنترنت"
                else -> _shopWarehouseMessage.value = "✗ فشل الحفظ"
            }
            _shopWarehouseSaving.value = false
        }
    }

    fun update(transform: (StoreSettings) -> StoreSettings) {
        viewModelScope.launch { repository.save(transform(state.value.settings)) }
    }

    fun testConnection() {
        viewModelScope.launch {
            message.value = when (val result = repository.testConnection()) {
                is ApiResult.Success -> "الاتصال ناجح"
                is ApiResult.Queued  -> result.message
                is ApiResult.Error   -> result.message
                ApiResult.Offline    -> "أنت offline"
                else -> "تعذر اختبار الاتصال"
            }
        }
    }

    /** Tells the server to send a backup JSON to the configured Telegram bot */
    fun sendTelegramBackup() {
        viewModelScope.launch {
            backupMessage.value = "جاري الإرسال إلى تيليغرام..."
            try {
                val resp = api.sendBackupToTelegram()
                backupMessage.value = if (resp.success) "✓ تم إرسال النسخة إلى تيليغرام" else "✗ ${resp.message ?: "فشل الإرسال"}"
            } catch (e: Exception) {
                backupMessage.value = "✗ ${e.message ?: "فشل الإرسال"}"
            }
        }
    }

    /** Downloads full backup JSON from the server and saves to device Downloads folder */
    fun downloadBackup() {
        viewModelScope.launch {
            backupMessage.value = "جاري تحميل النسخة الاحتياطية..."
            try {
                val body  = api.downloadBackup()
                val bytes = body.bytes()
                val dir   = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val date  = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
                val file  = File(dir, "makhzouni-backup-$date.json")
                file.writeBytes(bytes)
                backupMessage.value = "✓ محفوظ: ${file.name}"
            } catch (e: Exception) {
                backupMessage.value = "✗ ${e.message ?: "فشل التحميل"}"
            }
        }
    }

    fun exportBackup() {
        sendTelegramBackup()
    }

    fun importBackup() {
        backupMessage.value = "الاستيراد متاح من لوحة الويب"
    }

    private fun loadLicenseStatus() {
        viewModelScope.launch {
            try { licenseStatus.value = api.getLicenseStatus().data } catch (_: Exception) {}
        }
    }
}
