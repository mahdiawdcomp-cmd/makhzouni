package com.inventory.ui.vouchers

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.inventory.ui.common.*
import com.inventory.ui.theme.AppColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoucherCreateScreen(
    viewModel: VoucherViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    onBack: () -> Unit,
    voucherId: String? = null,
) {
    val state by viewModel.state.collectAsState()
    var customerExpanded by remember { mutableStateOf(false) }
    var typeExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(voucherId) {
        if (voucherId != null) viewModel.loadVoucher(voucherId)
    }

    // Success dialog
    if (state.success) {
        AlertDialog(
            onDismissRequest = { viewModel.onEvent(VoucherEvent.DismissSuccess); onBack() },
            icon = { Icon(Icons.Default.CheckCircle, null, tint = AppColor.Green600) },
            title = { Text("تم الحفظ بنجاح", textAlign = TextAlign.Center) },
            text = { Text("تم إنشاء السند بنجاح.", textAlign = TextAlign.Center) },
            confirmButton = {
                Button(onClick = { viewModel.onEvent(VoucherEvent.DismissSuccess); onBack() }) {
                    Text("موافق")
                }
            },
        )
    }

    // Error dialog
    if (state.error != null) {
        AlertDialog(
            onDismissRequest = { viewModel.onEvent(VoucherEvent.DismissError) },
            icon = { Icon(Icons.Default.ErrorOutline, null, tint = AppColor.Red600) },
            title = { Text("خطأ") },
            text = { Text(state.error ?: "") },
            confirmButton = {
                TextButton(onClick = { viewModel.onEvent(VoucherEvent.DismissError) }) { Text("حسناً") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (state.type) {
                            "RECEIPT" -> "سند قبض جديد"
                            "PAYMENT" -> "سند دفع جديد"
                            "EXPENSE" -> "مصروف جديد"
                            else      -> "سند جديد"
                        },
                        fontWeight = FontWeight.Bold,
                    )
                },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "رجوع") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── Voucher type selector ────────────────────────────────
            item {
                SectionCard(title = "نوع السند") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        VoucherTypeChip(
                            label = "قبض",
                            icon = Icons.Default.ArrowDownward,
                            selected = state.type == "RECEIPT",
                            color = AppColor.Green600,
                            onClick = { if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("RECEIPT")) },
                            modifier = Modifier.weight(1f),
                        )
                        VoucherTypeChip(
                            label = "دفع",
                            icon = Icons.Default.ArrowUpward,
                            selected = state.type == "PAYMENT",
                            color = AppColor.Amber600,
                            onClick = { if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("PAYMENT")) },
                            modifier = Modifier.weight(1f),
                        )
                        VoucherTypeChip(
                            label = "مصروف",
                            icon = Icons.Default.MoneyOff,
                            selected = state.type == "EXPENSE",
                            color = AppColor.Red600,
                            onClick = { if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("EXPENSE")) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            // ── EXPENSE: description only ────────────────────────────
            if (state.isExpense) {
                item {
                    SectionCard(title = "وصف المصروف") {
                        AppTextField(
                            value = state.description,
                            onValueChange = { viewModel.onEvent(VoucherEvent.DescriptionChanged(it)) },
                            label = "نوع المصروف",
                            placeholder = "مثال: أجور موظفين، فاتورة كهرباء...",
                            required = true,
                            singleLine = false,
                        )
                    }
                }
            } else {
                // ── Customer picker ──────────────────────────────────
                item {
                    SectionCard(title = "الزبون") {
                        ExposedDropdownMenuBox(expanded = customerExpanded, onExpandedChange = { customerExpanded = !customerExpanded }) {
                            val selectedName = state.customers.find { it.id == state.selectedCustomerId }?.name ?: ""
                            OutlinedTextField(
                                value = selectedName,
                                onValueChange = {},
                                readOnly = true,
                                modifier = Modifier.menuAnchor().fillMaxWidth(),
                                label = { Text("اختر الزبون") },
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(customerExpanded) },
                                shape = RoundedCornerShape(10.dp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                                    unfocusedBorderColor = MaterialTheme.colorScheme.outline,
                                ),
                            )
                            ExposedDropdownMenu(expanded = customerExpanded, onDismissRequest = { customerExpanded = false }) {
                                state.customers.forEach { cust ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(cust.name, fontWeight = FontWeight.Medium)
                                                Text(cust.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                        },
                                        leadingIcon = { TextAvatar(cust.name, AppColor.Blue600, size = 32.dp) },
                                        trailingIcon = { BalanceChip(cust.currentBalance) },
                                        onClick = {
                                            viewModel.onEvent(VoucherEvent.CustomerChanged(cust.id))
                                            customerExpanded = false
                                        },
                                    )
                                }
                            }
                        }

                        // Show balance of selected customer
                        state.customers.find { it.id == state.selectedCustomerId }?.let { cust ->
                            Spacer(Modifier.height(8.dp))
                            Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text("الرصيد الحالي", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    BalanceChip(cust.currentBalance)
                                }
                            }
                        }
                    }
                }
            }

            // ── Amount + Date + Notes ────────────────────────────────
            item {
                SectionCard(title = "تفاصيل السند") {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        AppTextField(
                            value = state.date,
                            onValueChange = { viewModel.onEvent(VoucherEvent.DateChanged(it)) },
                            label = "التاريخ",
                            placeholder = "yyyy-MM-dd",
                        )
                        AppTextField(
                            value = state.amount,
                            onValueChange = { viewModel.onEvent(VoucherEvent.AmountChanged(it)) },
                            label = "المبلغ",
                            required = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        AppTextField(
                            value = state.notes,
                            onValueChange = { viewModel.onEvent(VoucherEvent.NotesChanged(it)) },
                            label = "ملاحظات",
                            singleLine = false,
                        )
                    }
                }
            }

            // ── Save button ──────────────────────────────────────────
            item {
                val (btnColor, btnIcon) = when (state.type) {
                    "RECEIPT" -> AppColor.Green600 to Icons.Default.ArrowDownward
                    "PAYMENT" -> AppColor.Amber600 to Icons.Default.ArrowUpward
                    else      -> AppColor.Red600   to Icons.Default.MoneyOff
                }
                Button(
                    onClick = { viewModel.onEvent(VoucherEvent.Submit) },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    enabled = !state.isLoading,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = btnColor),
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Icon(btnIcon, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            when (state.type) {
                                "RECEIPT" -> "حفظ سند القبض"
                                "PAYMENT" -> "حفظ سند الدفع"
                                else      -> "حفظ المصروف"
                            },
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoucherListScreen(
    viewModel: VoucherListViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onNew: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    // Delete confirmation dialog
    if (state.deleteConfirmId != null) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelDelete() },
            icon = { Icon(Icons.Default.Delete, null, tint = AppColor.Red600) },
            title = { Text("حذف السند", textAlign = TextAlign.Center) },
            text = { Text("هل أنت متأكد من حذف هذا السند؟ لا يمكن التراجع.") },
            confirmButton = {
                Button(
                    onClick = { viewModel.executeDelete() },
                    enabled = !state.deleteLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600),
                ) {
                    if (state.deleteLoading) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("حذف")
                }
            },
            dismissButton = { TextButton(onClick = { viewModel.cancelDelete() }) { Text("إلغاء") } }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("السندات") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, null) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                actions = {
                    IconButton(onClick = { viewModel.load() }) {
                        Icon(Icons.Default.Refresh, "تحديث")
                    }
                }
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onNew,
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("سند جديد") },
                containerColor = AppColor.Green600,
                contentColor = Color.White,
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Type filter chips
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(null to "الكل", "RECEIPT" to "قبض", "PAYMENT" to "دفع", "EXPENSE" to "مصاريف").forEach { (type, label) ->
                    FilterChip(
                        selected = state.typeFilter == type,
                        onClick = { viewModel.load(type) },
                        label = { Text(label) },
                    )
                }
            }

            if (state.isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (state.error != null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(state.error ?: "", color = AppColor.Red600)
                }
            } else if (state.vouchers.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("لا توجد سندات", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    itemsIndexed(state.vouchers) { _, voucher ->
                        val (color, typeLabel) = when (voucher.type) {
                            "RECEIPT" -> AppColor.Green600 to "قبض"
                            "PAYMENT" -> AppColor.Amber600 to "دفع"
                            else      -> AppColor.Red600 to "مصاريف"
                        }
                        Card(
                            shape = RoundedCornerShape(12.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                // Type badge
                                Box(
                                    modifier = Modifier.size(44.dp).background(color.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(typeLabel, color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                                }
                                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(voucher.voucherNumber, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                    Text(voucher.customerName ?: voucher.description ?: "—", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(voucher.date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        "%,.0f".format(voucher.amount),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = color
                                    )
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        IconButton(onClick = { onEdit(voucher.id) }, modifier = Modifier.size(32.dp)) {
                                            Icon(Icons.Default.Edit, "تعديل", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                                        }
                                        IconButton(onClick = { viewModel.confirmDelete(voucher.id) }, modifier = Modifier.size(32.dp)) {
                                            Icon(Icons.Default.Delete, "حذف", modifier = Modifier.size(16.dp), tint = AppColor.Red600)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }
}

@Composable
private fun VoucherTypeChip(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bg  = if (selected) color else MaterialTheme.colorScheme.surfaceVariant
    val fg  = if (selected) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
    val brd = if (selected) color else MaterialTheme.colorScheme.outline

    OutlinedCard(
        modifier = modifier,
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, brd),
        colors = CardDefaults.outlinedCardColors(containerColor = bg),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, color = fg, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal)
        }
    }
}
