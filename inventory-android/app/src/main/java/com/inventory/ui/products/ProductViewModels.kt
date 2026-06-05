package com.inventory.ui.products

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.data.repository.ProductRepository
import com.inventory.data.repository.SessionManager
import com.inventory.domain.model.Product
import com.inventory.domain.model.ProductMovement
import com.inventory.utils.PermissionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductListUiState(
    val products: List<Product> = emptyList(),
    val query: String = "",
    val category: String? = null,
    val sortBy: String = "updated",
    val isLoading: Boolean = false,
    val error: String? = null
) {
    val categories: List<String> = products.map { it.category }.filter { it.isNotBlank() }.distinct().sorted()
    val filteredProducts: List<Product> = products.filter { product ->
        val matchesQuery = query.isBlank() ||
            product.name.contains(query, ignoreCase = true) ||
            product.itemNumber.contains(query, ignoreCase = true)
        val matchesCategory = category == null || product.category == category
        matchesQuery && matchesCategory
    }.let { rows ->
        when (sortBy) {
            "name" -> rows.sortedBy { it.name }
            "stockDesc" -> rows.sortedByDescending { it.currentStock }
            "stockAsc" -> rows.sortedBy { it.currentStock }
            "purchaseDesc" -> rows.sortedByDescending { it.purchasePrice }
            "saleDesc" -> rows.sortedByDescending { it.salePrice }
            else -> rows.sortedByDescending { it.updatedAt.orEmpty() }
        }
    }
}

@HiltViewModel
class ProductListViewModel @Inject constructor(
    private val repository: ProductRepository
) : ViewModel() {
    private val query = MutableStateFlow("")
    private val category = MutableStateFlow<String?>(null)
    private val sortBy = MutableStateFlow("updated")
    private val isLoading = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)

    val state: StateFlow<ProductListUiState> = combine(
        combine(repository.products, query, category, isLoading, error) { products, queryValue, categoryValue, loadingValue, errorValue ->
            ProductListUiState(products, queryValue, categoryValue, isLoading = loadingValue, error = errorValue)
        },
        sortBy
    ) { stateValue, sortValue ->
        stateValue.copy(sortBy = sortValue)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductListUiState())

    init {
        refresh()
        // ── Auto-refresh every 30 seconds (silent) ──
        viewModelScope.launch {
            while (true) {
                delay(30_000L)
                repository.refreshProducts() // silent — DB Flow updates UI automatically
            }
        }
    }

    fun onQueryChange(value: String) { query.value = value }
    fun onCategoryChange(value: String?) { category.value = value }
    fun onSortChange(value: String) { sortBy.value = value }

    fun refresh() {
        viewModelScope.launch {
            isLoading.value = true
            when (val result = repository.refreshProducts()) {
                is ApiResult.Error  -> error.value = result.message
                ApiResult.Offline   -> error.value = "لا يوجد اتصال، يتم عرض البيانات المحلية"
                is ApiResult.Success -> error.value = null
            }
            isLoading.value = false
        }
    }
}

@HiltViewModel
class ProductDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: ProductRepository,
    sessionManager: SessionManager
) : ViewModel() {
    private val productId: String = checkNotNull(savedStateHandle["productId"])

    val product: StateFlow<Product?> = repository.observeProduct(productId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Dynamic API base URL for QR image loading (strips trailing /api/ to get server root) */
    val apiBaseUrl: StateFlow<String> = sessionManager.baseUrl
        .map { url ->
            // "http://10.x.x.x:5000/api/" -> "http://10.x.x.x:5000/api"
            url.trimEnd('/')
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), sessionManager.currentBaseUrl.trimEnd('/'))

    private val _deleteError = MutableStateFlow<String?>(null)
    val deleteError: StateFlow<String?> = _deleteError.asStateFlow()

    fun deleteProduct(onSuccess: () -> Unit = {}) {
        viewModelScope.launch {
            when (val result = repository.deleteProduct(productId)) {
                is ApiResult.Success -> {
                    _deleteError.value = null
                    onSuccess()
                }
                is ApiResult.Error   -> _deleteError.value = result.message
                ApiResult.Offline    -> _deleteError.value = "لا يوجد اتصال بالإنترنت"
                is ApiResult.Queued  -> {
                    _deleteError.value = null
                    onSuccess()
                }
            }
        }
    }

    fun clearDeleteError() { _deleteError.value = null }
}

data class BranchItem(val id: String, val name: String)

data class ProductFormUiState(
    val itemNumber: String = "",
    val name: String = "",
    val qrCode: String = "",
    val imageUrl: String? = null,
    val category: String = "",
    val unit: String = "PIECE",
    val openingBalancePcs: String = "0",
    val cartonsAvailable: String = "0",
    val pcsPerCarton: String = "1",
    val purchasePrice: String = "0",
    val salePrice: String = "0",
    val minStock: String = "0",
    val branchId: String = "",
    val branches: List<BranchItem> = emptyList(),
    val isStaff: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false
) {
    val totalQuantity: Int = openingBalancePcs.toIntOrNull().orZero() +
        cartonsAvailable.toIntOrNull().orZero() * pcsPerCarton.toIntOrNull().orOne()
    val actionText: String = if (isStaff) "سيُرسل للموافقة" else "حفظ"
}

@HiltViewModel
class ProductFormViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: ProductRepository,
    sessionManager: SessionManager,
    private val permissionManager: PermissionManager
) : ViewModel() {
    private val productId: String? = savedStateHandle["productId"]
    private val initialQrCode: String? = savedStateHandle["qrCode"]
    private val initialName: String? = savedStateHandle["name"]
    private val _state = MutableStateFlow(ProductFormUiState())
    val state = _state.asStateFlow()

    init {
        if (!initialQrCode.isNullOrBlank()) {
            _state.value = _state.value.copy(qrCode = initialQrCode)
        }
        if (!initialName.isNullOrBlank()) {
            _state.value = _state.value.copy(name = initialName)
        }
        viewModelScope.launch {
            sessionManager.role.collect { role ->
                _state.value = _state.value.copy(isStaff = permissionManager.mustRequestApproval(role))
            }
        }
        // Load branches for optional branch selection
        viewModelScope.launch {
            when (val result = repository.loadBranches()) {
                is ApiResult.Success -> {
                    _state.value = _state.value.copy(
                        branches = result.data
                            .filter { it.isActive }
                            .map { BranchItem(id = it.id, name = it.name) }
                    )
                }
                else -> Unit
            }
        }
        if (productId != null) {
            viewModelScope.launch {
                repository.observeProduct(productId).collect { product ->
                    if (product != null) {
                        _state.value = _state.value.copy(
                            itemNumber = product.itemNumber,
                            name = product.name,
                            qrCode = product.qrCode,
                            imageUrl = product.imageUrl,
                            category = product.category,
                            openingBalancePcs = product.openingBalancePcs.toString(),
                            cartonsAvailable = product.cartonsAvailable.toString(),
                            pcsPerCarton = product.pcsPerCarton.toString(),
                            purchasePrice = product.purchasePrice.toString(),
                            salePrice = product.salePrice.toString(),
                            minStock = product.minStock.toString()
                        )
                    }
                }
            }
        }
    }

    fun update(field: String, value: String) {
        _state.value = when (field) {
            "itemNumber"       -> _state.value.copy(itemNumber = value)
            "name"             -> _state.value.copy(name = value)
            "qrCode"           -> _state.value.copy(qrCode = value)
            "imageUrl"         -> _state.value.copy(imageUrl = value.ifBlank { null })
            "category"         -> _state.value.copy(category = value)
            "unit"             -> _state.value.copy(unit = value)
            "openingBalancePcs"-> _state.value.copy(openingBalancePcs = value.filterNumber())
            "cartonsAvailable" -> _state.value.copy(cartonsAvailable = value.filterNumber())
            "pcsPerCarton"     -> _state.value.copy(pcsPerCarton = value.filterNumber())
            "purchasePrice"    -> _state.value.copy(purchasePrice = value.filterDecimal())
            "salePrice"        -> _state.value.copy(salePrice = value.filterDecimal())
            "minStock"         -> _state.value.copy(minStock = value.filterNumber())
            "branchId"         -> _state.value.copy(branchId = value)
            else               -> _state.value
        }.copy(error = null)
    }

    fun save() {
        val current = _state.value
        val validationError = validate(current)
        if (validationError != null) {
            _state.value = current.copy(error = validationError)
            return
        }
        viewModelScope.launch {
            _state.value = current.copy(isSaving = true)
            val request = UpsertProductRequest(
                itemNumber = current.itemNumber.trim(),
                name = current.name.trim(),
                qrCode = current.qrCode.trim(),
                imageUrl = current.imageUrl,
                category = current.category.trim(),
                openingBalancePcs = current.openingBalancePcs.toInt(),
                cartonsAvailable = current.cartonsAvailable.toInt(),
                pcsPerCarton = current.pcsPerCarton.toInt(),
                purchasePrice = current.purchasePrice.toDouble(),
                salePrice = current.salePrice.toDouble(),
                minStock = current.minStock.toInt(),
                branchId = current.branchId.ifBlank { null }
            )
            try {
                repository.saveProduct(productId, request)
                // ← تحديث فوري للمخزن حتى تظهر المادة الجديدة بدون إعادة التشغيل
                repository.refreshProducts()
                _state.value = _state.value.copy(isSaving = false, saved = true)
            } catch (error: Exception) {
                _state.value = _state.value.copy(isSaving = false, error = error.message ?: "تعذر حفظ المنتج")
            }
        }
    }

    private fun validate(state: ProductFormUiState): String? = when {
        state.name.isBlank() -> "اسم المنتج مطلوب"
        state.pcsPerCarton.toIntOrNull().orZero() <= 0 -> "عدد القطع بالكرتونة يجب أن يكون أكبر من صفر"
        state.salePrice.toDoubleOrNull() == null -> "سعر البيع غير صحيح"
        state.purchasePrice.toDoubleOrNull() == null -> "سعر الشراء غير صحيح"
        else -> null
    }
}

@HiltViewModel
class ProductMovementViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: ProductRepository
) : ViewModel() {
    private val productId: String = checkNotNull(savedStateHandle["productId"])
    private val from = MutableStateFlow("")
    private val to = MutableStateFlow("")
    private val rows = MutableStateFlow<List<ProductMovement>>(emptyList())
    val state = combine(from, to, rows) { fromValue, toValue, rowsValue ->
        ProductMovementUiState(fromValue, toValue, rowsValue)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductMovementUiState())

    init {
        refresh()
    }

    fun setFrom(value: String) {
        from.value = value
    }

    fun setTo(value: String) {
        to.value = value
    }

    fun refresh() {
        viewModelScope.launch {
            when (val result = repository.movement(productId, from.value, to.value)) {
                is ApiResult.Success -> rows.value = result.data
                else -> Unit
            }
        }
    }
}

data class ProductMovementUiState(
    val from: String = "",
    val to: String = "",
    val rows: List<ProductMovement> = emptyList()
)

@HiltViewModel
class QrScannerViewModel @Inject constructor(
    private val repository: ProductRepository
) : ViewModel() {
    private val _state = MutableStateFlow<QrScannerState>(QrScannerState.Scanning)
    val state = _state.asStateFlow()

    fun onQrDetected(value: String) {
        if (_state.value !is QrScannerState.Scanning) return
        viewModelScope.launch {
            _state.value = QrScannerState.Loading(value)
            when (val result = repository.findByQr(value)) {
                is ApiResult.Success -> _state.value = result.data?.let {
                    QrScannerState.Found(
                        it,
                        if (it.qrCode == value) "PIECE" else if (it.cartonQrCode == value) "CARTON" else "PIECE"
                    )
                } ?: QrScannerState.NotFound(value)
                is ApiResult.Error -> _state.value = QrScannerState.NotFound(value)
                ApiResult.Offline -> _state.value = QrScannerState.NotFound(value)
            }
        }
    }

    fun scanAgain() {
        _state.value = QrScannerState.Scanning
    }
}

sealed interface QrScannerState {
    data object Scanning : QrScannerState
    data class Loading(val code: String) : QrScannerState
    data class Found(val product: Product, val unit: String) : QrScannerState
    data class NotFound(val code: String) : QrScannerState
}

private fun String.filterNumber() = filter { it.isDigit() }.ifBlank { "0" }
private fun String.filterDecimal() = filter { it.isDigit() || it == '.' }.ifBlank { "0" }
private fun Int?.orZero() = this ?: 0
private fun Int?.orOne() = this ?: 1
