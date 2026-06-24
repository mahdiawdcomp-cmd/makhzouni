package com.inventory.ui.products

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.data.remote.dto.WarehouseDistributionItem
import com.inventory.data.repository.ProductRepository
import com.inventory.data.repository.SessionManager
import com.inventory.domain.model.CatalogCategory
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
import kotlinx.coroutines.flow.collect
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
    val error: String? = null,
    val hidePrices: Boolean = false,
    val showPurchasePrice: Boolean = false
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
    private val repository: ProductRepository,
    sessionManager: SessionManager,
    permissionManager: PermissionManager
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
        combine(sortBy, sessionManager.role, sessionManager.permissions) { sort, role, perms ->
            Triple(sort, role, perms)
        }
    ) { stateValue, (sortValue, role, perms) ->
        stateValue.copy(
            sortBy = sortValue,
            hidePrices = permissionManager.viewWithoutPrices(role, perms),
            showPurchasePrice = permissionManager.canViewPurchasePrice(role, perms)
        )
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
    sessionManager: SessionManager,
    permissionManager: PermissionManager
) : ViewModel() {
    private val productId: String = checkNotNull(savedStateHandle["productId"])

    // Start with cached data; replaced by full API response (includes warehouseStocks)
    private val _product = MutableStateFlow<Product?>(null)
    val product: StateFlow<Product?> = _product.asStateFlow()

    init {
        // Observe cached product immediately so screen isn't blank
        viewModelScope.launch {
            repository.observeProduct(productId).collect { cached ->
                if (_product.value == null && cached != null) _product.value = cached
            }
        }
        // Then fetch full product from API to get warehouseStocks
        viewModelScope.launch {
            when (val result = repository.fetchById(productId)) {
                is ApiResult.Success -> _product.value = result.data
                else -> { /* keep cached */ }
            }
        }
    }

    /** Whether to hide all prices (VIEW_WITHOUT_PRICES permission). */
    val hidePrices: StateFlow<Boolean> = combine(sessionManager.role, sessionManager.permissions) { role, perms ->
        permissionManager.viewWithoutPrices(role, perms)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** Whether to show the purchase price column. */
    val showPurchasePrice: StateFlow<Boolean> = combine(sessionManager.role, sessionManager.permissions) { role, perms ->
        permissionManager.canViewPurchasePrice(role, perms)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

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
    val cartonQrCode: String = "",
    val imageUrl: String? = null,
    // Thumbnail shown in the edit preview only — never sent back on save, so the
    // full image is never overwritten by the small thumbnail.
    val thumbnailUrl: String? = null,
    val category: String = "",
    val categoryTags: List<String> = emptyList(),
    val typeTags: List<String> = emptyList(),
    val catalogCategories: List<CatalogCategory> = emptyList(),
    /** Distinct categories already used in the product list — fed into the free-text dropdown when no catalog exists. */
    val existingCategories: List<String> = emptyList(),
    val isNewArrival: Boolean = false,
    val isOffer: Boolean = false,
    val oldPrice: String = "",
    val unit: String = "PIECE",
    // All numeric fields start EMPTY; blanks are treated as their auto-default
    // (0 for counts/prices, 1 for pcsPerCarton) in validate()/save().
    val openingBalancePcs: String = "",
    val cartonsAvailable: String = "",
    val pcsPerCarton: String = "",
    val purchasePrice: String = "",
    val salePrice: String = "",
    val retailPrice: String = "",
    val minStock: String = "",
    val branchId: String = "",
    val branches: List<BranchItem> = emptyList(),
    val branchesLoaded: Boolean = false,
    val warehouseDist: Map<String, String> = emptyMap(),
    val isEditing: Boolean = false,
    val isStaff: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false
) {
    val distSum: Int = warehouseDist.values.sumOf { it.toIntOrNull() ?: 0 }
    val enteredTotal: Int = openingBalancePcs.toIntOrNull().orZero() +
        cartonsAvailable.toIntOrNull().orZero() * pcsPerCarton.toIntOrNull().orOne()
    val totalQuantity: Int = if (warehouseDist.isNotEmpty()) distSum else enteredTotal
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
        // Load catalog categories (searchable dropdowns for category + type selection)
        viewModelScope.launch {
            when (val result = repository.loadCatalogCategories()) {
                is ApiResult.Success -> _state.value = _state.value.copy(catalogCategories = result.data)
                else -> Unit
            }
        }
        // Load distinct categories already used in products (fallback when no catalog categories exist)
        viewModelScope.launch {
            repository.products.collect { products ->
                val cats = products.map { it.category }.filter { it.isNotBlank() }.distinct().sorted()
                _state.value = _state.value.copy(existingCategories = cats)
            }
        }
        // Load branches for optional branch selection
        viewModelScope.launch {
            when (val result = repository.loadBranches()) {
                is ApiResult.Success -> {
                    val branches = result.data
                        .filter { it.isActive }
                        .map { BranchItem(id = it.id, name = it.name) }
                    val existingDistribution = _state.value.warehouseDist
                    _state.value = _state.value.copy(
                        branches = branches,
                        branchesLoaded = true,
                        warehouseDist = branches.associate { branch ->
                            branch.id to (existingDistribution[branch.id] ?: "")
                        }
                    )
                }
                else -> Unit
            }
        }
        if (productId != null) {
            _state.value = _state.value.copy(isEditing = true)
            viewModelScope.launch {
                repository.observeProduct(productId).collect { product ->
                    if (product != null && !_state.value.saved) {
                        _state.value = _state.value.copy(
                            itemNumber = product.itemNumber,
                            name = product.name,
                            qrCode = product.qrCode,
                            cartonQrCode = product.cartonQrCode,
                            imageUrl = product.imageUrl,
                            thumbnailUrl = product.thumbnailUrl,
                            category = product.category,
                            openingBalancePcs = product.openingBalancePcs.toString(),
                            cartonsAvailable = product.cartonsAvailable.toString(),
                            pcsPerCarton = product.pcsPerCarton.toString(),
                            purchasePrice = product.purchasePrice.toString(),
                            salePrice = product.salePrice.toString(),
                            retailPrice = product.retailPrice.toString(),
                            minStock = product.minStock.toString()
                        )
                    }
                }
            }
            // Fetch full product with warehouseStocks to pre-fill distribution
            viewModelScope.launch {
                when (val result = repository.fetchById(productId)) {
                    is ApiResult.Success -> {
                        val product = result.data
                        // Catalog metadata only comes from the full product fetch (not the cached entity)
                        _state.value = _state.value.copy(
                            categoryTags = product.categoryTags,
                            typeTags = product.typeTags,
                            isNewArrival = product.isNewArrival,
                            isOffer = product.isOffer,
                            oldPrice = product.oldPrice?.let { if (it > 0) it.toString() else "" } ?: ""
                        )
                        if (product.warehouseStocks.isNotEmpty()) {
                            val dist = product.warehouseStocks.associate { ws ->
                                ws.warehouseId to ws.quantityPieces.toString()
                            }
                            _state.value = _state.value.copy(warehouseDist = dist)
                        }
                    }
                    else -> Unit
                }
            }
        }
    }

    fun update(field: String, value: String) {
        _state.value = when (field) {
            "itemNumber"       -> _state.value.copy(itemNumber = value)
            "name"             -> _state.value.copy(name = value)
            "qrCode"           -> _state.value.copy(qrCode = value)
            "cartonQrCode"     -> _state.value.copy(cartonQrCode = value)
            "imageUrl"         -> _state.value.copy(imageUrl = value.ifBlank { null })
            "category"         -> _state.value.copy(category = value)
            "oldPrice"         -> _state.value.copy(oldPrice = value.filterDecimal().let { if (it == "0") "" else it })
            "unit"             -> _state.value.copy(unit = value)
            "openingBalancePcs"-> _state.value.copy(openingBalancePcs = value.filterNumber())
            "cartonsAvailable" -> _state.value.copy(cartonsAvailable = value.filterNumber())
            "pcsPerCarton"     -> _state.value.copy(pcsPerCarton = value.filterNumber())
            "purchasePrice"    -> _state.value.copy(purchasePrice = value.filterDecimal())
            "salePrice"        -> _state.value.copy(salePrice = value.filterDecimal())
            "retailPrice"      -> _state.value.copy(retailPrice = value.filterDecimal())
            "minStock"         -> _state.value.copy(minStock = value.filterNumber())
            "branchId"         -> _state.value.copy(branchId = value)
            else               -> _state.value
        }.copy(error = null)
    }

    fun updateWarehouseDist(warehouseId: String, value: String) {
        _state.value = _state.value.copy(
            warehouseDist = _state.value.warehouseDist + (warehouseId to value.filter { it.isDigit() }),
            error = null
        )
    }

    /** Toggle a catalog category chip; drops any type tags that no longer belong to a selected category. */
    fun toggleCategory(name: String) {
        val current = _state.value
        val selected = current.categoryTags.contains(name)
        val newCats = if (selected) current.categoryTags - name else current.categoryTags + name
        val validTypes = current.catalogCategories.filter { newCats.contains(it.name) }.flatMap { it.types }.toSet()
        _state.value = current.copy(
            categoryTags = newCats,
            category = newCats.firstOrNull() ?: "",
            typeTags = current.typeTags.filter { validTypes.contains(it) },
            error = null
        )
    }

    fun toggleType(name: String) {
        val current = _state.value
        val newTypes = if (current.typeTags.contains(name)) current.typeTags - name else current.typeTags + name
        _state.value = current.copy(typeTags = newTypes, error = null)
    }

    /** Single-select primary category (dropdown). Empty clears it and any chosen type. */
    fun selectPrimaryCategory(name: String) {
        val current = _state.value
        val validTypes = current.catalogCategories.firstOrNull { it.name == name }?.types ?: emptyList()
        _state.value = current.copy(
            category = name,
            categoryTags = if (name.isBlank()) emptyList() else listOf(name),
            typeTags = current.typeTags.filter { validTypes.contains(it) },
            error = null
        )
    }

    /** Single-select secondary category / type (dropdown). */
    fun selectType(name: String) {
        _state.value = _state.value.copy(typeTags = if (name.isBlank()) emptyList() else listOf(name), error = null)
    }

    fun toggleNewArrival() { _state.value = _state.value.copy(isNewArrival = !_state.value.isNewArrival, error = null) }
    fun toggleOffer() { _state.value = _state.value.copy(isOffer = !_state.value.isOffer, error = null) }

    fun save() {
        val current = _state.value
        val validationError = validate(current)
        if (validationError != null) {
            _state.value = current.copy(error = validationError)
            return
        }
        viewModelScope.launch {
            _state.value = current.copy(isSaving = true)
            val useDistribution = current.branches.isNotEmpty() && current.warehouseDist.isNotEmpty()
            val distribution = if (useDistribution) {
                current.warehouseDist.map { (warehouseId, qty) ->
                    WarehouseDistributionItem(warehouseId = warehouseId, pieces = qty.toIntOrNull() ?: 0)
                }
            } else null
            val request = UpsertProductRequest(
                itemNumber = current.itemNumber.trim(),
                name = current.name.trim(),
                qrCode = current.qrCode.trim(),
                cartonQrCode = current.cartonQrCode.trim().ifBlank { null },
                imageUrl = current.imageUrl,
                category = current.category.trim(),
                categoryTags = current.categoryTags.ifEmpty { null },
                typeTags = current.typeTags.ifEmpty { null },
                isNewArrival = current.isNewArrival,
                isOffer = current.isOffer,
                oldPrice = if (current.isOffer) current.oldPrice.toDoubleOrNull() else null,
                // Always send real opening pieces/cartons: when a distribution is
                // present the backend asserts sum(distribution) == openingPcs +
                // cartons*pcsPerCarton. Zeroing these (the old bug) made the server
                // compute total=0 and reject every stocked item with 400 DISTRIBUTION_MISMATCH.
                openingBalancePcs = current.openingBalancePcs.toIntOrNull() ?: 0,
                cartonsAvailable = current.cartonsAvailable.toIntOrNull() ?: 0,
                pcsPerCarton = current.pcsPerCarton.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                purchasePrice = current.purchasePrice.toDoubleOrNull() ?: 0.0,
                salePrice = current.salePrice.toDoubleOrNull() ?: 0.0,
                retailPrice = current.retailPrice.toDoubleOrNull() ?: 0.0,
                minStock = current.minStock.toIntOrNull() ?: 0,
                branchId = current.branchId.ifBlank { null },
                warehouseDistribution = distribution
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
        // Blank = auto (1 piece/carton); only a typed non-positive value is invalid.
        state.pcsPerCarton.isNotBlank() && state.pcsPerCarton.toIntOrNull().orZero() <= 0 -> "عدد القطع بالكرتونة يجب أن يكون أكبر من صفر"
        state.salePrice.isNotBlank() && state.salePrice.toDoubleOrNull() == null -> "سعر البيع غير صحيح"
        state.purchasePrice.isNotBlank() && state.purchasePrice.toDoubleOrNull() == null -> "سعر الشراء غير صحيح"
        !state.branchesLoaded -> "تعذر تحميل المخازن. تحقق من الاتصال ثم أعد فتح الصفحة"
        state.branches.isEmpty() -> "أضف مخزناً واحداً على الأقل قبل حفظ المادة"
        !state.isEditing && state.distSum != state.enteredTotal ->
            "وزّع كامل الكمية على المخازن. المدخل ${state.enteredTotal} قطعة والموزع ${state.distSum} قطعة"
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

// Keep only valid characters but allow the field to be EMPTY (blank = auto-default).
private fun String.filterNumber() = filter { it.isDigit() }
private fun String.filterDecimal() = filter { it.isDigit() || it == '.' }
private fun Int?.orZero() = this ?: 0
private fun Int?.orOne() = this ?: 1
