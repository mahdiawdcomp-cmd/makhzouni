package com.inventory.ui.operations

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AssignmentReturn
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RequestQuote
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warehouse
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.inventory.data.remote.dto.AuditLogDto
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.CouponDto
import com.inventory.data.remote.dto.QuotationDto
import com.inventory.data.remote.dto.StockLossDto
import com.inventory.data.remote.dto.TransferDto
import com.inventory.domain.model.Product
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.EmptyState
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.common.SummaryRow
import com.inventory.ui.common.TextAvatar
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor

private data class HubItem(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val color: Color,
    val onClick: () -> Unit,
)

@Composable
fun OperationsHubScreen(
    onBack: () -> Unit,
    onPos: () -> Unit,
    onReturns: () -> Unit,
    onQuotations: () -> Unit,
    onTransfers: () -> Unit,
    onBranches: () -> Unit,
    onCoupons: () -> Unit,
    onAudit: () -> Unit,
    onVouchers: () -> Unit = {},
    onOcrInvoice: () -> Unit = {},
    onRetailOrders: () -> Unit = {},
    onLosses: () -> Unit = {},
    isAdmin: Boolean = true,
    permissions: List<String> = emptyList(),
) {
    val canInvoice = isAdmin || permissions.contains("MANAGE_INVOICES")
    val canVouchers = isAdmin || permissions.contains("MANAGE_VOUCHERS")
    val canSettings = isAdmin || permissions.contains("MANAGE_SETTINGS")

    val tiles = buildList {
        if (canInvoice) {
            add(HubItem("POS سريع", "كاشير مختصر مع باركود", Icons.Default.PointOfSale, AppColor.Green600, onPos))
            add(HubItem("مرتجع مبيعات", "إرجاع كامل أو جزئي", Icons.Default.AssignmentReturn, AppColor.Red600, onReturns))
            add(HubItem("عروض الأسعار", "عرض يتحول إلى فاتورة", Icons.Default.RequestQuote, AppColor.Blue600, onQuotations))
            add(HubItem("فاتورة شراء OCR", "قراءة فاتورة من صورة", Icons.Default.DocumentScanner, Color(0xFF7C3AED), onOcrInvoice))
            add(HubItem("طلبات المفرد", "طلبات الكتالوج والتجهيز", Icons.Default.Storefront, Color(0xFF6366F1), onRetailOrders))
        }
        if (canVouchers) {
            add(HubItem("السندات", "قبض، دفع، مصاريف", Icons.Default.ConfirmationNumber, AppColor.Purple600, onVouchers))
        }
        if (canSettings) {
            add(HubItem("التحويلات", "نقل مواد بين المخازن", Icons.Default.SwapHoriz, AppColor.Sky500, onTransfers))
            add(HubItem("التلف والخسائر", "تسجيل وإلغاء الهالك", Icons.Default.BrokenImage, AppColor.Red600, onLosses))
            add(HubItem("المخازن", "المحل والمخازن", Icons.Default.Warehouse, AppColor.Amber600, onBranches))
            add(HubItem("الكوبونات", "خصومات وعروض", Icons.Default.LocalOffer, Color(0xFF0F766E), onCoupons))
            add(HubItem("سجل التدقيق", "من عدل ومتى", Icons.Default.History, AppColor.Gray700, onAudit))
        }
    }

    AppScreen(title = "العمليات", onBack = onBack) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            gridItems(tiles) { tile -> HubTile(tile) }
        }
    }
}

@Composable
private fun HubTile(tile: HubItem) {
    Card(
        onClick = tile.onClick,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, tile.color.copy(alpha = 0.18f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Box(Modifier.size(44.dp).background(tile.color.copy(alpha = 0.12f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(tile.icon, contentDescription = null, tint = tile.color)
            }
            Text(tile.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text(tile.subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SalesOperationScreen(
    mode: String,
    title: String,
    viewModel: SalesOperationViewModel,
    onBack: () -> Unit,
    onScan: () -> Unit = {}
) {
    val state by viewModel.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val productFocus = remember { FocusRequester() }
    val amountFocus = remember { FocusRequester() }

    LaunchedEffect(mode) { viewModel.setMode(mode) }
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    AppScreen(
        title = title,
        onBack = onBack,
        actions = { IconButton(onClick = onScan) { Icon(Icons.Default.QrCodeScanner, "مسح باركود") } },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { PosHero(mode, state.total, state.lines.size) }

            item {
                SectionCard(title = "الزبون", containerColor = MaterialTheme.colorScheme.primaryContainer) {
                    if (state.selectedCustomer == null) {
                        OutlinedTextField(
                            value = state.customerQuery,
                            onValueChange = viewModel::setCustomerQuery,
                            label = { Text("بحث باسم الزبون أو الرقم") },
                            leadingIcon = { Icon(Icons.Default.Person, null) },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = {
                                state.customerSuggestions.firstOrNull()?.let {
                                    viewModel.selectCustomer(it)
                                    productFocus.requestFocus()
                                }
                            }),
                            shape = RoundedCornerShape(10.dp)
                        )
                        state.customerSuggestions.forEach {
                            SuggestionRow(
                                title = it.name,
                                subtitle = "${it.phone} | رصيد ${it.currentBalance.formatMoney()}",
                                color = AppColor.Blue600
                            ) {
                                viewModel.selectCustomer(it)
                                productFocus.requestFocus()
                            }
                        }
                    } else {
                        val customer = state.selectedCustomer!!
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            TextAvatar(customer.name, AppColor.Blue600)
                            Column(Modifier.weight(1f)) {
                                Text(customer.name, fontWeight = FontWeight.Bold)
                                Text(customer.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            TextButton(onClick = { viewModel.setCustomerQuery("") }) { Text("تغيير") }
                        }
                    }
                }
            }

            item {
                SectionCard(title = "إضافة مادة", containerColor = MaterialTheme.colorScheme.tertiaryContainer) {
                    OutlinedTextField(
                        value = state.productQuery,
                        onValueChange = viewModel::setProductQuery,
                        label = { Text("بحث بالاسم أو الباركود") },
                        modifier = Modifier.fillMaxWidth().focusRequester(productFocus),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = {
                            state.productSuggestions.firstOrNull()?.let {
                                viewModel.addProduct(it)
                            }
                        }),
                        shape = RoundedCornerShape(10.dp)
                    )
                    state.productSuggestions.forEach {
                        SuggestionRow(
                            title = it.name,
                            subtitle = "${it.itemNumber} | مخزون ${it.currentStock} | سعر ${it.salePrice.formatMoney()}",
                            color = AppColor.Green600
                        ) {
                            viewModel.addProduct(it)
                        }
                    }
                }
            }

            item {
                SectionCard(title = "المواد", containerColor = MaterialTheme.colorScheme.surface) {
                    if (state.lines.isEmpty()) {
                        EmptyState(Icons.Default.Book, "لا توجد مواد", "ابحث عن مادة أو امسح الباركود حتى تضيفها")
                    } else {
                        state.lines.forEachIndexed { index, line ->
                            LineEditor(
                                index = index,
                                line = line,
                                onQty = { viewModel.updateLine(index, quantity = it) },
                                onPrice = { viewModel.updateLine(index, unitPrice = it) },
                                onUnit = { viewModel.updateLine(index, unit = it) },
                                onRemove = { viewModel.removeLine(index) }
                            )
                            if (index != state.lines.lastIndex) HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        }
                    }
                }
            }

            item {
                SectionCard(title = "المال", containerColor = MaterialTheme.colorScheme.secondaryContainer) {
                    if (mode != "RETURN" && mode != "QUOTATION") {
                        OutlinedTextField(
                            value = state.paid,
                            onValueChange = viewModel::setPaid,
                            label = { Text("المبلغ الواصل") },
                            suffix = { Text("IQD") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth().focusRequester(amountFocus),
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp)
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    if (mode == "QUOTATION") {
                        OutlinedTextField(
                            value = state.discount,
                            onValueChange = viewModel::setDiscount,
                            label = { Text("الخصم") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp)
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.notes,
                            onValueChange = viewModel::setNotes,
                            label = { Text("ملاحظات") },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp)
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    SummaryRow("مجموع المواد", "${state.subtotal.formatMoney()} IQD")
                    if (state.discountAmount > 0) SummaryRow("الخصم", "-${state.discountAmount.formatMoney()} IQD", valueColor = AppColor.Red600)
                    SummaryRow("الإجمالي", "${state.total.formatMoney()} IQD", bold = true)
                    if (mode == "POS") {
                        SummaryRow("الواصل", "${state.paidAmount.formatMoney()} IQD", valueColor = AppColor.Green600)
                        SummaryRow("الباقي", "${state.remaining.formatMoney()} IQD", valueColor = if (state.remaining > 0) AppColor.Red600 else AppColor.Green600, bold = true)
                        if (state.change > 0) SummaryRow("الراجع للزبون", "${state.change.formatMoney()} IQD", valueColor = AppColor.Blue600, bold = true)
                    }
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = viewModel::save,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        enabled = state.canSave,
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.CheckCircle, null)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            when (mode) {
                                "QUOTATION" -> "حفظ عرض السعر"
                                "RETURN" -> "حفظ المرتجع"
                                else -> "حفظ فاتورة POS"
                            },
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PosHero(mode: String, total: Double, count: Int) {
    val (label, color) = when (mode) {
        "RETURN" -> "مرتجع مبيعات" to AppColor.Red600
        "QUOTATION" -> "عرض سعر" to AppColor.Blue600
        else -> "POS سريع" to AppColor.Green600
    }
    Surface(shape = RoundedCornerShape(16.dp), color = color) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(label, color = Color.White.copy(alpha = 0.82f), style = MaterialTheme.typography.labelMedium)
                Text("$count مادة", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Text("${total.formatMoney()} IQD", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
private fun SuggestionRow(title: String, subtitle: String, color: Color, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(34.dp).background(color.copy(alpha = 0.12f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
            Text(title.take(1), color = color, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LineEditor(
    index: Int,
    line: DraftLine,
    onQty: (Int) -> Unit,
    onPrice: (Double) -> Unit,
    onUnit: (String) -> Unit,
    onRemove: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(line.product.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("المخزون ${line.product.currentStock} | شراء ${line.product.purchasePrice.formatMoney()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onRemove) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallNumberField("عدد", line.quantity.toString(), { onQty(it.toIntOrNull() ?: 0) }, Modifier.weight(0.9f))
            SmallNumberField("سعر", line.unitPrice.cleanAmount(), { onPrice(it.toDoubleOrNull() ?: 0.0) }, Modifier.weight(1.1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كارتون").forEach { (key, label) ->
                FilterChip(selected = line.unit == key, onClick = { onUnit(key) }, label = { Text(label) })
            }
        }
        SummaryRow("سطر ${index + 1}", "${line.total.formatMoney()} IQD", bold = true)
    }
}

@Composable
private fun SmallNumberField(label: String, value: String, onValue: (String) -> Unit, modifier: Modifier) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValue(it.filter { ch -> ch.isDigit() || ch == '.' }) },
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier,
        shape = RoundedCornerShape(10.dp)
    )
}

@Composable
fun BranchesScreen(
    viewModel: AdminOperationsViewModel,
    onBack: () -> Unit,
    onOpenWarehouse: (String) -> Unit
) {
    val state by viewModel.state.collectAsState()
    var showAdd by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.refreshBranches() }
    AdminListScreen("المخازن", onBack, viewModel::refreshBranches, "مخزن جديد", { showAdd = true }) {
        when {
            state.loading -> item {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            state.branches.isEmpty() -> item {
                EmptyState(
                    Icons.Default.Warehouse,
                    "لا توجد مخازن",
                    state.message ?: "أضف أول مخزن للبدء"
                )
            }
            else -> items(state.branches, key = { it.id }) { branch ->
                BranchCard(branch, onClick = { onOpenWarehouse(branch.id) })
            }
        }
    }
    if (showAdd) BranchDialog(onDismiss = { showAdd = false }) { name, code, phone, address ->
        showAdd = false
        viewModel.createBranch(name, code, phone, address)
    }
}

@Composable
fun WarehouseDetailsScreen(
    viewModel: WarehouseDetailsViewModel,
    onBack: () -> Unit,
    onOpenProduct: (String) -> Unit
) {
    val state by viewModel.state.collectAsState()
    val warehouse = state.warehouse

    AppScreen(
        title = warehouse?.name ?: "تفاصيل المخزن",
        onBack = onBack,
        actions = {
            IconButton(onClick = viewModel::refresh) {
                Icon(Icons.Default.Refresh, "تحديث")
            }
        }
    ) { padding ->
        when {
            state.loading -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }

            state.message != null -> Box(
                Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                EmptyState(Icons.Default.ErrorOutline, "تعذر تحميل المخزن", state.message)
            }

            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .background(MaterialTheme.colorScheme.background),
                contentPadding = PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    SectionCard(title = "ملخص المخزن") {
                        SummaryRow("عدد المواد", state.products.size.toString(), bold = true)
                        SummaryRow("إجمالي القطع", state.totalPieces.toString(), bold = true)
                    }
                }

                if (state.products.isEmpty()) {
                    item {
                        EmptyState(
                            Icons.Default.Inventory2,
                            "المخزن فارغ",
                            "لا توجد مواد مسجلة في هذا المخزن"
                        )
                    }
                } else {
                    items(state.products, key = { it.id }) { product ->
                        val stock = product.warehouseStocks
                            .firstOrNull { it.warehouseId == warehouse?.id }
                            ?.quantityPieces ?: 0
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenProduct(product.id) },
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surface
                            ),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    Modifier
                                        .size(44.dp)
                                        .background(
                                            MaterialTheme.colorScheme.primaryContainer,
                                            RoundedCornerShape(10.dp)
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        Icons.Default.Inventory2,
                                        null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(product.name, fontWeight = FontWeight.Bold)
                                    Text(
                                        product.itemNumber,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        "$stock قطعة",
                                        color = MaterialTheme.colorScheme.primary,
                                        fontWeight = FontWeight.ExtraBold
                                    )
                                    Text(
                                        "فتح المادة",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        style = MaterialTheme.typography.labelSmall
                                    )
                                }
                                Icon(
                                    Icons.Default.KeyboardArrowLeft,
                                    null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CouponsScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var showAdd by remember { mutableStateOf(false) }
    AdminListScreen("الكوبونات", onBack, viewModel::refreshAll, "كوبون جديد", { showAdd = true }) {
        items(state.coupons, key = { it.id }) { CouponCard(it) }
    }
    if (showAdd) CouponDialog(onDismiss = { showAdd = false }) { code, name, type, value, max, active ->
        showAdd = false
        viewModel.createCoupon(code, name, type, value, max, active)
    }
}

@Composable
fun QuotationsScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit, onCreate: () -> Unit) {
    val state by viewModel.state.collectAsState()
    AppScreen(
        title = "عروض الأسعار",
        onBack = onBack,
        actions = { IconButton(onClick = viewModel::refreshAll) { Icon(Icons.Default.Refresh, "تحديث") } },
        fab = { ExtendedFloatingActionButton(onClick = onCreate, icon = { Icon(Icons.Default.Add, null) }, text = { Text("عرض جديد") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (state.quotations.isEmpty()) item { EmptyState(Icons.Default.RequestQuote, "لا توجد عروض أسعار", "اضغط عرض جديد لإنشاء أول عرض") }
            else items(state.quotations, key = { it.id }) { quotation ->
                QuotationCard(
                    quotation = quotation,
                    onAccept = { viewModel.updateQuotation(quotation.id, "ACCEPTED") },
                    onReject = { viewModel.updateQuotation(quotation.id, "REJECTED") },
                    onConvert = { viewModel.convertQuotation(quotation.id) }
                )
            }
        }
    }
}

@Composable
fun TransfersScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var showAdd by remember { mutableStateOf(false) }
    AdminListScreen("التحويلات", onBack, viewModel::refreshAll, "تحويل جديد", { showAdd = true }) {
        items(state.transfers, key = { it.id }) { TransferCard(it) }
    }
    if (showAdd) TransferDialog(state.branches, state.products, { showAdd = false }) { from, to, product, qty, unit, notes ->
        showAdd = false
        viewModel.createTransfer(from, to, product, qty, unit, notes)
    }
}

@Composable
fun LossesScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var showAdd by remember { mutableStateOf(false) }
    var cancelTarget by remember { mutableStateOf<StockLossDto?>(null) }

    AdminListScreen("التلف والخسائر", onBack, viewModel::refreshAll, "تسجيل خسارة", { showAdd = true }) {
        items(state.stockLosses, key = { it.id }) { LossCard(it, onCancel = { cancelTarget = it }) }
    }

    if (showAdd) {
        LossDialog(state.branches, state.products, { showAdd = false }) { date, warehouseId, reason, notes, items ->
            showAdd = false
            viewModel.createStockLoss(date, warehouseId, reason, notes, items)
        }
    }

    cancelTarget?.let { loss ->
        AlertDialog(
            onDismissRequest = { cancelTarget = null },
            title = { Text("إلغاء سجل التلف") },
            text = { Text("سيتم إرجاع الكمية المسجلة إلى المخزن. هل تريد المتابعة؟") },
            confirmButton = {
                Button(onClick = { viewModel.cancelStockLoss(loss.id); cancelTarget = null }) { Text("تأكيد") }
            },
            dismissButton = { TextButton(onClick = { cancelTarget = null }) { Text("رجوع") } }
        )
    }
}

@Composable
fun AuditLogsScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    AppScreen(title = "سجل التدقيق", onBack = onBack, actions = { IconButton(onClick = viewModel::refreshAll) { Icon(Icons.Default.Refresh, "تحديث") } }) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    listOf(null to "الكل", "invoices" to "الفواتير", "vouchers" to "السندات", "products" to "المواد", "customers" to "الزبائن", "users" to "المستخدمين", "branches" to "المخازن", "transfers" to "التحويلات", "coupons" to "الكوبونات", "quotations" to "العروض").forEach { (key, label) ->
                        FilterChip(selected = state.auditEntity == key, onClick = { viewModel.setAuditFilter(key, state.auditAction) }, label = { Text(label) })
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    listOf(null to "كل العمليات", "CREATE" to "إنشاء", "UPDATE" to "تعديل", "DELETE" to "حذف", "REACTIVATE" to "إرجاع نشط").forEach { (key, label) ->
                        FilterChip(selected = state.auditAction == key, onClick = { viewModel.setAuditFilter(state.auditEntity, key) }, label = { Text(label) })
                    }
                }
            }
            items(state.auditLogs, key = { it.id }) { AuditCard(it) }
        }
    }
}

@Composable
private fun AdminListScreen(
    title: String,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    fabText: String,
    onFab: () -> Unit,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit
) {
    AppScreen(
        title = title,
        onBack = onBack,
        actions = { IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "تحديث") } },
        fab = { ExtendedFloatingActionButton(onClick = onFab, icon = { Icon(Icons.Default.Add, null) }, text = { Text(fabText) }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content
        )
    }
}

@Composable
private fun BranchCard(branch: BranchDto, onClick: () -> Unit) {
    InfoCard(
        Icons.Default.Warehouse,
        branch.name,
        "${branch.code} | ${branch.phone ?: "-"}",
        if (branch.isActive) "نشط" else "متوقف",
        onClick
    )
}

@Composable
private fun CouponCard(coupon: CouponDto) {
    val value = if (coupon.discountType == "PERCENT") "${coupon.discountValue.formatMoney()}%" else "${coupon.discountValue.formatMoney()} د.ع"
    InfoCard(Icons.Default.LocalOffer, coupon.code, "${coupon.name} | $value", if (coupon.isActive) "نشط" else "متوقف")
}

@Composable
private fun TransferCard(transfer: TransferDto) {
    InfoCard(Icons.Default.SwapHoriz, transfer.transferNumber, "${transfer.fromBranch?.name ?: transfer.fromBranchId} -> ${transfer.toBranch?.name ?: transfer.toBranchId}", "${transfer.items.size} مادة")
}

@Composable
private fun LossCard(loss: StockLossDto, onCancel: () -> Unit) {
    val cancelled = loss.cancelledAt != null
    Card(colors = CardDefaults.cardColors(containerColor = if (cancelled) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(1.dp)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.BrokenImage, null, tint = AppColor.Red600)
                Column(Modifier.weight(1f)) {
                    Text(loss.lossNumber, fontWeight = FontWeight.Bold)
                    Text("${loss.warehouse?.name ?: loss.warehouseId} | ${lossReasonLabel(loss.reason)}", color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                StatusBadge(if (cancelled) "ملغى" else "مسجل", if (cancelled) StatusType.NEUTRAL else StatusType.ERROR)
            }
            SummaryRow("عدد المواد", "${loss.items.size}")
            if (!cancelled) {
                TextButton(onClick = onCancel) { Text("إلغاء وإرجاع المخزون", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

private fun lossReasonLabel(reason: String) = when (reason) {
    "DAMAGE" -> "تلف"
    "EXPIRY" -> "انتهاء صلاحية"
    "THEFT" -> "سرقة / فقدان"
    "DEFECT" -> "عطل في المنتج"
    else -> "أخرى"
}

@Composable
private fun QuotationCard(quotation: QuotationDto, onAccept: () -> Unit, onReject: () -> Unit, onConvert: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(1.dp)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Default.RequestQuote, null, tint = AppColor.Blue600)
                Column(Modifier.weight(1f)) {
                    Text(quotation.quotationNumber, fontWeight = FontWeight.Bold)
                    Text(quotation.customer?.name ?: quotation.customerId, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                StatusBadge(quotationStatusLabel(quotation.status), quotationStatusType(quotation.status))
            }
            SummaryRow("المجموع", "${quotation.totalAmount.formatMoney()} IQD", bold = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onConvert, enabled = quotation.status in listOf("PENDING", "ACCEPTED"), modifier = Modifier.weight(1f)) { Text("حول لفاتورة") }
                TextButton(onClick = onAccept, enabled = quotation.status == "PENDING") { Text("قبول") }
                TextButton(onClick = onReject, enabled = quotation.status == "PENDING") { Text("رفض", color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

@Composable
private fun AuditCard(log: AuditLogDto) {
    InfoCard(
        Icons.Default.History,
        "${actionLabel(log.action)} | ${entityLabel(log.entity)}",
        "${log.user?.name ?: "-"} | ${log.createdAt?.take(16)?.replace("T", " ") ?: "-"}",
        log.recordId?.take(8) ?: "-"
    )
}

@Composable
private fun InfoCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    badge: String,
    onClick: (() -> Unit)? = null
) {
    Card(
        modifier = Modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(1.dp)
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
            }
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            StatusBadge(badge, StatusType.INFO)
        }
    }
}

@Composable
private fun BranchDialog(onDismiss: () -> Unit, onSave: (String, String, String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    SimpleDialog("مخزن جديد", onDismiss, { onSave(name, code, phone, address) }) {
        DialogField("اسم المخزن", name) { name = it }
        DialogField("الكود", code) { code = it }
        DialogField("الهاتف", phone) { phone = it }
        DialogField("العنوان", address) { address = it }
    }
}

@Composable
private fun CouponDialog(onDismiss: () -> Unit, onSave: (String, String, String, String, String, Boolean) -> Unit) {
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("PERCENT") }
    var value by remember { mutableStateOf("") }
    var max by remember { mutableStateOf("") }
    var active by remember { mutableStateOf(true) }
    SimpleDialog("كوبون جديد", onDismiss, { onSave(code, name, type, value, max, active) }) {
        DialogField("الكود", code) { code = it }
        DialogField("الاسم", name) { name = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = type == "PERCENT", onClick = { type = "PERCENT" }, label = { Text("نسبة") })
            FilterChip(selected = type == "AMOUNT", onClick = { type = "AMOUNT" }, label = { Text("مبلغ") })
        }
        DialogField("قيمة الخصم", value) { value = it }
        DialogField("أقصى استخدام", max) { max = it }
        FilterChip(selected = active, onClick = { active = !active }, label = { Text(if (active) "نشط" else "متوقف") })
    }
}

@Composable
private fun TransferDialog(
    branches: List<BranchDto>,
    products: List<Product>,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, String, String) -> Unit
) {
    var from by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var product by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("1") }
    var unit by remember { mutableStateOf("PIECE") }
    var notes by remember { mutableStateOf("") }

    SimpleDialog("تحويل جديد", onDismiss, { onSave(from, to, product, qty, unit, notes) }) {
        SelectField("من مخزن", branches.map { it.id to it.name }, from) { from = it }
        SelectField("إلى مخزن", branches.map { it.id to it.name }, to) { to = it }
        SelectField(
            "المادة",
            products.map { item ->
                val sourceQty = item.warehouseStocks.firstOrNull { it.warehouseId == from }?.quantityPieces ?: 0
                item.id to "${item.name} ($sourceQty قطعة)"
            },
            product,
        ) { product = it }
        DialogField("العدد", qty) { qty = it.filter(Char::isDigit) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كارتون").forEach { (key, label) ->
                FilterChip(selected = unit == key, onClick = { unit = key }, label = { Text(label) })
            }
        }
        DialogField("ملاحظات", notes) { notes = it }
    }
}

@Composable
private fun LossDialog(
    branches: List<BranchDto>,
    products: List<Product>,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, List<Triple<String, String, Double>>) -> Unit
) {
    var date by remember { mutableStateOf(java.time.LocalDate.now().toString()) }
    var warehouseId by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("DAMAGE") }
    var notes by remember { mutableStateOf("") }
    var productId by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("1") }
    var unit by remember { mutableStateOf("PIECE") }
    val items = remember { mutableStateListOf<Triple<String, String, Double>>() }

    SimpleDialog("تسجيل خسارة", onDismiss, { onSave(date, warehouseId, reason, notes, items.toList()) }) {
        DialogField("التاريخ", date) { date = it }
        SelectField("المخزن", branches.map { it.id to it.name }, warehouseId) { warehouseId = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            listOf("DAMAGE" to "تلف", "EXPIRY" to "انتهاء صلاحية", "THEFT" to "سرقة", "DEFECT" to "عطل", "OTHER" to "أخرى").forEach { (key, label) ->
                FilterChip(selected = reason == key, onClick = { reason = key }, label = { Text(label) })
            }
        }
        HorizontalDivider()
        Text("إضافة مادة", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        SelectField("المادة", products.map { it.id to it.name }, productId) { productId = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            DialogField("الكمية", qty) { qty = it.filter { c -> c.isDigit() || c == '.' } }
            listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كارتون").forEach { (key, label) ->
                FilterChip(selected = unit == key, onClick = { unit = key }, label = { Text(label) })
            }
        }
        TextButton(onClick = {
            val quantity = qty.toDoubleOrNull()
            if (productId.isNotBlank() && quantity != null && quantity > 0) {
                items.add(Triple(productId, unit, quantity))
                productId = ""
                qty = "1"
            }
        }) { Text("+ إضافة للقائمة") }
        items.forEachIndexed { index, (pid, u, q) ->
            val name = products.firstOrNull { it.id == pid }?.name ?: pid
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("$name — $q ${if (u == "CARTON") "كارتون" else if (u == "DOZEN") "درزن" else "قطعة"}", modifier = Modifier.weight(1f))
                IconButton(onClick = { items.removeAt(index) }) { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) }
            }
        }
        DialogField("ملاحظات", notes) { notes = it }
    }
}

@Composable
private fun SimpleDialog(title: String, onDismiss: () -> Unit, onSave: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp), content = content) },
        confirmButton = { Button(onClick = onSave) { Text("حفظ") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
private fun DialogField(label: String, value: String, onValue: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onValue, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(10.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectField(label: String, options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.find { it.first == selected }?.second.orEmpty()
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.menuAnchor().fillMaxWidth(),
            shape = RoundedCornerShape(10.dp)
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(id); expanded = false })
            }
        }
    }
}

private fun actionLabel(action: String) = when (action) {
    "CREATE" -> "إنشاء"
    "UPDATE" -> "تعديل"
    "DELETE" -> "حذف"
    "REACTIVATE" -> "إرجاع نشط"
    else -> action
}

private fun entityLabel(entity: String) = when (entity) {
    "invoices" -> "الفواتير"
    "vouchers" -> "السندات"
    "products" -> "المواد"
    "customers" -> "الزبائن"
    "users" -> "المستخدمين"
    "branches" -> "المخازن"
    "transfers" -> "التحويلات"
    "coupons" -> "الكوبونات"
    "quotations" -> "العروض"
    else -> entity
}

private fun quotationStatusLabel(status: String) = when (status) {
    "PENDING" -> "معلق"
    "ACCEPTED" -> "مقبول"
    "REJECTED" -> "مرفوض"
    "EXPIRED" -> "منتهي"
    "CONVERTED" -> "تحول"
    else -> status
}

private fun quotationStatusType(status: String) = when (status) {
    "ACCEPTED", "CONVERTED" -> StatusType.SUCCESS
    "REJECTED", "EXPIRED" -> StatusType.ERROR
    "PENDING" -> StatusType.WARNING
    else -> StatusType.NEUTRAL
}

private fun Double.cleanAmount(): String = if (this % 1.0 == 0.0) toLong().toString() else toString()
