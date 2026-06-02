package com.inventory.ui.invoices

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inventory.domain.model.InvoiceItem
import com.inventory.ui.common.*
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
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showPrinterDialog by remember { mutableStateOf(false) }
    val printerManager = remember { BluetoothPrinterManager(context) }
    var pairedPrinters by remember { mutableStateOf(emptyList<BluetoothDevice>()) }

    LaunchedEffect(invoiceId) { viewModel.loadInvoice(invoiceId) }

    val invoice = state.invoice

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            invoice?.invoiceNumber ?: "تفاصيل الفاتورة",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        if (invoice != null) {
                            Text(
                                invoice.date.toDisplayDate(),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "رجوع")
                    }
                },
                actions = {
                    if (invoice != null) {
                        IconButton(onClick = {
                            pairedPrinters = printerManager.getPairedPrinters()
                            if (pairedPrinters.isEmpty()) Toast.makeText(context, "لا توجد طابعات مقترنة", Toast.LENGTH_SHORT).show()
                            else showPrinterDialog = true
                        }) {
                            Icon(Icons.Default.Print, "طباعة")
                        }
                        IconButton(onClick = {}) {
                            Icon(Icons.Default.Share, "مشاركة")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (invoice == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── Hero banner ──────────────────────────────────────────
            item {
                val isPurchase = invoice.paymentType == "PURCHASE"
                val bannerColor = if (isPurchase)
                    Brush.horizontalGradient(listOf(AppColor.Amber600, Color(0xFFF97316)))
                else
                    Brush.horizontalGradient(listOf(AppColor.Blue600, AppColor.Blue800))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(bannerColor, RoundedCornerShape(16.dp))
                        .padding(20.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Top,
                        ) {
                            Column {
                                Text(
                                    text = if (isPurchase) "فاتورة شراء" else "فاتورة بيع",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Color.White.copy(alpha = 0.8f),
                                )
                                Text(
                                    text = invoice.invoiceNumber,
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                )
                            }
                            val (statusLabel, _) = invoiceStatusBadge(invoice.status)
                            Box(
                                modifier = Modifier
                                    .background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                            ) {
                                Text(statusLabel, color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                        HorizontalDivider(color = Color.White.copy(alpha = 0.2f))
                        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Text("الإجمالي", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.75f))
                                Text("${invoice.totalAmount.formatMoney()} IQD", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, color = Color.White)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text("الباقي", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.75f))
                                Text("${invoice.remainingAmount.formatMoney()} IQD", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = if (invoice.remainingAmount > 0) Color(0xFFFFE4B5) else Color.White)
                            }
                        }
                    }
                }
            }

            // ── Customer info ────────────────────────────────────────
            item {
                SectionCard(title = "بيانات الزبون") {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TextAvatar(invoice.customerName, AppColor.Blue600, size = 46.dp)
                        Column(Modifier.weight(1f)) {
                            Text(invoice.customerName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        }
                        val (payLabel, payType) = paymentTypeBadge(invoice.paymentType ?: "CREDIT")
                        StatusBadge(payLabel, payType)
                    }
                }
            }

            // ── Items ─────────────────────────────────────────────────
            if (invoice.items.isNotEmpty()) {
                item { SectionLabel("الأصناف (${invoice.items.size})") }
                items(invoice.items) { item ->
                    InvoiceItemDetailCard(item)
                }
            }

            // ── Financial summary ─────────────────────────────────────
            item {
                SectionCard(title = "الملخص المالي") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryRow("قيمة الأصناف", "${invoice.totalAmount.formatMoney()} IQD")
                        if ((invoice.remainingAmount) < invoice.totalAmount) {
                            SummaryRow("المدفوع", "${invoice.paidAmount.formatMoney()} IQD", valueColor = AppColor.Green600)
                            SummaryRow("المتبقي", "${invoice.remainingAmount.formatMoney()} IQD", valueColor = if (invoice.remainingAmount > 0) AppColor.Red600 else AppColor.Green600)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SummaryRow("الحساب السابق", "${invoice.previousBalance.formatMoney()} IQD")
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                        ) {
                            Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text("الرصيد النهائي", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                Text(
                                    "${invoice.finalBalance.formatMoney()} IQD",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = if (invoice.finalBalance > 0) AppColor.Red600 else AppColor.Green600,
                                )
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }

    // ── Printer dialog ──────────────────────────────────────────────────────
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
                                    Toast.makeText(context, if (ok) "تم الإرسال للطابعة" else "فشل الإرسال", Toast.LENGTH_SHORT).show()
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
private fun InvoiceItemDetailCard(item: InvoiceItem) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 0.5.dp,
    ) {
        Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(AppColor.Blue100, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(item.unit.take(1), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = AppColor.Blue600)
            }
            Column(Modifier.weight(1f)) {
                Text(item.productName, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text("${item.quantity} ${
                    when (item.unit) { "DOZEN" -> "درزن"; "CARTON" -> "كرتونة"; else -> "قطعة" }
                } × ${item.unitPrice.formatMoney()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("${item.totalPrice.formatMoney()} IQD", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
        }
    }
}
