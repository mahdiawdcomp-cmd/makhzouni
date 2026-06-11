package com.inventory.ui.customers

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inventory.domain.model.Customer
import com.inventory.domain.model.CustomerTransaction
import com.inventory.ui.common.*
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CUSTOMER LIST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun CustomerListScreen(
    viewModel: CustomerListViewModel,
    onAdd: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()

    AppScreen(
        title = if (state.isSupplierFilter) "الموردين" else "الزبائن",
        fab = {
            ExtendedFloatingActionButton(
                onClick = onAdd,
                icon = { Icon(Icons.Default.PersonAdd, null) },
                text = { Text(if (state.isSupplierFilter) "إضافة مورد" else "إضافة زبون", fontWeight = FontWeight.SemiBold) },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            // ── Header bar ───────────────────────────────────────────
            Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    AppSearchBar(
                        query = state.query,
                        onQueryChange = viewModel::onQueryChange,
                        placeholder = "بحث بالاسم أو الهاتف",
                    )
                    Spacer(Modifier.height(10.dp))
                    // Tab row
                    TabRow(
                        selectedTabIndex = if (state.isSupplierFilter) 1 else 0,
                        containerColor = Color.Transparent,
                        contentColor = MaterialTheme.colorScheme.primary,
                    ) {
                        Tab(selected = !state.isSupplierFilter, onClick = { viewModel.onSupplierFilterChange(false) }) {
                            Row(modifier = Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.People, null, Modifier.size(16.dp))
                                Text("الزبائن")
                            }
                        }
                        Tab(selected = state.isSupplierFilter, onClick = { viewModel.onSupplierFilterChange(true) }) {
                            Row(modifier = Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Business, null, Modifier.size(16.dp))
                                Text("الموردين")
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
                            "last" to "آخر تعامل",
                            "balanceDesc" to "أعلى رصيد",
                            "balanceAsc" to "أقل رصيد",
                            "name" to "الاسم",
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

            // ── List ─────────────────────────────────────────────────
            if (state.filteredCustomers.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        icon = Icons.Default.PeopleAlt,
                        title = if (state.query.isNotBlank()) "لا توجد نتائج" else "لا يوجد ${if (state.isSupplierFilter) "موردين" else "زبائن"}",
                        subtitle = "اضغط + لإضافة جديد",
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 88.dp),
                ) {
                    items(state.filteredCustomers, key = { it.id }) { customer ->
                        CustomerListItem(customer = customer, onClick = { onOpen(customer.id) })
                        HorizontalDivider(modifier = Modifier.padding(start = 72.dp), color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomerListItem(customer: Customer, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // Avatar with initial
        val avatarColor = if (customer.currentBalance > 0) AppColor.Red600 else if (customer.currentBalance < 0) AppColor.Amber600 else AppColor.Green600
        TextAvatar(customer.name, avatarColor, size = 46.dp)

        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(customer.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(customer.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            customer.lastTransactionAt?.let {
                Text("آخر تعامل: ${it.toDisplayDate()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
            }
        }

        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            BalanceChip(customer.currentBalance)
            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CUSTOMER DETAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun CustomerDetailScreen(
    viewModel: CustomerDetailViewModel,
    onNewInvoice: (String) -> Unit,
    onReceipt: (String) -> Unit,
    onStatement: (String) -> Unit,
    onOpenReference: (String?) -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val customer = state.customer

    if (customer == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text(customer.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(onClick = { sendWhatsApp(context, customer.phone, "مرحباً ${customer.name}") }) {
                        Icon(Icons.Default.Phone, "واتساب", tint = AppColor.Green600)
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
            // ── Balance Hero ─────────────────────────────────────────
            item {
                val isDebt = customer.currentBalance > 0
                val gradientBrush = if (isDebt)
                    Brush.horizontalGradient(listOf(AppColor.Red600, Color(0xFFEF4444)))
                else
                    Brush.horizontalGradient(listOf(AppColor.Green600, Color(0xFF10B981)))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(gradientBrush, RoundedCornerShape(16.dp))
                        .padding(20.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(if (isDebt) "رصيد مستحق" else "في صالحه", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelMedium)
                        Text("${customer.currentBalance.formatMoney()} IQD", color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.ExtraBold)
                        Text(customer.phone, color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            // ── Quick actions ────────────────────────────────────────
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // New invoice
                    FilledTonalButton(
                        onClick = { onNewInvoice(customer.id) },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.Receipt, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("فاتورة", style = MaterialTheme.typography.labelLarge)
                    }
                    // Receipt
                    FilledTonalButton(
                        onClick = { onReceipt(customer.id) },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.Payments, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("قبض", style = MaterialTheme.typography.labelLarge)
                    }
                    // Statement
                    FilledTonalButton(
                        onClick = { onStatement(customer.id) },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.AccountBalance, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("كشف", style = MaterialTheme.typography.labelLarge)
                    }
                    // WhatsApp
                    FilledTonalButton(
                        onClick = { sendWhatsApp(context, customer.phone, "مرحباً ${customer.name}، رصيدك لدينا ${customer.currentBalance.formatMoney()} IQD") },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.filledTonalButtonColors(containerColor = AppColor.Green100),
                    ) {
                        Icon(Icons.Default.Message, null, Modifier.size(16.dp), tint = AppColor.Green600)
                    }
                }
            }

            // ── Last transaction ─────────────────────────────────────
            state.lastTransaction?.let { last ->
                item {
                    SectionCard(title = "آخر معاملة") {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            IconAvatar(icon = Icons.Default.History, bgColor = AppColor.Blue100, iconColor = AppColor.Blue600, size = 40.dp, iconSize = 18.dp)
                            Column(Modifier.weight(1f)) {
                                Text(last.referenceNumber ?: "-", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                val lastTypeLabel = when (last.type) {
                                    "INVOICE", "SALE_INVOICE" -> "فاتورة بيع"
                                    "PURCHASE_INVOICE" -> "فاتورة شراء"
                                    "SALES_RETURN_INVOICE", "SALES_RETURN" -> "مرتجع"
                                    "RECEIPT" -> "سند قبض"
                                    "PAYMENT" -> "سند دفع"
                                    "EXPENSE" -> "مصاريف"
                                    else -> last.type ?: "-"
                                }
                                Text("$lastTypeLabel · ${last.date?.toDisplayDate() ?: "-"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            last.amount?.let { AmountText(it, positiveColor = MaterialTheme.colorScheme.primary) }
                        }
                    }
                }
            }

            // ── Info card ─────────────────────────────────────────────
            item {
                SectionCard(title = "معلومات الحساب") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryRow("الرصيد الافتتاحي", "${customer.openingBalance.formatMoney()} IQD")
                        SummaryRow("الرصيد الحالي", "${customer.currentBalance.formatMoney()} IQD", valueColor = if (customer.currentBalance > 0) AppColor.Red600 else AppColor.Green600, bold = true)
                        if (!customer.address.isNullOrBlank()) SummaryRow("العنوان", customer.address!!)
                        if (!customer.notes.isNullOrBlank()) SummaryRow("ملاحظات", customer.notes!!)
                    }
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CUSTOMER STATEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun CustomerStatementScreen(
    viewModel: CustomerStatementViewModel,
    onOpenReference: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text("كشف الحساب", fontWeight = FontWeight.Bold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            // ── Filter bar ────────────────────────────────────────────
            Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = state.allTime, onClick = { viewModel.setAllTime(true); viewModel.refresh() }, label = { Text("كامل المدة") }, shape = RoundedCornerShape(8.dp))
                        FilterChip(selected = !state.allTime, onClick = { viewModel.setAllTime(false) }, label = { Text("فترة محددة") }, shape = RoundedCornerShape(8.dp))
                    }
                    if (!state.allTime) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                            OutlinedTextField(state.from, viewModel::setFrom, Modifier.weight(1f), label = { Text("من") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                            OutlinedTextField(state.to, viewModel::setTo, Modifier.weight(1f), label = { Text("إلى") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                            FilledTonalButton(onClick = viewModel::refresh, shape = RoundedCornerShape(10.dp)) { Text("عرض") }
                        }
                    }
                }
            }

            if (state.rows.isEmpty()) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    EmptyState(icon = Icons.Default.ReceiptLong, title = "لا توجد معاملات", subtitle = "حدد فترة زمنية مختلفة")
                }
            } else {
                // ── Statement table ───────────────────────────────────────
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 8.dp),
                ) {
                    // Table header
                    item {
                        Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                            ) {
                                Text("التاريخ", Modifier.weight(1.6f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                                Text("النوع", Modifier.weight(1.5f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                                Text("مدين", Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.labelSmall, color = AppColor.Red600, fontWeight = FontWeight.SemiBold)
                                Text("دائن", Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.labelSmall, color = AppColor.Green600, fontWeight = FontWeight.SemiBold)
                                Text("الرصيد", Modifier.weight(1.4f), textAlign = TextAlign.End, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }

                    itemsIndexed(state.rows, key = { index, r -> "${r.type}-${r.id}-$index" }) { index, row ->
                        StatementRowItem(
                            row = row,
                            isEven = index % 2 == 0,
                            onClick = { onOpenReference("${row.type}|${row.id}|${row.referenceNumber}") },
                        )
                    }
                }
            }

            // ── Balance footer ────────────────────────────────────────
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 4.dp,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("الرصيد النهائي", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    BalanceChip(state.finalBalance)
                }
            }
        }
    }
}

@Composable
private fun StatementRowItem(
    row: CustomerTransaction,
    isEven: Boolean,
    onClick: () -> Unit,
) {
    val typeLabel = when (row.type) {
        "INVOICE", "SALE_INVOICE"        -> if (row.debit > 0) "فاتورة بيع" else if (row.credit > 0) "فاتورة شراء" else "فاتورة"
        "INVOICE_PAYMENT", "SALE_PAYMENT" -> "دفعة فاتورة"
        "PURCHASE_INVOICE"               -> "فاتورة شراء"
        "PURCHASE_PAYMENT"               -> "دفعة شراء"
        "SALES_RETURN_INVOICE", "SALES_RETURN" -> "فاتورة مرتجع"
        "RECEIPT"                        -> "سند قبض"
        "PAYMENT"                        -> "سند دفع"
        "EXPENSE"                        -> "مصاريف"
        else                             -> row.type
    }
    val upperType = row.type.uppercase()
    val isCancelled = row.status.equals("CANCELLED", ignoreCase = true)
    val isInvoice = upperType.contains("INVOICE") || upperType == "SALE" || upperType == "PURCHASE"
    val isVoucher = upperType.contains("VOUCHER") || upperType == "RECEIPT" || upperType == "PAYMENT" || upperType == "EXPENSE"
    val typeColor = when {
        isCancelled -> AppColor.Red600
        isInvoice -> AppColor.Blue600
        isVoucher -> AppColor.Green600
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val displayLabel = if (isCancelled) "$typeLabel - ملغاة" else typeLabel
    val bg = when {
        isCancelled -> AppColor.Red50.copy(alpha = if (isEven) 0.75f else 0.45f)
        isInvoice -> AppColor.Blue50.copy(alpha = if (isEven) 0.55f else 0.25f)
        isVoucher -> AppColor.Green50.copy(alpha = if (isEven) 0.55f else 0.25f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (isEven) 0.45f else 0.18f)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(row.date.toDisplayDate(), Modifier.weight(1.6f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        Text(displayLabel, Modifier.weight(1.5f), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = typeColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
        // Debit
        if (row.debit > 0)
            Text(row.debit.formatMoney(), Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = AppColor.Red600, fontSize = 12.sp)
        else
            Text("—", Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
        // Credit
        if (row.credit > 0)
            Text(row.credit.formatMoney(), Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, color = AppColor.Green600, fontSize = 12.sp)
        else
            Text("—", Modifier.weight(1.3f), textAlign = TextAlign.End, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
        // Balance
        val balanceColor = if (row.runningBalance > 0) AppColor.Red600 else if (row.runningBalance < 0) AppColor.Amber600 else AppColor.Green600
        Text(row.runningBalance.formatMoney(), Modifier.weight(1.4f), textAlign = TextAlign.End, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = balanceColor, fontSize = 12.sp)
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CUSTOMER FORM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun CustomerFormScreen(viewModel: CustomerFormViewModel, onDone: () -> Unit) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(state.saved) { if (state.saved) onDone() }

    AppScreen(title = "إضافة ${if (state.isSupplier) "مورد" else "زبون"}", onBack = onDone) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                SectionCard(title = "بيانات الحساب") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(state.name, { viewModel.update("name", it) }, "الاسم الكامل", required = true)
                        AppTextField(state.phone, { viewModel.update("phone", it) }, "رقم الهاتف", required = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                        AppTextField(state.address, { viewModel.update("address", it) }, "العنوان")
                        AppTextField(state.notes, { viewModel.update("notes", it) }, "ملاحظات", singleLine = false)
                        AppTextField(state.openingBalance, { viewModel.update("openingBalance", it) }, "الرصيد الافتتاحي", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))

                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Switch(checked = state.isSupplier, onCheckedChange = { viewModel.update("isSupplier", it.toString()) })
                            Column {
                                Text("تعيين كمورد", style = MaterialTheme.typography.labelLarge)
                                Text("الموردون لديهم فواتير شراء", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
            if (state.error != null) {
                item {
                    Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Red50) {
                        Text(state.error!!, style = MaterialTheme.typography.bodySmall, color = AppColor.Red600, modifier = Modifier.fillMaxWidth().padding(12.dp))
                    }
                }
            }
            item {
                Button(
                    onClick = viewModel::save,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = !state.isSaving,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    if (state.isSaving) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Check, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("حفظ", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RECEIPT SCREEN (سند قبض)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun ReceiptScreen(viewModel: ReceiptViewModel, onDone: () -> Unit) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(state.saved) { if (state.saved) onDone() }

    AppScreen(title = "سند قبض جديد", onBack = onDone) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Customer picker
            item {
                SectionCard(title = "الزبون") {
                    if (state.selected == null) {
                        AppSearchBar(query = state.query, onQueryChange = viewModel::onQueryChange, placeholder = "ابحث عن الزبون...")
                        if (state.suggestions.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            state.suggestions.forEach { customer ->
                                ListRow(
                                    title = customer.name,
                                    subtitle = customer.phone,
                                    leading = { TextAvatar(customer.name, AppColor.Blue600) },
                                    trailing = { BalanceChip(customer.currentBalance) },
                                    onClick = { viewModel.selectCustomer(customer) },
                                )
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                    } else {
                        val cust = state.selected!!
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TextAvatar(cust.name, AppColor.Blue600, size = 46.dp)
                            Column(Modifier.weight(1f)) {
                                Text(cust.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                Text(cust.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            BalanceChip(cust.currentBalance)
                        }
                        // Last transaction
                        state.lastTransaction?.let { last ->
                            Spacer(Modifier.height(8.dp))
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Default.History, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("آخر معاملة: ${last.type} · ${last.date?.toDisplayDate()}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            // Amount + Date
            item {
                SectionCard(title = "بيانات السند") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(
                            value = state.amount,
                            onValueChange = { viewModel.update("amount", it) },
                            label = "المبلغ المستلم",
                            required = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        AppTextField(
                            value = state.date,
                            onValueChange = { viewModel.update("date", it) },
                            label = "التاريخ",
                            placeholder = "YYYY-MM-DD",
                        )
                        AppTextField(
                            value = state.notes,
                            onValueChange = { viewModel.update("notes", it) },
                            label = "ملاحظات",
                            singleLine = false,
                        )
                    }
                }
            }

            // Error
            if (state.error != null) {
                item {
                    Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Red50) {
                        Text(state.error!!, color = AppColor.Red600, modifier = Modifier.fillMaxWidth().padding(12.dp), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            // Save button
            item {
                Button(
                    onClick = viewModel::preview,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = state.selected != null && state.amount.isNotBlank(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.Preview, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("معاينة وحفظ", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // Preview dialog
    if (state.preview) {
        AlertDialog(
            onDismissRequest = viewModel::dismissPreview,
            icon = { Icon(Icons.Default.Receipt, null, tint = AppColor.Green600) },
            title = { Text("تأكيد سند القبض", textAlign = TextAlign.Center) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SummaryRow("الزبون", state.selected?.name ?: "—")
                    SummaryRow("المبلغ", "${state.amount} IQD", valueColor = AppColor.Green600, bold = true)
                    SummaryRow("التاريخ", state.date)
                    if (state.notes.isNotBlank()) SummaryRow("ملاحظات", state.notes)
                }
            },
            confirmButton = {
                Button(onClick = viewModel::save, enabled = !state.isSaving) {
                    if (state.isSaving) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("حفظ السند")
                }
            },
            dismissButton = { TextButton(onClick = viewModel::dismissPreview) { Text("رجوع") } },
        )
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACCOUNT LOOKUP — كشف حساب سريع
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountLookupScreen(
    viewModel: AccountLookupViewModel,
    onStatement: (String) -> Unit,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var dropdownOpen by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("كشف حساب", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "رجوع") } },
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
            // ── Search field ─────────────────────────────────────────
            item {
                ExposedDropdownMenuBox(
                    expanded = dropdownOpen && state.suggestions.isNotEmpty(),
                    onExpandedChange = {},
                ) {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = { viewModel.onQueryChange(it); dropdownOpen = true },
                        modifier = Modifier.fillMaxWidth().menuAnchor(),
                        label = { Text("ابحث عن زبون بالاسم أو الهاتف") },
                        leadingIcon = { Icon(Icons.Default.Search, null) },
                        trailingIcon = {
                            if (state.query.isNotEmpty())
                                IconButton(onClick = { viewModel.onQueryChange(""); dropdownOpen = false }) {
                                    Icon(Icons.Default.Close, null)
                                }
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                    )
                    ExposedDropdownMenu(
                        expanded = dropdownOpen && state.suggestions.isNotEmpty(),
                        onDismissRequest = { dropdownOpen = false },
                    ) {
                        state.suggestions.forEach { c ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(c.name, fontWeight = FontWeight.SemiBold)
                                        Text(c.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                },
                                onClick = {
                                    viewModel.onQueryChange(c.name)
                                    viewModel.select(c.id)
                                    dropdownOpen = false
                                },
                                trailingIcon = {
                                    val balanceColor = if (c.currentBalance > 0) AppColor.Red600 else AppColor.Green600
                                    Text("${c.currentBalance.toLong()} د.ع", style = MaterialTheme.typography.labelSmall, color = balanceColor, fontWeight = FontWeight.Bold)
                                }
                            )
                        }
                    }
                }
            }

            // ── Empty state ──────────────────────────────────────────
            if (state.selectedCustomer == null && state.query.isBlank()) {
                item {
                    Box(modifier = Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Default.AccountBalance, null, modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.outlineVariant)
                            Text("ابحث عن زبون لعرض كشف حسابه", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            // ── Selected customer card ───────────────────────────────
            state.selectedCustomer?.let { customer ->
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(Brush.horizontalGradient(listOf(AppColor.Purple600, Color(0xFF7C3AED))))
                            .padding(20.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(customer.name, color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                            Text(customer.phone, color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                BalanceChip("الرصيد الحالي", customer.currentBalance)
                            }
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = { onStatement(customer.id) },
                                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = AppColor.Purple600),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Default.OpenInNew, null, Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("عرض كشف الحساب الكامل", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                // Transactions
                if (state.isLoadingTransactions) {
                    item { SkeletonLoading(rows = 5) }
                } else if (state.transactions.isNotEmpty()) {
                    item {
                        SectionCard(title = "آخر الحركات (${state.transactions.size})") {
                            Column {
                                state.transactions.take(20).forEachIndexed { idx, tx ->
                                    val isCredit = tx.credit > 0.0
                                    val amount = if (isCredit) tx.credit else if (tx.debit > 0.0) tx.debit else tx.amount
                                    val amountColor = if (isCredit) AppColor.Green600 else AppColor.Red600
                                    val upperType = tx.type.uppercase()
                                    val isCancelled = tx.status.equals("CANCELLED", ignoreCase = true)
                                    val isInvoice = upperType.contains("INVOICE") || upperType == "SALE" || upperType == "PURCHASE"
                                    val isVoucher = upperType.contains("VOUCHER") || upperType == "RECEIPT" || upperType == "PAYMENT" || upperType == "EXPENSE"
                                    val rowBg = when {
                                        isCancelled -> AppColor.Red50.copy(alpha = 0.75f)
                                        isInvoice -> AppColor.Blue50.copy(alpha = 0.7f)
                                        isVoucher -> AppColor.Green50.copy(alpha = 0.7f)
                                        idx % 2 == 0 -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                                        else -> Color.Transparent
                                    }
                                    val refColor = when {
                                        isCancelled -> AppColor.Red600
                                        isInvoice -> AppColor.Blue600
                                        isVoucher -> AppColor.Green600
                                        else -> MaterialTheme.colorScheme.primary
                                    }
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .background(rowBg)
                                            .padding(horizontal = 8.dp, vertical = 9.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                if (isCancelled) "${tx.referenceNumber} - ملغاة" else tx.referenceNumber,
                                                style = MaterialTheme.typography.labelSmall,
                                                color = refColor,
                                                fontWeight = FontWeight.SemiBold,
                                            )
                                            Text(tx.date.take(10), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
                                        }
                                        Text(
                                            "${if (isCredit) "+" else "-"} ${"%.0f".format(amount)} د.ع",
                                            style = MaterialTheme.typography.labelMedium,
                                            fontWeight = FontWeight.Bold,
                                            color = amountColor,
                                        )
                                    }
                                    if (idx < state.transactions.size - 1)
                                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
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
private fun BalanceChip(label: String, value: Double) {
    Column(
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.2f)).padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
        Text("${"%.0f".format(value)} د.ع", color = Color.White, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold)
    }
}
