package com.inventory.ui.vouchers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
) {
    val state by viewModel.state.collectAsState()
    var customerExpanded by remember { mutableStateOf(false) }
    var typeExpanded by remember { mutableStateOf(false) }

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
                            onClick = { viewModel.onEvent(VoucherEvent.TypeChanged("RECEIPT")) },
                            modifier = Modifier.weight(1f),
                        )
                        VoucherTypeChip(
                            label = "دفع",
                            icon = Icons.Default.ArrowUpward,
                            selected = state.type == "PAYMENT",
                            color = AppColor.Amber600,
                            onClick = { viewModel.onEvent(VoucherEvent.TypeChanged("PAYMENT")) },
                            modifier = Modifier.weight(1f),
                        )
                        VoucherTypeChip(
                            label = "مصروف",
                            icon = Icons.Default.MoneyOff,
                            selected = state.type == "EXPENSE",
                            color = AppColor.Red600,
                            onClick = { viewModel.onEvent(VoucherEvent.TypeChanged("EXPENSE")) },
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
