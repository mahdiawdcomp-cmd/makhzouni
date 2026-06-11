package com.inventory.ui.invoices

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.inventory.domain.model.Invoice
import com.inventory.ui.common.*
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

// â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
//  INVOICE LIST SCREEN
// â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceListScreen(
    viewModel: InvoiceListViewModel,
    onCreate: () -> Unit,
    onOpen: (String) -> Unit,
) {
    val state by viewModel.state.collectAsState()

    AppScreen(
        title = "الفواتير",
        fab = {
            ExtendedFloatingActionButton(
                onClick = onCreate,
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("فاتورة جديدة", fontWeight = FontWeight.SemiBold) },
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
            // â”€â”€ Search + filter bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 1.dp,
            ) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    AppSearchBar(
                        query = state.query,
                        onQueryChange = viewModel::setQuery,
                        placeholder = "بحث برقم الفاتورة أو اسم الزبون",
                    )
                    Spacer(Modifier.height(10.dp))

                    // Filter chips
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("today" to "اليوم", "week" to "الأسبوع", "month" to "الشهر", "all" to "الكل").forEach { (key, label) ->
                            FilterChip(
                                selected = state.filter == key,
                                onClick = { viewModel.setFilter(key) },
                                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                                shape = RoundedCornerShape(8.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf(
                            "dateDesc" to "تاريخ الفاتورة",
                            "totalDesc" to "أعلى مبلغ",
                            "remainingDesc" to "أعلى باقي",
                            "paidDesc" to "أعلى مدفوع",
                            "customer" to "الزبون",
                        ).forEach { (key, label) ->
                            FilterChip(
                                selected = state.sortBy == key,
                                onClick = { viewModel.setSort(key) },
                                label = { Text(label, style = MaterialTheme.typography.labelMedium) },
                                shape = RoundedCornerShape(8.dp),
                            )
                        }
                    }
                }
            }

            // â”€â”€ List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if (state.isLoading) {
                Box(modifier = Modifier.padding(16.dp)) { SkeletonLoading(rows = 6) }
            } else if (state.filteredInvoices.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(
                        icon = Icons.Default.ReceiptLong,
                        title = "لا توجد فواتير",
                        subtitle = if (state.query.isNotBlank())
                            "لم نجد نتائج لـ \"${state.query}\""
                        else "اضغط على + لإنشاء فاتورة جديدة",
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.filteredInvoices, key = { it.id }) { invoice ->
                        InvoiceCard(invoice = invoice, onClick = { onOpen(invoice.id) })
                    }
                }
            }
        }
    }
}

// â”€â”€ Invoice Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@Composable
fun InvoiceCard(invoice: Invoice, onClick: () -> Unit) {
    val isPurchase = invoice.type == "PURCHASE"
    val accentColor = if (isPurchase) AppColor.Amber600 else AppColor.Blue600

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Icon avatar
            IconAvatar(
                icon = if (isPurchase) Icons.Default.ShoppingCart else Icons.Default.Receipt,
                bgColor = accentColor.copy(alpha = 0.12f),
                iconColor = accentColor,
                size = 46.dp,
                iconSize = 22.dp,
            )

            // Content
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = invoice.invoiceNumber,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    val (statusLabel, statusType) = invoiceStatusBadge(invoice.status)
                    StatusBadge(label = statusLabel, type = statusType)
                }
                Text(
                    text = invoice.customerName,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = invoice.date.toDisplayDate(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }

            // Amounts
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = invoice.totalAmount.formatMoney(),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                val (payLabel, payType) = paymentTypeBadge(invoice.paymentType ?: "CREDIT")
                StatusBadge(label = payLabel, type = payType)
                if (invoice.remainingAmount > 0) {
                    Text(
                        text = "متبقي ${invoice.remainingAmount.formatMoney()}",
                        style = MaterialTheme.typography.labelSmall,
                        color = AppColor.Red600,
                        fontSize = 10.sp,
                    )
                }
            }
        }
    }
}

// â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
//  INVOICE CREATE SCREEN
// â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceCreateScreen(
    viewModel: InvoiceCreateViewModel,
    onDone: (String) -> Unit,
    onScanQr: () -> Unit,
    onAddCustomer: () -> Unit,
    onAddProduct: (String) -> Unit = {},
    invoiceId: String? = null,
    onBack: (() -> Unit)? = null,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var paymentExpanded by remember { mutableStateOf(false) }
    val productSearchFocus = remember { FocusRequester() }

    LaunchedEffect(state.savedInvoiceId) {
        state.savedInvoiceId?.let { onDone(it) }
    }
    LaunchedEffect(invoiceId) {
        if (invoiceId != null) viewModel.loadForEdit(invoiceId)
    }

    AppScreen(title = if (invoiceId == null) "فاتورة جديدة" else "تعديل الفاتورة", onBack = onBack) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // â”€â”€ Customer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            item {
                SectionCard(title = "الزبون / المورد", containerColor = AppColor.Blue50) {
                    if (state.selectedCustomer == null) {
                        AppSearchBar(
                            query = state.customerQuery,
                            onQueryChange = viewModel::setCustomerQuery,
                            placeholder = "ابحث عن الزبون...",
                        )
                        if (state.customerSuggestions.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            state.customerSuggestions.forEach { customer ->
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
                        TextButton(onClick = onAddCustomer) {
                            Icon(Icons.Default.PersonAdd, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("إضافة زبون جديد")
                        }
                    } else {
                        val cust = state.selectedCustomer!!
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            TextAvatar(cust.name, AppColor.Blue600, size = 46.dp)
                            Column(Modifier.weight(1f)) {
                                Text(cust.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                Text(cust.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            BalanceChip(cust.currentBalance)
                            IconButton(onClick = { viewModel.setCustomerQuery("") }) {
                                Icon(Icons.Default.Close, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            // â”€â”€ Date + Payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            item {
                SectionCard(title = "معلومات الفاتورة", contentPadding = PaddingValues(10.dp), containerColor = AppColor.Blue50) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                        OutlinedTextField(
                            value = state.date,
                            onValueChange = viewModel::setDate,
                            label = { Text("التاريخ", fontSize = 11.sp) },
                            modifier = Modifier.weight(1.1f),
                            singleLine = true,
                            shape = RoundedCornerShape(8.dp),
                        )
                        ExposedDropdownMenuBox(
                            expanded = paymentExpanded,
                            onExpandedChange = { paymentExpanded = !paymentExpanded },
                            modifier = Modifier.weight(1f),
                        ) {
                            OutlinedTextField(
                                value = when (state.paymentType) {
                                    "CASH" -> "نقد"
                                    "PARTIAL" -> "جزئي"
                                    else -> "آجل"
                                },
                                onValueChange = {},
                                readOnly = true,
                                modifier = Modifier.menuAnchor().fillMaxWidth(),
                                label = { Text("الدفع", fontSize = 11.sp) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(paymentExpanded) },
                                shape = RoundedCornerShape(8.dp),
                            )
                            ExposedDropdownMenu(expanded = paymentExpanded, onDismissRequest = { paymentExpanded = false }) {
                                listOf("CASH" to "نقد", "CREDIT" to "آجل", "PARTIAL" to "جزئي").forEach { (v, label) ->
                                    DropdownMenuItem(text = { Text(label) }, onClick = { viewModel.setPaymentType(v); paymentExpanded = false })
                                }
                            }
                        }
                        OutlinedTextField(
                            value = state.paidAmount,
                            onValueChange = viewModel::setPaid,
                            label = { Text("الواصل", fontSize = 11.sp) },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            shape = RoundedCornerShape(8.dp),
                        )
                    }
                }
            }

            // â”€â”€ Products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            item {
                SectionCard(
                    title = "الأصناف",
                    containerColor = AppColor.Green50,
                    titleAction = {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(
                                selected = state.useRetailPrice,
                                onClick = viewModel::toggleRetailPrice,
                                label = { Text(if (state.useRetailPrice) "مفرد" else "جملة", fontSize = 11.sp) },
                                modifier = Modifier.height(32.dp),
                            )
                            FilterChip(
                                selected = state.showPurchasePrice,
                                onClick = viewModel::togglePurchase,
                                label = { Text("شراء", fontSize = 11.sp) },
                                modifier = Modifier.height(32.dp),
                            )
                            FilterChip(
                                selected = state.showStock,
                                onClick = viewModel::toggleStock,
                                label = { Text("مخزون", fontSize = 11.sp) },
                                modifier = Modifier.height(32.dp),
                            )
                            IconButton(onClick = onScanQr, modifier = Modifier.size(32.dp)) {
                                Icon(Icons.Default.QrCodeScanner, null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                    },
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Product search
                        AppSearchBar(
                            query = state.productQuery,
                            onQueryChange = viewModel::setProductQuery,
                            placeholder = "ابحث عن صنف لإضافته...",
                            modifier = Modifier.focusRequester(productSearchFocus),
                        )
                        state.productSuggestions.forEach { product ->
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                onClick = { viewModel.addProduct(product) },
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    if (!product.imageUrl.isNullOrBlank()) {
                                        AsyncImage(
                                            model = product.imageUrl,
                                            contentDescription = product.name,
                                            modifier = Modifier.size(38.dp).clip(RoundedCornerShape(9.dp)),
                                        )
                                    } else {
                                        Icon(Icons.Default.AddCircleOutline, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                                    }
                                    Column(Modifier.weight(1f)) {
                                        Text(product.name, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                        Text(
                                            buildString {
                                                append(product.itemNumber)
                                                if (state.showStock) append(" · مخزون: ${product.currentStock}")
                                                if (state.showPurchasePrice) append(" · شراء: ${product.purchasePrice.formatMoney()}")
                                            },
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    if (!state.hidePrice) Text(product.salePrice.formatMoney(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        if (state.productQuery.isNotBlank() && state.productSuggestions.isEmpty()) {
                            FilledTonalButton(
                                onClick = viewModel::quickCreateProduct,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("إضافة مادة جديدة: ${state.productQuery.trim()}")
                            }
                        }

                        // Added items
                        if (state.items.isNotEmpty()) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            state.items.forEachIndexed { index, item ->
                                InvoiceItemRow(
                                    item = item,
                                    showPurchasePrice = state.showPurchasePrice,
                                    showStock = state.showStock,
                                    hidePrice = state.hidePrice,
                                    onUnit = { viewModel.updateItem(item.lineId, unit = it) },
                                    onQuantity = { viewModel.updateItem(item.lineId, quantity = it.toIntOrNull() ?: 0) },
                                    onPrice = { viewModel.updateItem(item.lineId, price = it.toDoubleOrNull() ?: item.unitPrice) },
                                    onTotal = { viewModel.updateItemTotal(item.lineId, it.toDoubleOrNull() ?: item.totalPrice) },
                                    onDone = { productSearchFocus.requestFocus() },
                                    onRemove = { viewModel.removeItem(item.lineId) },
                                )
                                if (index < state.items.lastIndex)
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        } else {
                            EmptyState(
                                icon = Icons.Default.ShoppingBag,
                                title = "لا يوجد أصناف",
                                subtitle = "ابحث عن صنف أو امسح الباركود",
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                    }
                }
            }

            // â”€â”€ Financial Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            item {
                SectionCard(title = "الملخص المالي", contentPadding = PaddingValues(12.dp), containerColor = AppColor.Amber50) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryRow("مجموع الفاتورة", "${state.subtotal.formatMoney()} IQD", bold = true)
                        SummaryRow("الواصل", "${state.paid.formatMoney()} IQD", valueColor = AppColor.Green600)
                        SummaryRow("الباقي", "${state.remaining.formatMoney()} IQD", valueColor = if (state.remaining > 0) AppColor.Red600 else AppColor.Green600, bold = true)
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SummaryRow("الحساب السابق", "${state.previousBalance.formatMoney()} IQD")
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.primaryContainer,
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("الحساب النهائي", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                Text("${state.finalBalance.formatMoney()} IQD", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, color = if (state.finalBalance > 0) AppColor.Red600 else AppColor.Green600)
                            }
                        }
                    }
                }
            }

            // â”€â”€ Errors & messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if (state.error != null) {
                item {
                    Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Red50) {
                        Row(modifier = Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.ErrorOutline, null, tint = AppColor.Red600, modifier = Modifier.size(18.dp))
                            Text(state.error!!, style = MaterialTheme.typography.bodySmall, color = AppColor.Red600)
                        }
                    }
                }
            }
            if (state.queuedMessage != null) {
                item {
                    Surface(shape = RoundedCornerShape(10.dp), color = AppColor.Amber50) {
                        Text(state.queuedMessage!!, style = MaterialTheme.typography.bodySmall, color = AppColor.Amber600, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            // â”€â”€ Action Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = viewModel::save,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        enabled = !state.isSaving && state.selectedCustomer != null && state.items.isNotEmpty() && state.total >= 0,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        if (state.isSaving) {
                            CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Check, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(if (invoiceId == null) "حفظ الفاتورة" else "تحديث الفاتورة", fontWeight = FontWeight.SemiBold)
                        }
                    }
                    // WhatsApp
                    if (state.selectedCustomer != null) {
                        OutlinedButton(
                            onClick = { sendWhatsApp(context, state.selectedCustomer!!.phone, "فاتورتك رقم ${state.invoiceNumber} بمبلغ ${state.total.formatMoney()} IQD") },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.Share, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("إرسال واتساب")
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// â”€â”€ Invoice Item Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvoiceItemRow(
    item: InvoiceDraftItem,
    showPurchasePrice: Boolean,
    showStock: Boolean,
    hidePrice: Boolean = false,
    onUnit: (String) -> Unit,
    onQuantity: (String) -> Unit,
    onPrice: (String) -> Unit,
    onTotal: (String) -> Unit,
    onDone: () -> Unit,
    onRemove: () -> Unit,
) {
    var unitExpanded by remember { mutableStateOf(false) }
    val quantityFocus = remember { FocusRequester() }
    val priceFocus = remember { FocusRequester() }
    val totalFocus = remember { FocusRequester() }
    val quantityInPieces = when (item.unit) {
        "CARTON" -> item.quantity * item.product.pcsPerCarton
        "DOZEN" -> item.quantity * 12
        else -> item.quantity
    }
    val hasNegativeStock = item.product.currentStock < 0 || item.product.currentStock - quantityInPieces < 0

    LaunchedEffect(item.lineId) {
        if (item.quantity == 0) quantityFocus.requestFocus()
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!item.product.imageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = item.product.imageUrl,
                    contentDescription = item.product.name,
                    modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)),
                )
                Spacer(Modifier.width(10.dp))
            }
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(item.product.name, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (hasNegativeStock) {
                        Surface(shape = RoundedCornerShape(6.dp), color = AppColor.Amber50) {
                            Text("رصيد سالب", modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp), color = AppColor.Amber600, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Text(
                    buildString {
                        append(item.product.itemNumber)
                        if (showStock) append(" · المتوفر: ${item.product.currentStock}")
                        if (showPurchasePrice) append(" · الشراء: ${item.product.purchasePrice.formatMoney()}")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp
                )
            }
            IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.DeleteOutline, null, tint = AppColor.Red600, modifier = Modifier.size(18.dp))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Unit
            ExposedDropdownMenuBox(expanded = unitExpanded, onExpandedChange = { unitExpanded = !unitExpanded }, modifier = Modifier.weight(1f)) {
                OutlinedTextField(
                    value = when (item.unit) { "DOZEN" -> "درزن"; "CARTON" -> "كرتونة"; else -> "قطعة" },
                    onValueChange = {}, readOnly = true,
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                    label = { Text("الوحدة", fontSize = 11.sp) },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(unitExpanded) },
                    shape = RoundedCornerShape(8.dp),
                )
                ExposedDropdownMenu(expanded = unitExpanded, onDismissRequest = { unitExpanded = false }) {
                    listOf("PIECE" to "قطعة", "DOZEN" to "درزن", "CARTON" to "كرتونة").forEach { (v, label) ->
                        DropdownMenuItem(text = { Text(label) }, onClick = { onUnit(v); unitExpanded = false })
                    }
                }
            }
            // Quantity
            OutlinedTextField(
                value = if (item.quantity == 0) "" else item.quantity.toString(),
                onValueChange = onQuantity,
                modifier = Modifier.width(80.dp).focusRequester(quantityFocus),
                label = { Text("العدد", fontSize = 11.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { priceFocus.requestFocus() }),
                shape = RoundedCornerShape(8.dp),
            )
            if (!hidePrice) {
                // Price
                OutlinedTextField(
                    value = item.unitPrice.toString(), onValueChange = onPrice,
                    modifier = Modifier.weight(1f).focusRequester(priceFocus),
                    label = { Text("السعر", fontSize = 11.sp) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { totalFocus.requestFocus() }),
                    shape = RoundedCornerShape(8.dp),
                )
            }
        }
        if (!hidePrice) {
            OutlinedTextField(
                value = item.totalPrice.toString(),
                onValueChange = onTotal,
                modifier = Modifier.fillMaxWidth().focusRequester(totalFocus),
                label = { Text("الإجمالي", fontSize = 11.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onDone() }),
                shape = RoundedCornerShape(8.dp),
            )
        }
    }
}
