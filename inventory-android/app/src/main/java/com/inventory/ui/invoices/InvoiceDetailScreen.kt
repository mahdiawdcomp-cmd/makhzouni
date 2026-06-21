package com.inventory.ui.invoices

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.InvoiceItem
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.common.SummaryRow
import com.inventory.ui.common.TextAvatar
import com.inventory.ui.common.formatMoney
import com.inventory.ui.common.invoiceStatusBadge
import com.inventory.ui.common.paymentTypeBadge
import com.inventory.ui.common.toDisplayDate
import com.inventory.ui.theme.AppColor
import com.inventory.utils.printer.BluetoothPrinterManager
import com.inventory.utils.printer.InvoiceReceiptBuilder
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceDetailScreen(
    invoiceId: String,
    viewModel: InvoiceDetailViewModel = hiltViewModel(),
    onBack: () -> Unit,
    onEdit: (String) -> Unit = {},
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showPrinterDialog by remember { mutableStateOf(false) }
    var showCancelConfirm by remember { mutableStateOf(false) }
    var showReactivateConfirm by remember { mutableStateOf(false) }
    val printerManager = remember { BluetoothPrinterManager(context) }
    var pairedPrinters by remember { mutableStateOf(emptyList<BluetoothDevice>()) }

    LaunchedEffect(invoiceId) { viewModel.loadInvoice(invoiceId) }
    LaunchedEffect(state.message, state.error) {
        state.message?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.clearMessage()
        }
        state.error?.let {
            Toast.makeText(context, it, Toast.LENGTH_LONG).show()
            viewModel.clearMessage()
        }
    }

    val invoice = state.invoice

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(invoice?.invoiceNumber ?: "تفاصيل الفاتورة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        if (invoice != null) {
                            Text(invoice.date.toDisplayDate(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "رجوع") } },
                actions = {
                    if (invoice != null) {
                        IconButton(onClick = { onEdit(invoice.id) }) { Icon(Icons.Default.Edit, "تعديل") }
                        IconButton(onClick = {
                            pairedPrinters = printerManager.getPairedPrinters()
                            if (pairedPrinters.isEmpty()) Toast.makeText(context, "لا توجد طابعات مقترنة", Toast.LENGTH_SHORT).show()
                            else showPrinterDialog = true
                        }) { Icon(Icons.Default.Print, "طباعة") }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (invoice == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (state.error == null) CircularProgressIndicator()
                else Text(state.error.orEmpty(), color = MaterialTheme.colorScheme.error)
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { InvoiceHero(invoice) }

            item {
                SectionCard(title = "إجراءات الفاتورة") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(onClick = { onEdit(invoice.id) }, modifier = Modifier.weight(1f), enabled = !state.isActionLoading) {
                            Icon(Icons.Default.Edit, null, Modifier.size(18.dp))
                            Text("تعديل")
                        }
                        if (invoice.status == "CANCELLED") {
                            Button(
                                onClick = { showReactivateConfirm = true },
                                modifier = Modifier.weight(1f),
                                enabled = !state.isActionLoading,
                                colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600)
                            ) {
                                Icon(Icons.Default.Restore, null, Modifier.size(18.dp))
                                Text("إرجاع نشطة")
                            }
                        } else {
                            Button(
                                onClick = { showCancelConfirm = true },
                                modifier = Modifier.weight(1f),
                                enabled = !state.isActionLoading,
                                colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600)
                            ) {
                                Icon(Icons.Default.Cancel, null, Modifier.size(18.dp))
                                Text("إلغاء")
                            }
                        }
                    }
                    if (state.isActionLoading) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            Text("جاري تحديث الحساب والمخزون...", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            item {
                SectionCard(title = "بيانات الزبون", containerColor = MaterialTheme.colorScheme.primaryContainer) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TextAvatar(invoice.customerName, AppColor.Blue600, size = 44.dp)
                        Column(Modifier.weight(1f)) {
                            Text(invoice.customerName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            Text("رقم الفاتورة: ${invoice.invoiceNumber}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        val (payLabel, payType) = paymentTypeBadge(invoice.paymentType)
                        StatusBadge(payLabel, payType)
                    }
                }
            }

            if (invoice.items.isNotEmpty()) {
                item {
                    SectionCard(title = "الأصناف (${invoice.items.size})", containerColor = MaterialTheme.colorScheme.tertiaryContainer) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            invoice.items.forEachIndexed { index, item ->
                                InvoiceItemDetailRow(item)
                                if (index != invoice.items.lastIndex) HorizontalDivider()
                            }
                        }
                    }
                }
            }

            item {
                SectionCard(title = "الملخص المالي", containerColor = MaterialTheme.colorScheme.secondaryContainer) {
                    SummaryRow("قيمة الأصناف", "${invoice.subtotal.formatMoney()} IQD")
                    if (invoice.discount > 0) SummaryRow("الخصم", "-${invoice.discount.formatMoney()} IQD", valueColor = AppColor.Red600)
                    SummaryRow("إجمالي الفاتورة", "${invoice.totalAmount.formatMoney()} IQD", bold = true)
                    SummaryRow("المدفوع", "${invoice.paidAmount.formatMoney()} IQD", valueColor = AppColor.Green600)
                    SummaryRow("المتبقي", "${invoice.remainingAmount.formatMoney()} IQD", valueColor = if (invoice.remainingAmount > 0) AppColor.Red600 else AppColor.Green600, bold = true)
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    SummaryRow("الحساب السابق", "${invoice.previousBalance.formatMoney()} IQD")
                    SummaryRow("الحساب النهائي", "${invoice.finalBalance.formatMoney()} IQD", valueColor = if (invoice.finalBalance > 0) AppColor.Red600 else AppColor.Green600, bold = true)
                }
            }
        }
    }

    if (showCancelConfirm) {
        ConfirmInvoiceDialog(
            title = "إلغاء الفاتورة؟",
            body = "سيتم إرجاع المواد وتعديل حساب الزبون حسب السيرفر.",
            confirmText = "إلغاء الفاتورة",
            confirmColor = AppColor.Red600,
            onDismiss = { showCancelConfirm = false },
            onConfirm = {
                showCancelConfirm = false
                viewModel.cancelInvoice()
            }
        )
    }

    if (showReactivateConfirm) {
        ConfirmInvoiceDialog(
            title = "إرجاع الفاتورة نشطة؟",
            body = "سيتم إعادة تأثير المواد والحساب على هذه الفاتورة.",
            confirmText = "إرجاع نشطة",
            confirmColor = AppColor.Green600,
            onDismiss = { showReactivateConfirm = false },
            onConfirm = {
                showReactivateConfirm = false
                viewModel.reactivateInvoice()
            }
        )
    }

    if (showPrinterDialog && invoice != null) {
        AlertDialog(
            onDismissRequest = { showPrinterDialog = false },
            icon = { Icon(Icons.Default.Print, null) },
            title = { Text("اختر طابعة") },
            text = {
                LazyColumn {
                    @SuppressLint("MissingPermission")
                    items(pairedPrinters) { device ->
                        ListItem(
                            headlineContent = { Text(device.name ?: device.address) },
                            leadingContent = { Icon(Icons.Default.BluetoothConnected, null) },
                            modifier = Modifier.clickable {
                                showPrinterDialog = false
                                scope.launch {
                                    val bytes = InvoiceReceiptBuilder().build(invoice)
                                    val ok = printerManager.print(device, bytes)
                                    Toast.makeText(context, if (ok) "تم الإرسال للطابعة" else "فشل الإرسال للطابعة", Toast.LENGTH_SHORT).show()
                                }
                            },
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { showPrinterDialog = false }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun InvoiceHero(invoice: Invoice) {
    val isPurchase = invoice.type == "PURCHASE"
    val isReturn = invoice.type == "SALES_RETURN"
    val color = when {
        invoice.status == "CANCELLED" -> AppColor.Red600
        isPurchase -> AppColor.Amber600
        isReturn -> AppColor.Red600
        else -> AppColor.Blue600
    }
    val label = when {
        invoice.status == "CANCELLED" -> "فاتورة ملغاة"
        isPurchase -> "فاتورة شراء"
        isReturn -> "مرتجع مبيعات"
        else -> "فاتورة بيع"
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = color,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(label, color = Color.White.copy(alpha = 0.82f), style = MaterialTheme.typography.labelMedium)
                    Text(invoice.invoiceNumber, color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val (statusLabel, _) = invoiceStatusBadge(invoice.status)
                StatusBadge(statusLabel, if (invoice.status == "CANCELLED") StatusType.ERROR else StatusType.SUCCESS)
            }
            HorizontalDivider(color = Color.White.copy(alpha = 0.22f))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("الإجمالي", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
                    Text("${invoice.totalAmount.formatMoney()} IQD", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("الباقي", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
                    Text("${invoice.remainingAmount.formatMoney()} IQD", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun InvoiceItemDetailRow(item: InvoiceItem) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(38.dp).background(AppColor.Blue100, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
            Text(unitLabel(item.unit).take(1), color = AppColor.Blue600, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text(item.productName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${item.quantity} ${unitLabel(item.unit)} x ${item.unitPrice.formatMoney()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("${item.totalPrice.formatMoney()} IQD", fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun ConfirmInvoiceDialog(
    title: String,
    body: String,
    confirmText: String,
    confirmColor: Color,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.ErrorOutline, null, tint = confirmColor) },
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            Button(onClick = onConfirm, colors = ButtonDefaults.buttonColors(containerColor = confirmColor)) {
                Text(confirmText)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("بقاء") } }
    )
}

private fun unitLabel(unit: String) = when (unit) {
    "DOZEN" -> "درزن"
    "CARTON" -> "كارتون"
    else -> "قطعة"
}
