package com.inventory.ui.voice

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.OcrInvoiceRequest
import com.inventory.data.remote.dto.OcrItemDto
import com.inventory.data.remote.dto.OcrProductMatch
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.data.repository.ProductRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import javax.inject.Inject

// ── Decision per scanned item ─────────────────────────────────────────────────

data class OcrItemDecision(
    val item: OcrItemDto,
    val action: String = if (item.matched) "match" else "create",  // match | create | skip
    val selectedProductId: String = item.product?.id ?: item.suggestions.firstOrNull()?.id ?: "",
    val editedName: String      = item.extractedName,
    val editedQuantity: Int     = maxOf(1, item.quantity),
    val editedUnitPrice: Double = item.unitPrice,
    val editedSalePrice: Double = item.product?.salePrice ?: item.unitPrice,
    val editedPcsPerCarton: Int = item.product?.pcsPerCarton ?: 1,
)

// ── UI State ──────────────────────────────────────────────────────────────────

sealed interface OcrUiState {
    data object Idle : OcrUiState
    data object Scanning : OcrUiState
    data class Result(
        val decisions: List<OcrItemDecision>,
        val supplierName: String?,
        val invoiceDate: String?,
        val message: String,
    ) : OcrUiState
    data class Creating : OcrUiState
    data class Done(val message: String, val readyItems: List<OcrReadyItem>) : OcrUiState
    data class Error(val message: String) : OcrUiState
}

data class OcrReadyItem(
    val productId: String,
    val productName: String,
    val quantity: Int,
    val unit: String,
    val unitPrice: Double,
)

// ── ViewModel ─────────────────────────────────────────────────────────────────

@HiltViewModel
class OcrInvoiceViewModel @Inject constructor(
    private val apiClient: ApiClient,
    private val productRepository: ProductRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<OcrUiState>(OcrUiState.Idle)
    val uiState: StateFlow<OcrUiState> = _uiState.asStateFlow()

    fun resetToIdle() { _uiState.value = OcrUiState.Idle }

    // ── Scan image ────────────────────────────────────────────────────────────
    fun scanImage(context: Context, uri: Uri) {
        viewModelScope.launch {
            _uiState.value = OcrUiState.Scanning
            try {
                val base64 = uriToBase64(context, uri)
                if (base64 == null) {
                    _uiState.value = OcrUiState.Error("تعذر قراءة الصورة")
                    return@launch
                }

                val response = apiClient.api.scanInvoiceImage(OcrInvoiceRequest(base64))
                val body = response.body()

                if (!response.isSuccessful || body == null) {
                    _uiState.value = OcrUiState.Error("فشل الاتصال — كود ${response.code()}")
                    return@launch
                }

                if (!body.success || body.items.isEmpty()) {
                    _uiState.value = OcrUiState.Error(
                        body.message.ifBlank { "ما قدرت أقرأ منتجات من هذه الصورة" }
                    )
                    return@launch
                }

                _uiState.value = OcrUiState.Result(
                    decisions    = body.items.map { OcrItemDecision(it) },
                    supplierName = body.supplierName,
                    invoiceDate  = body.invoiceDate,
                    message      = body.message,
                )
            } catch (e: Exception) {
                _uiState.value = OcrUiState.Error(e.message ?: "خطأ غير متوقع")
            }
        }
    }

    // ── Patch a decision ──────────────────────────────────────────────────────
    fun patchDecision(index: Int, patch: OcrItemDecision.() -> OcrItemDecision) {
        val current = _uiState.value as? OcrUiState.Result ?: return
        val updated = current.decisions.toMutableList()
        if (index in updated.indices) updated[index] = updated[index].patch()
        _uiState.value = current.copy(decisions = updated)
    }

    // ── Confirm: create missing products → return ready items ─────────────────
    fun confirmItems(onDone: (List<OcrReadyItem>) -> Unit) {
        val current = _uiState.value as? OcrUiState.Result ?: return
        viewModelScope.launch {
            _uiState.value = OcrUiState.Creating
            val readyItems = mutableListOf<OcrReadyItem>()

            for (decision in current.decisions) {
                if (decision.action == "skip") continue
                val qty   = maxOf(1, decision.editedQuantity)
                val price = maxOf(0.0, decision.editedUnitPrice)

                if (decision.action == "match") {
                    val pid = decision.selectedProductId
                    if (pid.isBlank()) continue
                    val name = resolveProductName(decision, pid)
                    readyItems.add(OcrReadyItem(pid, name, qty, decision.item.unit, price))
                    continue
                }

                // create new product
                if (decision.editedName.isBlank()) continue
                val request = UpsertProductRequest(
                    name             = decision.editedName.trim(),
                    purchasePrice    = price,
                    salePrice        = maxOf(0.0, decision.editedSalePrice),
                    pcsPerCarton     = maxOf(1, decision.editedPcsPerCarton),
                    openingBalancePcs = qty,
                    minStock         = 0,
                )
                when (val result = productRepository.saveProduct(null, request)) {
                    is ApiResult.Success -> {
                        readyItems.add(OcrReadyItem(result.data.id, result.data.name, qty, decision.item.unit, price))
                    }
                    is ApiResult.Error -> {
                        _uiState.value = OcrUiState.Error("تعذر إنشاء \"${decision.editedName}\": ${result.message}")
                        return@launch
                    }
                    else -> {
                        _uiState.value = OcrUiState.Error("تعذر إنشاء \"${decision.editedName}\"")
                        return@launch
                    }
                }
            }

            if (readyItems.isEmpty()) {
                _uiState.value = OcrUiState.Error("اختار مادة واحدة على الأقل")
                return@launch
            }

            _uiState.value = OcrUiState.Done(
                "تم تجهيز ${readyItems.size} مادة بنجاح",
                readyItems,
            )
            onDone(readyItems)
        }
    }

    private fun resolveProductName(decision: OcrItemDecision, pid: String): String {
        val item = decision.item
        if (item.product?.id == pid) return item.product.name
        return item.suggestions.find { it.id == pid }?.name ?: decision.editedName
    }

    private fun uriToBase64(context: Context, uri: Uri): String? {
        return try {
            val inputStream = context.contentResolver.openInputStream(uri) ?: return null
            val original = BitmapFactory.decodeStream(inputStream)
            inputStream.close()

            // Resize to max 1200px to avoid huge payloads
            val maxSize = 1200
            val scale = if (original.width > maxSize || original.height > maxSize) {
                minOf(maxSize.toFloat() / original.width, maxSize.toFloat() / original.height)
            } else 1f

            val resized = if (scale < 1f) {
                Bitmap.createScaledBitmap(
                    original,
                    (original.width * scale).toInt(),
                    (original.height * scale).toInt(),
                    true,
                )
            } else original

            val out = ByteArrayOutputStream()
            resized.compress(Bitmap.CompressFormat.JPEG, 82, out)
            val bytes = out.toByteArray()
            "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
    }
}
