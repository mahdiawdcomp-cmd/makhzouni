package com.inventory.ui.invoices

import android.Manifest
import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.inventory.domain.model.Customer
import com.inventory.ui.common.AppColor
import com.inventory.ui.common.formatMoney
import com.inventory.ui.products.CameraPreview
import com.inventory.ui.products.QrScannerState
import com.inventory.ui.products.QrScannerViewModel
import com.inventory.ui.products.ScannerOverlay
import kotlinx.coroutines.delay

@Composable
fun QuickScanInvoiceScreen(
    invoiceVm: InvoiceCreateViewModel = hiltViewModel(),
    scanVm: QrScannerViewModel = hiltViewModel(),
    onBack: () -> Unit,
    onInvoiceSaved: (String) -> Unit,
) {
    val context = LocalContext.current
    val state by invoiceVm.state.collectAsState()
    val scanState by scanVm.state.collectAsState()
    var hasPermission by remember { mutableStateOf(false) }
    var showCustomerPicker by remember { mutableStateOf(false) }

    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { hasPermission = it }

    LaunchedEffect(Unit) { permLauncher.launch(Manifest.permission.CAMERA) }

    // Auto-select walk-in customer when list loads
    LaunchedEffect(state.customers) {
        if (state.selectedCustomer == null && state.customers.isNotEmpty()) {
            val walkIn = state.customers.firstOrNull {
                it.name.contains("عام", ignoreCase = true) ||
                it.name.contains("نقدي", ignoreCase = true)
            } ?: state.customers.first()
            invoiceVm.selectCustomer(walkIn)
        }
    }

    // Auto-confirm shop-stock alert: pick warehouse with most quantity
    LaunchedEffect(state.shopStockAlertProduct) {
        val p = state.shopStockAlertProduct ?: return@LaunchedEffect
        val wh = p.warehouseStocks.filter { it.quantityPieces > 0 }.maxByOrNull { it.quantityPieces }
        if (wh?.warehouseId != null) invoiceVm.confirmShopStockAlert(wh.warehouseId)
        else invoiceVm.dismissShopStockAlert()
    }

    // Navigate to detail when invoice is saved
    LaunchedEffect(state.savedInvoiceId) {
        state.savedInvoiceId?.let { onInvoiceSaved(it) }
    }

    // Handle scan result: add product then auto-reset camera
    LaunchedEffect(scanState) {
        when (val s = scanState) {
            is QrScannerState.Found -> {
                invoiceVm.quickScanAdd(s.product)
                vibrate(context)
                delay(1200)
                scanVm.scanAgain()
            }
            is QrScannerState.NotFound -> {
                delay(1000)
                scanVm.scanAgain()
            }
            else -> Unit
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {

        // ── Top bar ──────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "رجوع")
            }
            Text(
                "مسح سريع",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.weight(1f))
            FilterChip(
                selected = state.selectedCustomer != null,
                onClick = { showCustomerPicker = true },
                label = {
                    Text(
                        state.selectedCustomer?.name ?: "اختر زبون",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 110.dp),
                    )
                },
                leadingIcon = { Icon(Icons.Default.Person, null, Modifier.size(16.dp)) },
            )
            Spacer(Modifier.width(8.dp))
        }

        // ── Camera (top 42%) ──────────────────────────────────────
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.42f)
                .background(Color.Black),
        ) {
            if (hasPermission) {
                CameraPreview(onQr = scanVm::onQrDetected)
                ScannerOverlay()
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.CameraAlt, null, tint = Color.White, modifier = Modifier.size(52.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("نحتاج صلاحية الكاميرا", color = Color.White, style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { permLauncher.launch(Manifest.permission.CAMERA) }) {
                            Text("منح الصلاحية")
                        }
                    }
                }
            }

            // Status chip at bottom of camera
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp)) {
                when (val s = scanState) {
                    is QrScannerState.Loading  -> ScanStatusChip("جاري البحث...", Color(0xFF0EA5E9), Icons.Default.Refresh)
                    is QrScannerState.Found    -> ScanStatusChip("✓  ${s.product.name}", Color(0xFF22C55E), Icons.Default.CheckCircle)
                    is QrScannerState.NotFound -> ScanStatusChip("غير موجود في المخزن", Color(0xFFEF4444), Icons.Default.ErrorOutline)
                    else -> Unit
                }
            }
        }

        // ── Invoice items (bottom 58%) ────────────────────────────
        Column(Modifier.fillMaxWidth().weight(0.58f)) {

            // Summary strip
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ShoppingCart,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${state.items.size} صنف",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${state.total.formatMoney()} د.ع",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            // Empty state
            if (state.items.isEmpty()) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.QrCodeScanner,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "وجّه الكاميرا نحو الباركود",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f),
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(state.items, key = { it.lineId }) { item ->
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.surface,
                            shadowElevation = 1.dp,
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.product.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        "${item.unitPrice.formatMoney()} د.ع / قطعة",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                // Qty controls
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(
                                        onClick = {
                                            if (item.quantity > 1) invoiceVm.updateItem(item.lineId, quantity = item.quantity - 1)
                                            else invoiceVm.removeItem(item.lineId)
                                        },
                                        modifier = Modifier.size(32.dp),
                                    ) {
                                        Icon(
                                            if (item.quantity > 1) Icons.Default.Remove else Icons.Default.DeleteOutline,
                                            contentDescription = null,
                                            modifier = Modifier.size(16.dp),
                                            tint = if (item.quantity > 1) MaterialTheme.colorScheme.onSurface
                                                   else MaterialTheme.colorScheme.error,
                                        )
                                    }
                                    Text(
                                        "${item.quantity}",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.ExtraBold,
                                        modifier = Modifier.widthIn(min = 28.dp),
                                        textAlign = TextAlign.Center,
                                    )
                                    IconButton(
                                        onClick = { invoiceVm.updateItem(item.lineId, quantity = item.quantity + 1) },
                                        modifier = Modifier.size(32.dp),
                                    ) {
                                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                                Text(
                                    item.totalPrice.formatMoney(),
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.widthIn(min = 54.dp),
                                    textAlign = TextAlign.End,
                                )
                            }
                        }
                    }
                }
            }

            state.error?.let { err ->
                Text(
                    err,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                )
            }

            // Save button
            Button(
                onClick = invoiceVm::save,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp)
                    .height(52.dp),
                enabled = state.items.isNotEmpty() && !state.isSaving,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
            ) {
                if (state.isSaving) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("حفظ الفاتورة", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    // Customer picker dialog
    if (showCustomerPicker) {
        QuickScanCustomerDialog(
            customers = state.customers,
            onSelect = { customer ->
                invoiceVm.selectCustomer(customer)
                showCustomerPicker = false
            },
            onDismiss = { showCustomerPicker = false },
        )
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

@Composable
private fun ScanStatusChip(text: String, color: Color, icon: ImageVector) {
    Surface(shape = RoundedCornerShape(20.dp), color = color.copy(alpha = 0.92f)) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
            Text(text, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1)
        }
    }
}

@Composable
private fun QuickScanCustomerDialog(
    customers: List<Customer>,
    onSelect: (Customer) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(query, customers) {
        customers.filter {
            query.isBlank() || it.name.contains(query, ignoreCase = true) || it.phone.contains(query)
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("اختر الزبون") },
        text = {
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("بحث بالاسم أو الرقم...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.Search, null) },
                )
                Spacer(Modifier.height(8.dp))
                LazyColumn(modifier = Modifier.heightIn(max = 320.dp)) {
                    items(filtered) { customer ->
                        ListItem(
                            headlineContent = { Text(customer.name, fontWeight = FontWeight.SemiBold) },
                            supportingContent = { if (customer.phone.isNotBlank()) Text(customer.phone) },
                            modifier = Modifier.clickable { onSelect(customer) },
                        )
                        HorizontalDivider()
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

private fun vibrate(context: Context) {
    try {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            (context.getSystemService(VibratorManager::class.java))
                ?.defaultVibrator
                ?.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.vibrate(80)
        }
    } catch (_: Exception) { }
}
