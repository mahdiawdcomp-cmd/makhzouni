package com.inventory.ui.invoices

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inventory.domain.model.Invoice
import com.inventory.ui.common.*
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INVOICE LIST SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
            // ── Search + filter bar ──────────────────────────────────
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
                }
            }

            // ── List ─────────────────────────────────────────────────
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

// ── Invoice Card ────────────────────────────────────────────────────────────────
@Composable
fun InvoiceCard(invoice: Invoice, onClick: () -> Unit) {
    val isPurchase = invoice.paymentType == "PURCHASE"
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
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INVOICE CREATE SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InvoiceCreateScreen(
    viewModel: InvoiceCreateViewModel,
    onDone: (String) -> Unit,
    onScanQr: () -> Unit,
    onAddCustomer: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var paymentExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(state.savedInvoiceId) {
        state.savedInvoiceId?.let { onDone(it) }
    }

    AppScreen(title = "فاتورة جديدة", onBack = null) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── Customer ─────────────────────────────────────────
            item {
                SectionCard(title = "الزبون / المورّد") {
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

            // ── Date + Payment ─────────────────────────────────────
            item {
                SectionCard(title = "معلومات الفاتورة") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        AppTextField(
                            value = state.date,
                            onValueChange = viewModel::setDate,
                            label = "التاريخ",
                            placeholder = "YYYY-MM-DD",
                        )

                        FormField(label = "طريقة الدفع") {
                            ExposedDropdownMenuBox(
                                expanded = paymentExpanded,
                                onExpandedChange = { paymentExpanded = !paymentExpanded },
                            ) {
                                OutlinedTextField(
                                    value = when (state.paymentType) {
                                        "CASH" -> "نقد كامل"; "PARTIAL" -> "دفع جزئي"; else -> "آجل"
                                    },
                                    onValueChange = {},
                                    readOnly = true,
                                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(paymentExpanded) },
                                    shape = RoundedCornerShape(10.dp),
                                )
                                ExposedDropdownMenu(expanded = paymentExpanded, onDismissRequest = { paymentExpanded = false }) {
                                    listOf("CASH" to "نقد كامل", "CREDIT" to "آجل", "PARTIAL" to "دفع جزئي").forEach { (v, label) ->
                                        DropdownMenuItem(
                                            text = { Text(label) },
                                            onClick = { viewModel.setPaymentType(v); paymentExpanded = false },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ── Products ────────────────────────────────────────────
            item {
                SectionCard(
                    title = "الأصناف",
                    titleAction = {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
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
                                    Icon(Icons.Default.AddCircleOutline, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(product.name, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                                        Text("${product.itemNumber} · مخزون: ${product.currentStock}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Text(product.salePrice.formatMoney(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }

                        // Added items
                        if (state.items.isNotEmpty()) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            state.items.forEachIndexed { index, item ->
                                InvoiceItemRow(
                                    item = item,
                                    onUnit = { viewModel.updateItem(item.product.id, unit = it) },
                                    onQuantity = { viewModel.updateItem(item.product.id, quantity = it.toIntOrNull() ?: 1) },
                                    onPrice = { viewModel.updateItem(item.product.id, price = it.toDoubleOrNull() ?: item.unitPrice) },
                                    onRemove = { viewModel.removeItem(item.product.id) },
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

            // ── Financial Summary ────────────────────────────────────
            item {
                SectionCard(title = "الملخص المالي") {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryRow("مجموع الفاتورة", "${state.subtotal.formatMoney()} IQD")
                        // Discount
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("الخصم", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            OutlinedTextField(
                                value = state.discountValue,
                                onValueChange = viewModel::setDiscount,
                                modifier = Modifier.width(110.dp),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                shape = RoundedCornerShape(8.dp),
                            )
                        }
                        // Tax
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("الضريبة", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            OutlinedTextField(
                                value = state.tax,
                                onValueChange = viewModel::setTax,
                                modifier = Modifier.width(110.dp),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                shape = RoundedCornerShape(8.dp),
                            )
                        }

                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SummaryRow("الإجمالي بعد الخصم", "${state.total.formatMoney()} IQD", bold = true)

                        // Paid
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("المبلغ الواصل", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                            OutlinedTextField(
                                value = state.paidAmount,
                                onValueChange = viewModel::setPaid,
                                modifier = Modifier.width(110.dp),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                shape = RoundedCornerShape(8.dp),
                            )
                        }
                        SummaryRow("الباقي من الفاتورة", "${state.remaining.formatMoney()} IQD", valueColor = if (state.remaining > 0) AppColor.Red600 else AppColor.Green600)

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

            // ── Errors & messages ────────────────────────────────────
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

            // ── Action Buttons ────────────────────────────────────────
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
                            Text("حفظ الفاتورة", fontWeight = FontWeight.SemiBold)
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

// ── Invoice Item Row ─────────────────────────────────────────────────────────────
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvoiceItemRow(
    item: InvoiceDraftItem,
    onUnit: (String) -> Unit,
    onQuantity: (String) -> Unit,
    onPrice: (String) -> Unit,
    onRemove: () -> Unit,
) {
    var unitExpanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(item.product.name, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${item.product.itemNumber} · المتوفر: ${item.product.currentStock}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
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
                value = item.quantity.toString(), onValueChange = onQuantity,
                modifier = Modifier.width(80.dp),
                label = { Text("العدد", fontSize = 11.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                shape = RoundedCornerShape(8.dp),
            )
            // Price
            OutlinedTextField(
                value = item.unitPrice.toString(), onValueChange = onPrice,
                modifier = Modifier.weight(1f),
                label = { Text("السعر", fontSize = 11.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                shape = RoundedCornerShape(8.dp),
            )
        }
        // Total line
        Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)) {
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("الإجمالي", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${item.totalPrice.formatMoney()} IQD", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
