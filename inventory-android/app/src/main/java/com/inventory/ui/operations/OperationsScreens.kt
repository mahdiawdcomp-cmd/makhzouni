package com.inventory.ui.operations

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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AssignmentReturn
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RequestQuote
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warehouse
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.inventory.data.remote.dto.AuditLogDto
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.CouponDto
import com.inventory.data.remote.dto.QuotationDto
import com.inventory.data.remote.dto.TransferDto
import com.inventory.domain.model.Product
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.EmptyState
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor

private data class HubItem(
    val title: String,
    val sub: String,
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
    isAdmin: Boolean = true,
    permissions: List<String> = emptyList(),
) {
    val canInvoice = isAdmin || permissions.contains("MANAGE_INVOICES")
    val canVouchers = isAdmin || permissions.contains("MANAGE_VOUCHERS")
    val canSettings = isAdmin || permissions.contains("MANAGE_SETTINGS")

    val tiles = buildList {
        if (canInvoice) {
            add(HubItem("POS سريع",       "فاتورة كاشير",         Icons.Default.PointOfSale,        AppColor.Green600,   onPos))
            add(HubItem("مرتجع مبيعات",  "إرجاع كامل أو جزئي",  Icons.Default.AssignmentReturn,   AppColor.Red600,     onReturns))
            add(HubItem("عروض الأسعار",  "إنشاء وتحويل لفاتورة", Icons.Default.RequestQuote,       AppColor.Blue600,    onQuotations))
            add(HubItem("فاتورة شراء OCR", "قراءة من صورة",      Icons.Default.DocumentScanner,    Color(0xFF7C3AED),   onOcrInvoice))
            add(HubItem("طلبات المفرد",   "كتلوك المفرد والتجهيز", Icons.Default.Storefront,        Color(0xFF6366F1),   onRetailOrders))
        }
        if (canVouchers) {
            add(HubItem("السندات",        "قبض / دفع / مصاريف",   Icons.Default.ConfirmationNumber, AppColor.Purple600,  onVouchers))
        }
        if (canSettings) {
            add(HubItem("التحويلات",      "بين المخازن",           Icons.Default.SwapHoriz,          AppColor.Sky500,     onTransfers))
            add(HubItem("المخازن",        "إدارة الفروع",          Icons.Default.Warehouse,          AppColor.Amber600,   onBranches))
            add(HubItem("الكوبونات",      "خصومات وعروض",          Icons.Default.LocalOffer,         Color(0xFF0F766E),   onCoupons))
            add(HubItem("سجل التدقيق",    "من عدل؟ متى؟",          Icons.Default.History,            AppColor.Gray700,    onAudit))
        }
    }

    AppScreen(title = "العمليات", onBack = onBack) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            gridItems(tiles) { tile ->
                HubTile(
                    title   = tile.title,
                    subtitle = tile.sub,
                    icon    = tile.icon,
                    color   = tile.color,
                    onClick = tile.onClick,
                )
            }
        }
    }
}

@Composable
private fun HubTile(
    title: String,
    subtitle: String,
    icon: ImageVector,
    color: Color,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = 0.08f)),
        border = BorderStroke(1.dp, color.copy(alpha = 0.20f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(color.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
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
        actions = {
            IconButton(onClick = onScan) { Icon(Icons.Default.QrCodeScanner, "مسح باركود") }
        },
        snackbarHost = { SnackbarHost(snackbar) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                SectionCard(title = "معلومات العملية", containerColor = MaterialTheme.colorScheme.surface) {
                    OutlinedTextField(
                        value = state.customerQuery,
                        onValueChange = viewModel::setCustomerQuery,
                        label = { Text("الزبون") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    state.customerSuggestions.forEach {
                        SuggestionRow("${it.name} - ${it.phone}") { viewModel.selectCustomer(it) }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = state.productQuery,
                        onValueChange = viewModel::setProductQuery,
                        label = { Text("بحث المادة") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    state.productSuggestions.forEach {
                        SuggestionRow("${it.name} | رصيد ${it.currentStock}") { viewModel.addProduct(it) }
                    }
                }
            }

            item {
                SectionCard(title = "المواد", containerColor = Color(0xFFF8FAFC)) {
                    if (state.lines.isEmpty()) {
                        EmptyState(Icons.Default.Book, "لا توجد مواد", "ابحث عن مادة وأضفها للعملية")
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
                SectionCard(title = "المال", containerColor = Color(0xFFF0FDF4)) {
                    if (mode != "RETURN") {
                        OutlinedTextField(
                            value = state.paid,
                            onValueChange = viewModel::setPaid,
                            label = { Text("المدفوع") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    if (mode == "QUOTATION") {
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.discount,
                            onValueChange = viewModel::setDiscount,
                            label = { Text("الخصم") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = state.notes,
                            onValueChange = viewModel::setNotes,
                            label = { Text("ملاحظات") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    SummaryRow("المجموع", state.total.formatMoney(), true)
                    Button(
                        onClick = viewModel::save,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        enabled = !state.loading
                    ) {
                        Icon(Icons.Default.Add, null)
                        Spacer(Modifier.width(6.dp))
                        Text(if (mode == "QUOTATION") "حفظ عرض السعر" else "حفظ")
                    }
                }
            }
        }
    }
}

@Composable
private fun SuggestionRow(text: String, onClick: () -> Unit) {
    Text(
        text = text,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold
    )
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
            Text(line.product.name, Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            TextButton(onClick = onRemove) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallNumberField("عدد", line.quantity.toString(), { onQty(it.toIntOrNull() ?: 0) }, Modifier.weight(1f))
            SmallNumberField("سعر", line.unitPrice.toString(), { onPrice(it.toDoubleOrNull() ?: 0.0) }, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كارتون").forEach { (key, label) ->
                FilterChip(selected = line.unit == key, onClick = { onUnit(key) }, label = { Text(label) })
            }
        }
        SummaryRow("سطر ${index + 1}", line.total.formatMoney(), false)
    }
}

@Composable
private fun SmallNumberField(label: String, value: String, onValue: (String) -> Unit, modifier: Modifier) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(label) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = modifier
    )
}

@Composable
private fun SummaryRow(label: String, value: String, strong: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium)
        Text(value, fontWeight = if (strong) FontWeight.ExtraBold else FontWeight.SemiBold)
    }
}

@Composable
fun BranchesScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var showAdd by remember { mutableStateOf(false) }
    AdminListScreen(
        title = "المخازن",
        onBack = onBack,
        onRefresh = viewModel::refreshAll,
        fabText = "مخزن جديد",
        onFab = { showAdd = true }
    ) {
        items(state.branches, key = { it.id }) { branch -> BranchCard(branch) }
    }
    if (showAdd) BranchDialog(onDismiss = { showAdd = false }) { name, code, phone, address ->
        showAdd = false
        viewModel.createBranch(name, code, phone, address)
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
        actions = { IconButton(onClick = viewModel::refreshAll) { Icon(Icons.Default.Refresh, null) } },
        fab = { ExtendedFloatingActionButton(onClick = onCreate, icon = { Icon(Icons.Default.Add, null) }, text = { Text("عرض جديد") }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (state.quotations.isEmpty()) {
                item { EmptyState(Icons.Default.RequestQuote, "لا توجد عروض أسعار", "اضغط عرض جديد لإنشاء أول عرض") }
            } else {
                items(state.quotations, key = { it.id }) { quotation ->
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
fun AuditLogsScreen(viewModel: AdminOperationsViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    AppScreen(
        title = "سجل التدقيق",
        onBack = onBack,
        actions = { IconButton(onClick = viewModel::refreshAll) { Icon(Icons.Default.Refresh, null) } }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                    val entities = listOf(null to "الكل", "invoices" to "الفواتير", "vouchers" to "السندات", "products" to "المواد", "customers" to "الزبائن", "users" to "المستخدمين", "branches" to "المخازن", "transfers" to "التحويلات", "coupons" to "الكوبونات", "quotations" to "العروض")
                    entities.forEach { (key, label) ->
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
        actions = { IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, null) } },
        fab = { ExtendedFloatingActionButton(onClick = onFab, icon = { Icon(Icons.Default.Add, null) }, text = { Text(fabText) }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content
        )
    }
}

@Composable
private fun BranchCard(branch: BranchDto) {
    InfoCard(Icons.Default.Warehouse, branch.name, "${branch.code} | ${branch.phone ?: "-"}", if (branch.isActive) "نشط" else "متوقف")
}

@Composable
private fun CouponCard(coupon: CouponDto) {
    InfoCard(Icons.Default.LocalOffer, coupon.code, "${coupon.name} | ${coupon.discountValue.formatMoney()} ${if (coupon.discountType == "PERCENT") "%" else "د.ع"}", if (coupon.isActive) "نشط" else "متوقف")
}

@Composable
private fun TransferCard(transfer: TransferDto) {
    InfoCard(Icons.Default.SwapHoriz, transfer.transferNumber, "${transfer.fromBranch?.name ?: transfer.fromBranchId} -> ${transfer.toBranch?.name ?: transfer.toBranchId}", "${transfer.items.size} مادة")
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
            SummaryRow("المجموع", quotation.totalAmount.formatMoney(), true)
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
    InfoCard(Icons.Default.History, "${actionLabel(log.action)} | ${entityLabel(log.entity)}", "${log.user?.name ?: "-"} | ${log.createdAt?.take(16)?.replace("T", " ") ?: "-"}", log.recordId?.take(8) ?: "-")
}

@Composable
private fun InfoCard(icon: ImageVector, title: String, subtitle: String, badge: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), elevation = CardDefaults.cardElevation(1.dp)) {
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = active, onClick = { active = !active }, label = { Text(if (active) "نشط" else "متوقف") })
        }
    }
}

@Composable
private fun TransferDialog(branches: List<BranchDto>, products: List<Product>, onDismiss: () -> Unit, onSave: (String, String, String, String, String, String) -> Unit) {
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
        DialogField("العدد", qty) { qty = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كارتون").forEach { (key, label) ->
                FilterChip(selected = unit == key, onClick = { unit = key }, label = { Text(label) })
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
    OutlinedTextField(value = value, onValueChange = onValue, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
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
            modifier = Modifier.menuAnchor().fillMaxWidth()
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
