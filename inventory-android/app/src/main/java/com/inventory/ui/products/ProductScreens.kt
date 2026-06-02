package com.inventory.ui.products

import android.Manifest
import android.content.Intent
import android.graphics.ImageFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.inventory.domain.model.Product
import com.inventory.ui.common.*
import com.inventory.ui.theme.AppColor
import java.util.concurrent.Executors

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PRODUCT LIST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductListScreen(
    viewModel: ProductListViewModel,
    onAdd: () -> Unit,
    onScan: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()

    AppScreen(
        title = "المخزن",
        fab = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SmallFloatingActionButton(
                    onClick = onScan,
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                ) { Icon(Icons.Default.QrCodeScanner, null) }
                ExtendedFloatingActionButton(
                    onClick = onAdd,
                    icon = { Icon(Icons.Default.Add, null) },
                    text = { Text("إضافة صنف", fontWeight = FontWeight.SemiBold) },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = Color.White,
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            // ── Search + categories ──────────────────────────────────
            Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    AppSearchBar(state.query, viewModel::onQueryChange, "بحث بالاسم أو رقم الآيتم")
                    if (state.categories.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(
                                selected = state.category == null,
                                onClick = { viewModel.onCategoryChange(null) },
                                label = { Text("الكل") },
                                shape = RoundedCornerShape(8.dp),
                            )
                            state.categories.take(4).forEach { cat ->
                                FilterChip(
                                    selected = state.category == cat,
                                    onClick = { viewModel.onCategoryChange(cat) },
                                    label = { Text(cat, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                    shape = RoundedCornerShape(8.dp),
                                )
                            }
                        }
                    }
                }
            }

            // Stats bar
            val lowStockCount = state.filteredProducts.count { it.isLowStock }
            if (lowStockCount > 0) {
                Surface(color = AppColor.Red50) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Warning, null, tint = AppColor.Red600, modifier = Modifier.size(16.dp))
                        Text("$lowStockCount ${if (lowStockCount == 1) "صنف" else "أصناف"} في مخزون منخفض", style = MaterialTheme.typography.labelMedium, color = AppColor.Red600)
                    }
                }
            }

            // ── List ─────────────────────────────────────────────────
            if (state.filteredProducts.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(icon = Icons.Default.Inventory2, title = "لا توجد منتجات", subtitle = "اضغط + لإضافة صنف جديد")
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 88.dp),
                ) {
                    items(state.filteredProducts, key = { it.id }) { product ->
                        ProductListItem(product = product, onClick = { onOpen(product.id) })
                        HorizontalDivider(modifier = Modifier.padding(start = 72.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductListItem(product: Product, onClick: () -> Unit) {
    val iconBg  = if (product.isLowStock) AppColor.Red100   else AppColor.Blue100
    val iconClr = if (product.isLowStock) AppColor.Red600   else AppColor.Blue600

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconAvatar(
            icon = if (product.isLowStock) Icons.Default.Warning else Icons.Default.Inventory2,
            bgColor = iconBg, iconColor = iconClr, size = 46.dp, iconSize = 22.dp,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(product.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("رقم: ${product.itemNumber}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("متوفر: ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                val stockColor = if (product.currentStock <= product.minStock) AppColor.Red600 else AppColor.Green600
                Text("${product.currentStock} قطعة", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = stockColor, fontSize = 11.sp)
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${product.salePrice.formatMoney()}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, fontSize = 14.sp)
            if (product.isLowStock) StatusBadge("منخفض", StatusType.ERROR) else StatusBadge("متوفر", StatusType.SUCCESS)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PRODUCT DETAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductDetailScreen(
    viewModel: ProductDetailViewModel,
    onMovement: (String) -> Unit,
    onAddToInvoice: (String) -> Unit,
    onEdit: (String) -> Unit,
    onBack: () -> Unit,
) {
    val product by viewModel.product.collectAsState()
    val apiBase by viewModel.apiBaseUrl.collectAsState()
    val context = LocalContext.current
    val cur = product
    var showDeleteDialog by remember { mutableStateOf(false) }

    if (cur == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    // Delete confirmation dialog
    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteDialog = false },
            icon = { Icon(Icons.Default.DeleteForever, null, tint = AppColor.Red600) },
            title = { Text("حذف المادة") },
            text = { Text("هل تريد حذف \"${cur.name}\"؟ هذا الإجراء لا يمكن التراجع عنه.") },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteDialog = false
                        viewModel.deleteProduct()
                        onBack()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600)
                ) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { showDeleteDialog = false }) { Text("إلغاء") } }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(cur.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "رجوع") } },
                actions = {
                    IconButton(onClick = { onEdit(cur.id) }) {
                        Icon(Icons.Default.Edit, "تعديل", tint = MaterialTheme.colorScheme.primary)
                    }
                    IconButton(onClick = { showDeleteDialog = true }) {
                        Icon(Icons.Default.DeleteOutline, "حذف", tint = AppColor.Red600)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── Hero stock card ──────────────────────────────────────
            item {
                val stockColor = if (cur.isLowStock) AppColor.Red600 else AppColor.Green600
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.horizontalGradient(if (cur.isLowStock) listOf(AppColor.Red600, Color(0xFFEF4444)) else listOf(AppColor.Green600, Color(0xFF10B981))),
                            RoundedCornerShape(16.dp)
                        )
                        .padding(20.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("المخزون الحالي", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelMedium)
                            Text("${cur.currentStock} قطعة", color = Color.White, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold)
                            Text("${cur.cartonsAvailable} كرتونة · ${cur.openingBalancePcs} قطعة", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
                        }
                        if (cur.isLowStock) {
                            Box(modifier = Modifier.background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                                Text("تحذير: مخزون منخفض", color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            // ── Prices ──────────────────────────────────────────────
            item {
                SectionCard(title = "الأسعار") {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PriceBox("سعر الشراء", cur.purchasePrice, AppColor.Amber600, AppColor.Amber50, Modifier.weight(1f))
                        PriceBox("سعر البيع",  cur.salePrice,    AppColor.Green600,  AppColor.Green50,  Modifier.weight(1f))
                    }
                }
            }

            // ── Info ─────────────────────────────────────────────────
            item {
                SectionCard(title = "معلومات الصنف") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryRow("رقم الآيتم",      cur.itemNumber)
                        SummaryRow("الفئة",            cur.category.ifBlank { "—" })
                        SummaryRow("قطع بالكرتونة",    "${cur.pcsPerCarton} قطعة")
                        SummaryRow("حد التنبيه",        "${cur.minStock} قطعة")
                    }
                }
            }

            // ── QR Code — قطعة وكرتون ────────────────────────────────
            item {
                SectionCard(title = "رمز QR") {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Piece QR
                        Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("QR القطعة", style = MaterialTheme.typography.labelMedium, color = AppColor.Blue600, fontWeight = FontWeight.SemiBold)
                            AsyncImage(
                                model = "$apiBase/products/${cur.id}/qr?type=piece",
                                contentDescription = "QR قطعة",
                                modifier = Modifier.size(120.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                            OutlinedButton(
                                onClick = {
                                    val intent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, cur.qrCode)
                                    }
                                    context.startActivity(Intent.createChooser(intent, "شارك QR القطعة"))
                                },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.Share, null, Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("مشاركة", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                        // Carton QR
                        Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("QR الكرتونة", style = MaterialTheme.typography.labelMedium, color = AppColor.Amber600, fontWeight = FontWeight.SemiBold)
                            AsyncImage(
                                model = "$apiBase/products/${cur.id}/qr?type=carton",
                                contentDescription = "QR كرتون",
                                modifier = Modifier.size(120.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                            OutlinedButton(
                                onClick = {
                                    val intent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, cur.qrCode + "-CTN")
                                    }
                                    context.startActivity(Intent.createChooser(intent, "شارك QR الكرتونة"))
                                },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.Share, null, Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("مشاركة", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }

            // ── Actions ──────────────────────────────────────────────
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilledTonalButton(onClick = { onMovement(cur.id) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
                        Icon(Icons.Default.Timeline, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("حركة المادة", style = MaterialTheme.typography.labelLarge)
                    }
                    Button(onClick = { onAddToInvoice(cur.id) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
                        Icon(Icons.Default.AddShoppingCart, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("أضف لفاتورة", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun PriceBox(label: String, price: Double, textColor: Color, bgColor: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.clip(RoundedCornerShape(10.dp)).background(bgColor).padding(14.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = textColor.copy(alpha = 0.7f))
            Text("${price.formatMoney()} IQD", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold, color = textColor)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PRODUCT FORM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductFormScreen(viewModel: ProductFormViewModel, onDone: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var unitExpanded by remember { mutableStateOf(false) }
    LaunchedEffect(state.saved) { if (state.saved) onDone() }

    AppScreen(title = state.actionText, onBack = onDone) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard(title = "معلومات الصنف") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(state.name, { viewModel.update("name", it) }, "اسم الصنف", required = true)
                        AppTextField(state.itemNumber, { viewModel.update("itemNumber", it) }, "رقم الآيتم")
                        AppTextField(state.category, { viewModel.update("category", it) }, "الفئة")
                        AppTextField(state.qrCode, { viewModel.update("qrCode", it) }, "QR Code")
                    }
                }
            }
            item {
                SectionCard(title = "المخزون") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(state.openingBalancePcs, { viewModel.update("openingBalancePcs", it) }, "قطع افتتاحية", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.cartonsAvailable, { viewModel.update("cartonsAvailable", it) }, "كارتونات متوفرة", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.pcsPerCarton, { viewModel.update("pcsPerCarton", it) }, "قطع بالكرتونة", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.minStock, { viewModel.update("minStock", it) }, "حد التنبيه", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        if (state.totalQuantity > 0) {
                            Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                                Row(modifier = Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("الكمية الإجمالية", style = MaterialTheme.typography.labelMedium)
                                    Text("${state.totalQuantity} قطعة", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)

                                }
                            }
                        }
                    }
                }
            }
            item {
                SectionCard(title = "الأسعار") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(state.purchasePrice, { viewModel.update("purchasePrice", it) }, "سعر الشراء", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.salePrice, { viewModel.update("salePrice", it) }, "سعر البيع", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    }
                }
            }
            if (state.error != null) {
                item {
                    Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Red50) {
                        Text(state.error!!, color = AppColor.Red600, modifier = Modifier.fillMaxWidth().padding(12.dp), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item {
                Button(onClick = viewModel::save, modifier = Modifier.fillMaxWidth().height(52.dp), enabled = !state.isSaving, shape = RoundedCornerShape(12.dp)) {
                    if (state.isSaving) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    else { Icon(Icons.Default.Check, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(state.actionText, fontWeight = FontWeight.SemiBold) }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PRODUCT MOVEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun ProductMovementScreen(viewModel: ProductMovementViewModel, onOpenInvoice: (String) -> Unit) {
    val state by viewModel.state.collectAsState()

    AppScreen(title = "حركة الصنف") { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background)) {
            // Filter bar
            Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    OutlinedTextField(state.from, viewModel::setFrom, Modifier.weight(1f), label = { Text("من") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    OutlinedTextField(state.to, viewModel::setTo, Modifier.weight(1f), label = { Text("إلى") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    FilledTonalButton(onClick = viewModel::refresh, shape = RoundedCornerShape(10.dp)) { Text("فلتر") }
                }
            }

            if (state.rows.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(icon = Icons.Default.Timeline, title = "لا توجد حركات", subtitle = "جرّب تغيير الفترة الزمنية")
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    // Header
                    item {
                        Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                                Text("التاريخ",    Modifier.weight(1.4f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("الزبون",     Modifier.weight(1.6f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("الكمية",     Modifier.weight(0.9f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("الفاتورة",   Modifier.weight(1.2f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                    items(state.rows) { row ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onOpenInvoice(row.invoiceId) }.background(MaterialTheme.colorScheme.surface).padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(row.date.toDisplayDate(),   Modifier.weight(1.4f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                            Text(row.customerName,           Modifier.weight(1.6f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${row.quantity}",          Modifier.weight(0.9f), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = AppColor.Blue600)
                            Text(row.invoiceNumber,          Modifier.weight(1.2f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, fontSize = 11.sp)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                    }
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  QR SCANNER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun QrScannerScreen(
    viewModel: QrScannerViewModel,
    onOpenProduct: (String) -> Unit,
    onAddProduct: (String) -> Unit,
    onAddToInvoice: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var hasPermission by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasPermission = it }
    LaunchedEffect(Unit) { launcher.launch(Manifest.permission.CAMERA) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (hasPermission) {
            CameraPreview(onQr = viewModel::onQrDetected)
            ScannerOverlay()
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Icon(Icons.Default.CameraAlt, null, tint = Color.White, modifier = Modifier.size(48.dp))
                    Text("نحتاج صلاحية الكاميرا", color = Color.White, style = MaterialTheme.typography.titleMedium)
                }
            }
        }

        // Result overlay at the bottom
        Box(modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp)) {
            when (val current = state) {
                QrScannerState.Scanning -> Unit
                is QrScannerState.Loading -> {
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 8.dp) {
                        Row(modifier = Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text("جاري البحث عن المنتج...", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                is QrScannerState.Found -> {
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 8.dp) {
                        Column(modifier = Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                IconAvatar(Icons.Default.CheckCircle, AppColor.Green100, AppColor.Green600, size = 40.dp)
                                Column {
                                    Text("تم العثور على الصنف", style = MaterialTheme.typography.labelMedium, color = AppColor.Green600)
                                    Text(current.product.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                    Text("متوفر: ${current.product.currentStock} قطعة", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { onOpenProduct(current.product.id) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) { Text("التفاصيل") }
                                Button(onClick = { onAddToInvoice(current.product.id) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
                                    Icon(Icons.Default.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("للفاتورة")
                                }
                            }
                            TextButton(onClick = viewModel::scanAgain, modifier = Modifier.fillMaxWidth()) { Text("مسح مجدداً") }
                        }
                    }
                }
                is QrScannerState.NotFound -> {
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 8.dp) {
                        Column(modifier = Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                IconAvatar(Icons.Default.Error, AppColor.Amber100, AppColor.Amber600, size = 40.dp)
                                Column {
                                    Text("صنف غير مسجل", style = MaterialTheme.typography.labelMedium, color = AppColor.Amber600)
                                    Text(current.code, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = viewModel::scanAgain, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) { Text("مسح مجدداً") }
                                Button(onClick = { onAddProduct(current.code) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
                                    Icon(Icons.Default.Add, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("إضافة")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScannerOverlay() {
    val transition = rememberInfiniteTransition(label = "scan")
    val scanY by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Reverse),
        label = "scan-line"
    )

    Canvas(Modifier.fillMaxSize()) {
        val frameSize = minOf(size.width, size.height) * 0.65f
        val left = (size.width - frameSize) / 2f
        val top  = (size.height - frameSize) / 2.3f

        // Dim overlay
        drawRect(Color.Black.copy(alpha = 0.5f))

        // Clear frame area
        drawRect(Color.Transparent, Offset(left, top), androidx.compose.ui.geometry.Size(frameSize, frameSize))

        // Corner brackets
        val cornerLen = 36.dp.toPx()
        val cornerW   = 4.dp.toPx()
        val cornColor = Color(0xFF3B82F6)
        val corners = listOf(
            Offset(left, top) to Pair(Offset(left + cornerLen, top), Offset(left, top + cornerLen)),
            Offset(left + frameSize, top) to Pair(Offset(left + frameSize - cornerLen, top), Offset(left + frameSize, top + cornerLen)),
            Offset(left, top + frameSize) to Pair(Offset(left + cornerLen, top + frameSize), Offset(left, top + frameSize - cornerLen)),
            Offset(left + frameSize, top + frameSize) to Pair(Offset(left + frameSize - cornerLen, top + frameSize), Offset(left + frameSize, top + frameSize - cornerLen)),
        )
        corners.forEach { (origin, lines) ->
            drawLine(cornColor, origin, lines.first,  cornerW, StrokeCap.Round)
            drawLine(cornColor, origin, lines.second, cornerW, StrokeCap.Round)
        }

        // Scan line
        val scanLineY = top + frameSize * scanY
        drawLine(
            Brush.horizontalGradient(listOf(Color.Transparent, Color(0xFF60A5FA), Color.Transparent), left, left + frameSize),
            Offset(left + 8.dp.toPx(), scanLineY),
            Offset(left + frameSize - 8.dp.toPx(), scanLineY),
            3.dp.toPx(), StrokeCap.Round
        )
    }
}

@Composable
private fun CameraPreview(onQr: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build().also {
                        it.setAnalyzer(executor) { proxy -> processImageProxy(proxy, onQr) }
                    }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }, androidx.core.content.ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}

private fun processImageProxy(imageProxy: ImageProxy, onQr: (String) -> Unit) {
    val media = imageProxy.image
    if (media == null || imageProxy.format != ImageFormat.YUV_420_888) { imageProxy.close(); return }
    val image = InputImage.fromMediaImage(media, imageProxy.imageInfo.rotationDegrees)
    BarcodeScanning.getClient().process(image)
        .addOnSuccessListener { codes -> codes.firstOrNull()?.rawValue?.let(onQr) }
        .addOnCompleteListener { imageProxy.close() }
}
