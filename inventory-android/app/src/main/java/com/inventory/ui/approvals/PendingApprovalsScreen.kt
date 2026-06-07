package com.inventory.ui.approvals

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.inventory.domain.model.Approval
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.EmptyState
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.theme.AppColor

@Composable
fun PendingApprovalsScreen(viewModel: PendingApprovalsViewModel) {
    val approvals by viewModel.approvals.collectAsState()
    val message by viewModel.message.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    AppScreen(
        title = "الموافقات",
        actions = {
            OutlinedButton(onClick = viewModel::refresh, shape = RoundedCornerShape(10.dp)) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Text("تحديث")
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                ElevatedCard(
                    colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "طلبات تنتظر قرار الإدارة",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "راجع تفاصيل طلب الدخول أو طلب الفاتورة من الكتلوك، وبعدها وافق أو ارفض من نفس الشاشة.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
            }

            if (approvals.isEmpty()) {
                item {
                    EmptyState(
                        icon = Icons.Default.CheckCircle,
                        title = "لا توجد طلبات معلقة",
                        subtitle = "كل شيء مرتب حالياً."
                    )
                }
            } else {
                items(approvals, key = { it.id }) { approval ->
                    ApprovalCard(
                        approval = approval,
                        onApprove = { allowPrices, showStock -> viewModel.approve(approval.id, allowPrices, showStock) },
                        onReject = { viewModel.reject(approval.id) }
                    )
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun ApprovalCard(
    approval: Approval,
    onApprove: (allowPrices: Boolean?, showStock: Boolean?) -> Unit,
    onReject: () -> Unit
) {
    var allowPrices by remember(approval.id) { mutableStateOf(false) }
    var showStock by remember(approval.id) { mutableStateOf(true) }
    val isCatalogAccess = approval.requestType == "CATALOG_ACCESS"
    val isCatalogOrder = approval.requestType == "CATALOG_ORDER"

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    imageVector = if (isCatalogOrder) Icons.Default.ShoppingCart else Icons.Default.Storefront,
                    contentDescription = null,
                    tint = if (isCatalogOrder) AppColor.Green600 else AppColor.Blue600
                )
                Column(Modifier.weight(1f)) {
                    Text(typeLabel(approval.requestType), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                    Text(
                        approval.createdAt?.take(16)?.replace("T", " ") ?: "-",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                StatusBadge("معلق", StatusType.WARNING)
            }

            InfoGrid(approval)

            if (isCatalogAccess) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ToggleLine("إظهار الأسعار للزبون", allowPrices) { allowPrices = it }
                ToggleLine("إظهار الكميات للزبون", showStock) { showStock = it }
            }

            if (isCatalogOrder && approval.displayItems.isNotEmpty()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                approval.displayItems.take(5).forEach { item ->
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            item.productName,
                            Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text("${item.quantity} ${unitLabel(item.unit)}", style = MaterialTheme.typography.labelMedium)
                        item.totalPrice?.let {
                            Text(it.formatMoney(), style = MaterialTheme.typography.labelMedium, color = AppColor.Green600)
                        }
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    onClick = { onApprove(if (isCatalogAccess) allowPrices else null, if (isCatalogAccess) showStock else null) }
                ) {
                    Icon(Icons.Default.Check, contentDescription = null)
                    Text("وافق")
                }
                OutlinedButton(
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                    onClick = onReject
                ) {
                    Icon(Icons.Default.Close, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text("ارفض", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
private fun InfoGrid(approval: Approval) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        InfoLine("الزبون", approval.customerName ?: approval.requesterName)
        approval.phone?.let { InfoLine("الهاتف", it) }
        approval.address?.let { InfoLine("العنوان", it) }
        if (approval.itemCount > 0) InfoLine("الأصناف", approval.itemCount.toString())
        approval.subtotal?.let { InfoLine("المجموع", it.formatMoney()) }
        approval.notes?.let { InfoLine("ملاحظات", it) }
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            label,
            modifier = Modifier.weight(0.35f),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            value,
            modifier = Modifier.weight(0.65f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun ToggleLine(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        Checkbox(checked = checked, onCheckedChange = onChange)
    }
}

private fun typeLabel(type: String) = when (type) {
    "CATALOG_ACCESS" -> "طلب دخول كتلوك"
    "CATALOG_ORDER" -> "طلب فاتورة من الكتلوك"
    "CREATE_INVOICE" -> "إنشاء فاتورة"
    "UPDATE_INVOICE" -> "تعديل فاتورة"
    "CANCEL_INVOICE" -> "إلغاء فاتورة"
    "CREATE_VOUCHER" -> "إنشاء سند"
    "UPDATE_VOUCHER" -> "تعديل سند"
    "DELETE_VOUCHER" -> "حذف سند"
    "CREATE_USER" -> "إضافة مستخدم"
    "UPDATE_USER" -> "تعديل مستخدم"
    "DEACTIVATE_USER" -> "تعطيل مستخدم"
    "CREATE_PRODUCT" -> "إضافة مادة"
    "UPDATE_PRODUCT" -> "تعديل مادة"
    "DELETE_PRODUCT" -> "حذف مادة"
    else -> type
}

private fun unitLabel(unit: String) = when (unit) {
    "CARTON" -> "كارتون"
    "DOZEN" -> "درزن"
    else -> "قطعة"
}

private fun Double.formatMoney(): String = "%,.0f د.ع".format(this)
