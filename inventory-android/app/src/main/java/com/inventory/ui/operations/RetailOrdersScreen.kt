package com.inventory.ui.operations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.dto.RetailOrderDto
import com.inventory.data.repository.CatalogRepository
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.SectionCard
import com.inventory.ui.theme.AppColor
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.NumberFormat
import javax.inject.Inject

data class RetailOrdersUiState(
    val isLoading: Boolean = false,
    val status: String = "PENDING",
    val orders: List<RetailOrderDto> = emptyList(),
    val error: String? = null,
    val message: String? = null,
    val actingId: String? = null,
)

@HiltViewModel
class RetailOrdersViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RetailOrdersUiState())
    val uiState: StateFlow<RetailOrdersUiState> = _uiState.asStateFlow()

    init { load() }

    fun setStatus(status: String) {
        _uiState.update { it.copy(status = status) }
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null, message = null) }
            when (val result = catalogRepository.getRetailOrders(_uiState.value.status)) {
                is ApiResult.Success -> _uiState.update { it.copy(isLoading = false, orders = result.data) }
                is ApiResult.Error -> _uiState.update { it.copy(isLoading = false, error = result.message) }
                ApiResult.Offline -> _uiState.update { it.copy(isLoading = false, error = "لا يوجد اتصال بالإنترنت") }
            }
        }
    }

    fun prepare(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(actingId = id) }
            when (val result = catalogRepository.prepareRetailOrder(id)) {
                is ApiResult.Success -> { _uiState.update { it.copy(actingId = null, message = "تم تجهيز الطلب وإشعار الزبون") }; load() }
                is ApiResult.Error -> _uiState.update { it.copy(actingId = null, error = result.message) }
                ApiResult.Offline -> _uiState.update { it.copy(actingId = null, error = "لا يوجد اتصال بالإنترنت") }
            }
        }
    }

    fun cancel(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(actingId = id) }
            when (val result = catalogRepository.cancelRetailOrder(id)) {
                is ApiResult.Success -> { _uiState.update { it.copy(actingId = null, message = "تم إلغاء الطلب") }; load() }
                is ApiResult.Error -> _uiState.update { it.copy(actingId = null, error = result.message) }
                ApiResult.Offline -> _uiState.update { it.copy(actingId = null, error = "لا يوجد اتصال بالإنترنت") }
            }
        }
    }
}

private fun money(value: Double): String = NumberFormat.getIntegerInstance().format(value)

@Composable
fun RetailOrdersScreen(viewModel: RetailOrdersViewModel, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    AppScreen(title = "طلبات المفرد", onBack = onBack) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("PENDING" to "قيد التجهيز", "PREPARED" to "مجهزة", "CANCELLED" to "ملغاة").forEach { (key, label) ->
                    FilterChip(
                        selected = state.status == key,
                        onClick = { viewModel.setStatus(key) },
                        label = { Text(label) },
                    )
                }
            }

            state.message?.let { Text(it, color = AppColor.Green600, fontWeight = FontWeight.Bold) }
            state.error?.let { Text(it, color = AppColor.Red600) }

            if (state.isLoading) {
                Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    CircularProgressIndicator()
                }
            } else if (state.orders.isEmpty()) {
                Text(
                    "لا توجد طلبات.",
                    modifier = Modifier.fillMaxWidth().padding(top = 40.dp),
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(state.orders, key = { it.id }) { order ->
                        RetailOrderCard(
                            order = order,
                            acting = state.actingId == order.id,
                            onPrepare = { viewModel.prepare(order.id) },
                            onCancel = { viewModel.cancel(order.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RetailOrderCard(
    order: RetailOrderDto,
    acting: Boolean,
    onPrepare: () -> Unit,
    onCancel: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(order.orderNumber, fontWeight = FontWeight.Bold, color = AppColor.Purple600)
                val (chipLabel, chipColor) = when (order.status) {
                    "PREPARED" -> "مجهز" to AppColor.Green600
                    "CANCELLED" -> "ملغي" to AppColor.Red600
                    else -> "قيد التجهيز" to AppColor.Amber600
                }
                AssistChip(onClick = {}, label = { Text(chipLabel, color = chipColor) })
            }

            Text(order.customerName, fontWeight = FontWeight.SemiBold)
            Text(order.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            order.address?.takeIf { it.isNotBlank() }?.let { Text("📍 $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            order.notes?.takeIf { it.isNotBlank() }?.let { Text("📝 $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }

            SectionCard(title = "المواد", containerColor = Color(0xFFF8FAFC)) {
                order.items.forEach { item ->
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(item.title, style = MaterialTheme.typography.bodyMedium)
                        Text("${item.quantity} × ${money(item.unitPrice)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                if (order.discount > 0) {
                    Text("خصم ${money(order.discount)}${order.couponCode?.let { " ($it)" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = AppColor.Green600)
                } else {
                    Text("")
                }
                Text("الإجمالي: ${money(order.total)}", fontWeight = FontWeight.Bold)
            }

            if (order.status == "PENDING") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onPrepare,
                        enabled = !acting,
                        colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (acting) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                        else Text("تم التجهيز")
                    }
                    OutlinedButton(onClick = onCancel, enabled = !acting) { Text("إلغاء") }
                }
            }
        }
    }
}
