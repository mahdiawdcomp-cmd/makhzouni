package com.inventory.ui.products

import android.Manifest
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
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
import java.io.ByteArrayOutputStream

private fun compressProductImage(context: android.content.Context, uri: Uri): String? {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val maxSide = 900f
    val scale = minOf(1f, maxSide / maxOf(bitmap.width, bitmap.height).toFloat())
    val outBitmap = if (scale < 1f) {
        Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
    } else bitmap
    val out = ByteArrayOutputStream()
    outBitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
    return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

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
                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        listOf(
                            "updated" to "آخر تعديل",
                            "name" to "الاسم",
                            "stockDesc" to "أعلى كمية",
                            "stockAsc" to "أقل كمية",
                            "purchaseDesc" to "سعر الشراء",
                            "saleDesc" to "سعر البيع",
                        ).forEach { (key, label) ->
                            FilterChip(
                                selected = state.sortBy == key,
                                onClick = { viewModel.onSortChange(key) },
                                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                                shape = RoundedCornerShape(8.dp),
                            )
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
                        ProductListItem(product = product, hidePrices = state.hidePrices, onClick = { onOpen(product.id) })
                        HorizontalDivider(modifier = Modifier.padding(start = 72.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductListItem(product: Product, hidePrices: Boolean = false, onClick: () -> Unit) {
    val stockColor = when {
        product.currentStock <= 0            -> AppColor.Red600
        product.currentStock <= product.minStock -> AppColor.Amber600
        else                                  -> AppColor.Green600
    }
    val iconBg  = if (product.isLowStock) AppColor.Red100 else AppColor.Blue100
    val iconClr = if (product.isLowStock) AppColor.Red600 else AppColor.Blue600
    val maxStock = maxOf(product.currentStock, product.minStock * 3, 1)
    val stockProgress = (product.currentStock.toFloat() / maxStock).coerceIn(0f, 1f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(MaterialTheme.colorScheme.surface),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (!product.imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = product.imageUrl,
                    contentDescription = product.name,
                    modifier = Modifier.size(46.dp).clip(RoundedCornerShape(10.dp))
                )
            } else {
                IconAvatar(
                    icon = if (product.isLowStock) Icons.Default.Warning else Icons.Default.Inventory2,
                    bgColor = iconBg, iconColor = iconClr, size = 46.dp, iconSize = 22.dp,
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(product.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (product.category.isNotBlank()) {
                    Text(product.category, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                } else {
                    Text("رقم: ${product.itemNumber}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!hidePrices) {
                    Text(product.salePrice.formatMoney(), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("${product.currentStock}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = stockColor)
                    Text("قطعة", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        // Stock level bar
        LinearProgressIndicator(
            progress = { stockProgress },
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .padding(horizontal = 16.dp),
            color = stockColor,
            trackColor = MaterialTheme.colorScheme.outlineVariant,
        )
        Spacer(Modifier.height(2.dp))
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
    val hidePrices by viewModel.hidePrices.collectAsState()
    val showPurchasePrice by viewModel.showPurchasePrice.collectAsState()
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
            if (!hidePrices) {
            item {
                SectionCard(title = "الأسعار") {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (showPurchasePrice) {
                            PriceBox("سعر الشراء", cur.purchasePrice, AppColor.Amber600, AppColor.Amber50, Modifier.weight(1f))
                        }
                        PriceBox("سعر الجملة", cur.salePrice, AppColor.Green600, AppColor.Green50, if (showPurchasePrice) Modifier.weight(1f) else Modifier.fillMaxWidth())
                    }
                    if (cur.retailPrice > 0.0 && cur.retailPrice != cur.salePrice) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            PriceBox("سعر المفرد", cur.retailPrice, AppColor.Blue600, AppColor.Blue50, Modifier.fillMaxWidth())
                        }
                    }
                }
            }
            } // end if (!hidePrices)

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

            // ── Warehouse stock breakdown ────────────────────────────
            if (cur.warehouseStocks.isNotEmpty()) {
                item {
                    SectionCard(title = "توزيع المخزون بالمخازن") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            cur.warehouseStocks.forEach { ws ->
                                val wsLow = ws.quantityPieces <= (ws.minStock ?: cur.minStock) && ws.quantityPieces > 0
                                val wsOut = ws.quantityPieces <= 0
                                val barColor = when {
                                    wsOut -> AppColor.Red600
                                    wsLow -> AppColor.Amber600
                                    else  -> AppColor.Green600
                                }
                                val pct = if (cur.currentStock > 0) ws.quantityPieces.toFloat() / cur.currentStock else 0f
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                                        .padding(12.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column {
                                            Text(ws.warehouseName, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                                            Text(ws.warehouseCode, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            if (!ws.storageLocation.isNullOrBlank()) {
                                                Text("📍 ${ws.storageLocation}", style = MaterialTheme.typography.labelSmall, color = AppColor.Blue600)
                                            }
                                        }
                                        Text(
                                            "${ws.quantityPieces} ق",
                                            fontWeight = FontWeight.ExtraBold,
                                            style = MaterialTheme.typography.titleMedium,
                                            color = barColor
                                        )
                                    }
                                    Spacer(Modifier.height(6.dp))
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(6.dp)
                                            .clip(RoundedCornerShape(3.dp))
                                            .background(MaterialTheme.colorScheme.surfaceVariant)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth(pct.coerceIn(0f, 1f))
                                                .height(6.dp)
                                                .clip(RoundedCornerShape(3.dp))
                                                .background(barColor)
                                        )
                                    }
                                    Text(
                                        "${(pct * 100).toInt()}% من الإجمالي",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.fillMaxWidth(),
                                        textAlign = androidx.compose.ui.text.style.TextAlign.End
                                    )
                                }
                            }
                        }
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
                                        putExtra(Intent.EXTRA_TEXT, cur.cartonQrCode)
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
    val context = LocalContext.current
    var unitExpanded by remember { mutableStateOf(false) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            compressProductImage(context, uri)?.let { viewModel.update("imageUrl", it) }
        }
    }
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
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (!state.imageUrl.isNullOrBlank()) {
                                AsyncImage(
                                    model = state.imageUrl,
                                    contentDescription = state.name,
                                    modifier = Modifier.size(76.dp).clip(RoundedCornerShape(14.dp)),
                                )
                            } else {
                                IconAvatar(Icons.Default.PhotoCamera, AppColor.Blue100, AppColor.Blue600, size = 76.dp, iconSize = 28.dp)
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("صورة المادة", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                                Text("تُصغّر تلقائياً قبل الحفظ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { imagePicker.launch("image/*") }, shape = RoundedCornerShape(10.dp)) {
                                        Icon(Icons.Default.PhotoCamera, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("اختيار")
                                    }
                                    if (!state.imageUrl.isNullOrBlank()) {
                                        TextButton(onClick = { viewModel.update("imageUrl", "") }) { Text("حذف") }
                                    }
                                }
                            }
                        }
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
                        if (!state.isEditing) {
                            AppTextField(state.openingBalancePcs, { viewModel.update("openingBalancePcs", it) }, "قطع افتتاحية", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                            AppTextField(state.cartonsAvailable, { viewModel.update("cartonsAvailable", it) }, "كارتونات متوفرة", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        }
                        AppTextField(state.pcsPerCarton, { viewModel.update("pcsPerCarton", it) }, "قطع بالكرتونة", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.minStock, { viewModel.update("minStock", it) }, "حد التنبيه", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        if (state.branches.isNotEmpty()) {
                            Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)) {
                                Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Text("توزيع المخزون على المخازن", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                    state.branches.forEach { branch ->
                                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Text(branch.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                            OutlinedTextField(
                                                value = state.warehouseDist[branch.id] ?: "0",
                                                onValueChange = { viewModel.updateWarehouseDist(branch.id, it) },
                                                modifier = Modifier.width(110.dp),
                                                singleLine = true,
                                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                                shape = RoundedCornerShape(8.dp),
                                                suffix = { Text("قطعة", style = MaterialTheme.typography.labelSmall) }
                                            )
                                        }
                                    }
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text("المجموع الكلي", style = MaterialTheme.typography.labelMedium)
                                        Text("${state.distSum} قطعة", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                    }
                                    if (!state.isEditing) {
                                        val matches = state.distSum == state.enteredTotal
                                        Text(
                                            text = if (matches) {
                                                "تم توزيع كامل الكمية (${state.enteredTotal} قطعة)"
                                            } else if (state.distSum > state.enteredTotal) {
                                                "التوزيع أكثر من الكمية بـ ${state.distSum - state.enteredTotal} قطعة"
                                            } else {
                                                "المتبقي للتوزيع: ${state.enteredTotal - state.distSum} قطعة"
                                            },
                                            color = if (matches) AppColor.Green600 else AppColor.Red600,
                                            style = MaterialTheme.typography.bodySmall,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                            }
                        } else if (state.totalQuantity > 0) {
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
                        AppTextField(state.salePrice, { viewModel.update("salePrice", it) }, "سعر البيع (جملة)", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        AppTextField(state.retailPrice, { viewModel.update("retailPrice", it) }, "سعر المفرد (اختياري)", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
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
    onAddToInvoice: (String, String) -> Unit,
    autoAddToInvoice: Boolean = false,
) {
    val state by viewModel.state.collectAsState()
    var hasPermission by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasPermission = it }
    LaunchedEffect(Unit) { launcher.launch(Manifest.permission.CAMERA) }
    LaunchedEffect(state, autoAddToInvoice) {
        val found = state as? QrScannerState.Found
        if (autoAddToInvoice && found != null) {
            onAddToInvoice(found.product.id, found.unit)
        }
    }

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
                                Button(onClick = { onAddToInvoice(current.product.id, current.unit) }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
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
internal fun ScannerOverlay() {
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
internal fun CameraPreview(onQr: (String) -> Unit) {
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
