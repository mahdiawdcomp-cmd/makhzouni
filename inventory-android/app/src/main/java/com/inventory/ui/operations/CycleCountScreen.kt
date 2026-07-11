package com.inventory.ui.operations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.inventory.data.remote.dto.CycleCountItemDto
import com.inventory.data.remote.dto.CycleCountSessionDto
import com.inventory.data.remote.dto.CycleCountSessionDetailDto
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.theme.AppColor

private val STRATEGY_LABELS = linkedMapOf(
    "RANDOM" to "عشوائي",
    "HIGH_VALUE" to "الأعلى قيمة",
    "FAST_MOVING" to "الأسرع حركة",
    "LOW_STOCK" to "الأقرب لنفاد المخزون",
    "LEAST_RECENTLY_COUNTED" to "الأقدم عهداً بالجرد",
)

private fun strategyLabel(key: String) = STRATEGY_LABELS[key] ?: key

private fun statusBadge(status: String): Pair<String, StatusType> = when (status) {
    "OPEN"      -> "مفتوح — جاري الجرد" to StatusType.INFO
    "SUBMITTED" -> "مرفوع — بانتظار المراجعة" to StatusType.WARNING
    "CANCELLED" -> "ملغى" to StatusType.NEUTRAL
    else        -> "مغلق" to StatusType.SUCCESS
}

@Composable
fun CycleCountScreen(
    viewModel: CycleCountViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); viewModel.clearMessage() } }
    LaunchedEffect(state.message) { state.message?.let { snackbar.showSnackbar(it); viewModel.clearMessage() } }

    val detail = state.selected
    if (detail != null) {
        CycleCountDetail(
            detail = detail,
            busy = state.busy,
            loading = state.detailLoading,
            snackbar = snackbar,
            onBack = { viewModel.closeDetail() },
            onSetQty = viewModel::setItemQty,
            onSubmit = viewModel::submit,
            onClose = viewModel::close,
            onCancel = viewModel::cancel,
            onReopen = viewModel::reopen,
            onApproveItem = viewModel::approveItem,
            onRejectItem = viewModel::rejectItem,
            onApproveAll = viewModel::approveAll,
            onRejectAll = viewModel::rejectAll,
        )
        return
    }

    var showCreate by remember { mutableStateOf(false) }
    if (showCreate) {
        CreateCycleCountDialog(
            onDismiss = { showCreate = false },
            onConfirm = { strategy, itemLimit, notes ->
                showCreate = false
                viewModel.createSession(null, strategy, itemLimit, notes)
            }
        )
    }

    AppScreen(
        title = "الجرد الذكي",
        onBack = onBack,
        snackbarHost = { SnackbarHost(snackbar) },
        fab = {
            ExtendedFloatingActionButton(
                onClick = { showCreate = true },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("جلسة جديدة") },
            )
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.sessions.isEmpty() -> Text(
                    "لا توجد جلسات جرد ذكي بعد. أنشئ جلسة يدوياً بالزر أدناه.",
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(state.sessions, key = { it.id }) { session ->
                        SessionCard(session) { viewModel.openSession(session.id) }
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }
}

@Composable
private fun SessionCard(session: CycleCountSessionDto, onClick: () -> Unit) {
    val (label, type) = statusBadge(session.status)
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "جرد ذكي ${session.createdAt.take(10)}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                StatusBadge(label = label, type = type)
            }
            Text(
                "${session.creator?.name ?: "—"} · ${session.itemCount} منتج · ${strategyLabel(session.strategy)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            session.warehouse?.name?.let {
                Text("المخزن: $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateCycleCountDialog(
    onDismiss: () -> Unit,
    onConfirm: (strategy: String, itemLimit: Int, notes: String?) -> Unit
) {
    var strategy by remember { mutableStateOf("RANDOM") }
    var itemLimit by remember { mutableStateOf("20") }
    var notes by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("جلسة جرد ذكي جديدة") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
                    OutlinedTextField(
                        value = strategyLabel(strategy),
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("طريقة اختيار المواد") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(),
                    )
                    androidx.compose.material3.ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        STRATEGY_LABELS.forEach { (key, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { strategy = key; expanded = false })
                        }
                    }
                }
                OutlinedTextField(
                    value = itemLimit,
                    onValueChange = { v -> itemLimit = v.filter { it.isDigit() } },
                    label = { Text("عدد المواد بالجلسة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("ملاحظات (اختياري)") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(strategy, itemLimit.toIntOrNull()?.coerceAtLeast(1) ?: 20, notes) }) {
                Text("إنشاء الجلسة")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun CycleCountDetail(
    detail: CycleCountSessionDetailDto,
    busy: Boolean,
    loading: Boolean,
    snackbar: SnackbarHostState,
    onBack: () -> Unit,
    onSetQty: (productId: String, actualQty: Int) -> Unit,
    onSubmit: () -> Unit,
    onClose: () -> Unit,
    onCancel: () -> Unit,
    onReopen: () -> Unit,
    onApproveItem: (itemId: String) -> Unit,
    onRejectItem: (itemId: String) -> Unit,
    onApproveAll: () -> Unit,
    onRejectAll: () -> Unit,
) {
    val isOpen = detail.status == "OPEN"
    val isSubmitted = detail.status == "SUBMITTED"
    val (label, type) = statusBadge(detail.status)

    AppScreen(
        title = "جرد ذكي ${detail.createdAt.take(10)}",
        onBack = onBack,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        StatusBadge(label = label, type = type)
                        Text(
                            "${detail.stats.filled}/${detail.stats.total} مجرود · ${detail.stats.errors} فرق",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                // ── Action bar ──────────────────────────────────────────────
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (isOpen) {
                            Button(
                                onClick = onSubmit,
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("إرسال الجرد للمراجعة") }
                        }
                        if (isSubmitted) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = onApproveAll,
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                                ) { Text("موافقة الكل") }
                                Button(
                                    onClick = onRejectAll,
                                    enabled = !busy,
                                    modifier = Modifier.weight(1f),
                                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600),
                                ) { Text("رفض الكل") }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = onReopen, enabled = !busy, modifier = Modifier.weight(1f)) {
                                    Text("إعادة فتح")
                                }
                                OutlinedButton(onClick = onClose, enabled = !busy, modifier = Modifier.weight(1f)) {
                                    Text("إغلاق الجلسة")
                                }
                            }
                        }
                        if (isOpen || isSubmitted) {
                            TextButton(onClick = onCancel, enabled = !busy) {
                                Text("إلغاء الجلسة", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }

                item { HorizontalDivider() }

                items(detail.items, key = { it.id }) { item ->
                    CycleCountItemRow(
                        item = item,
                        canEdit = isOpen && !busy,
                        canReview = isSubmitted && !busy,
                        onSetQty = { qty -> onSetQty(item.productId, qty) },
                        onApprove = { onApproveItem(item.id) },
                        onReject = { onRejectItem(item.id) },
                    )
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
            if (loading || busy) {
                CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 8.dp))
            }
        }
    }
}

@Composable
private fun CycleCountItemRow(
    item: CycleCountItemDto,
    canEdit: Boolean,
    canReview: Boolean,
    onSetQty: (Int) -> Unit,
    onApprove: () -> Unit,
    onReject: () -> Unit,
) {
    var qtyText by remember(item.id, item.actualQty) { mutableStateOf(item.actualQty?.toString() ?: "") }

    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(item.productName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                when (item.approvalStatus) {
                    "APPROVED" -> StatusBadge("معتمد", StatusType.SUCCESS)
                    "REJECTED" -> StatusBadge("مرفوض", StatusType.ERROR)
                    else -> if (item.hasError) StatusBadge("فرق ${item.variance}", StatusType.WARNING) else Unit
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "النظام: ${item.systemQty}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (canEdit) {
                    OutlinedTextField(
                        value = qtyText,
                        onValueChange = { v -> qtyText = v.filter { it.isDigit() } },
                        label = { Text("الفعلي") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        singleLine = true,
                        modifier = Modifier.width(110.dp),
                    )
                    Button(
                        onClick = { qtyText.toIntOrNull()?.let(onSetQty) },
                        enabled = qtyText.toIntOrNull() != null && qtyText.toIntOrNull() != item.actualQty,
                    ) { Text("حفظ") }
                } else {
                    Text(
                        "الفعلي: ${item.actualQty?.toString() ?: "—"}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            if (canReview && item.hasError && item.approvalStatus == "PENDING") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onApprove,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                    ) {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("موافقة")
                    }
                    OutlinedButton(onClick = onReject, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("رفض")
                    }
                }
            }
        }
    }
}
