package com.inventory.ui.vouchers

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MoneyOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.inventory.domain.model.Voucher
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.BalanceChip
import com.inventory.ui.common.EmptyState
import com.inventory.ui.common.ListRow
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.SummaryRow
import com.inventory.ui.common.TextAvatar
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoucherCreateScreen(
    viewModel: VoucherViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    onBack: () -> Unit,
    voucherId: String? = null,
) {
    val state by viewModel.state.collectAsState()
    val amountFocus = remember { FocusRequester() }

    LaunchedEffect(voucherId) {
        if (voucherId != null) viewModel.loadVoucher(voucherId)
    }

    if (state.success) {
        AlertDialog(
            onDismissRequest = { viewModel.onEvent(VoucherEvent.DismissSuccess); onBack() },
            icon = { Icon(Icons.Default.CheckCircle, null, tint = AppColor.Green600) },
            title = { Text("تم الحفظ بنجاح", textAlign = TextAlign.Center) },
            text = { Text(if (voucherId == null) "تم إنشاء السند وتحديث الحساب." else "تم تحديث السند وتحديث الحساب.", textAlign = TextAlign.Center) },
            confirmButton = {
                Button(onClick = { viewModel.onEvent(VoucherEvent.DismissSuccess); onBack() }) { Text("تم") }
            },
        )
    }

    if (state.error != null) {
        AlertDialog(
            onDismissRequest = { viewModel.onEvent(VoucherEvent.DismissError) },
            icon = { Icon(Icons.Default.ErrorOutline, null, tint = AppColor.Red600) },
            title = { Text("تنبيه") },
            text = { Text(state.error.orEmpty()) },
            confirmButton = {
                TextButton(onClick = { viewModel.onEvent(VoucherEvent.DismissError) }) { Text("حسنا") }
            },
        )
    }

    AppScreen(
        title = when (state.type) {
            "PAYMENT" -> if (voucherId == null) "سند دفع جديد" else "تعديل سند دفع"
            "EXPENSE" -> if (voucherId == null) "مصروف جديد" else "تعديل مصروف"
            else -> if (voucherId == null) "سند قبض جديد" else "تعديل سند قبض"
        },
        onBack = onBack
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                VoucherHero(state.type, state.amount)
            }

            item {
                SectionCard(
                    title = "نوع السند",
                    contentPadding = PaddingValues(12.dp),
                    accentColor = MaterialTheme.colorScheme.primary
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        VoucherTypeChip("قبض", Icons.Default.ArrowDownward, state.type == "RECEIPT", AppColor.Green600, Modifier.weight(1f)) {
                            if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("RECEIPT"))
                        }
                        VoucherTypeChip("دفع", Icons.Default.ArrowUpward, state.type == "PAYMENT", AppColor.Amber600, Modifier.weight(1f)) {
                            if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("PAYMENT"))
                        }
                        VoucherTypeChip("مصروف", Icons.Default.MoneyOff, state.type == "EXPENSE", AppColor.Red600, Modifier.weight(1f)) {
                            if (voucherId == null) viewModel.onEvent(VoucherEvent.TypeChanged("EXPENSE"))
                        }
                    }
                }
            }

            if (state.isExpense) {
                item {
                    SectionCard(
                        title = "وصف المصروف",
                        containerColor = MaterialTheme.colorScheme.surface,
                        accentColor = AppColor.Red600
                    ) {
                        OutlinedTextField(
                            value = state.description,
                            onValueChange = { viewModel.onEvent(VoucherEvent.DescriptionChanged(it)) },
                            label = { Text("نوع المصروف") },
                            placeholder = { Text("مثال: أجور، كهرباء، نقل") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = { amountFocus.requestFocus() }),
                            shape = RoundedCornerShape(10.dp)
                        )
                    }
                }
            } else {
                item {
                    SectionCard(
                        title = "الزبون",
                        containerColor = MaterialTheme.colorScheme.surface,
                        accentColor = AppColor.Blue500
                    ) {
                        if (state.selectedCustomer == null) {
                            OutlinedTextField(
                                value = state.customerQuery,
                                onValueChange = { viewModel.onEvent(VoucherEvent.CustomerQueryChanged(it)) },
                                label = { Text("بحث باسم الزبون أو الرقم") },
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = {
                                    state.customerSuggestions.firstOrNull()?.let {
                                        viewModel.onEvent(VoucherEvent.CustomerChanged(it.id))
                                        amountFocus.requestFocus()
                                    }
                                }),
                                shape = RoundedCornerShape(10.dp)
                            )
                            state.customerSuggestions.forEach { customer ->
                                ListRow(
                                    title = customer.name,
                                    subtitle = customer.phone,
                                    leading = { TextAvatar(customer.name, AppColor.Blue600, size = 36.dp) },
                                    trailing = { BalanceChip(customer.currentBalance) },
                                    onClick = {
                                        viewModel.onEvent(VoucherEvent.CustomerChanged(customer.id))
                                        amountFocus.requestFocus()
                                    }
                                )
                            }
                        } else {
                            val customer = state.selectedCustomer!!
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                TextAvatar(customer.name, AppColor.Blue600)
                                Column(Modifier.weight(1f)) {
                                    Text(customer.name, fontWeight = FontWeight.Bold)
                                    Text(customer.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                BalanceChip(customer.currentBalance)
                                TextButton(onClick = { viewModel.onEvent(VoucherEvent.CustomerQueryChanged("")) }) { Text("تغيير") }
                            }
                        }
                    }
                }
            }

            item {
                SectionCard(
                    title = "المبلغ والتفاصيل",
                    containerColor = MaterialTheme.colorScheme.surface,
                    accentColor = AppColor.Green600
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = state.date,
                                onValueChange = { viewModel.onEvent(VoucherEvent.DateChanged(it)) },
                                label = { Text("التاريخ") },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                readOnly = true,
                                shape = RoundedCornerShape(10.dp)
                            )
                            OutlinedTextField(
                                value = state.amount,
                                onValueChange = { viewModel.onEvent(VoucherEvent.AmountChanged(it)) },
                                label = { Text("المبلغ") },
                                suffix = { Text("IQD") },
                                modifier = Modifier.weight(1.1f).focusRequester(amountFocus),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                                shape = RoundedCornerShape(10.dp)
                            )
                        }
                        OutlinedTextField(
                            value = state.notes,
                            onValueChange = { viewModel.onEvent(VoucherEvent.NotesChanged(it)) },
                            label = { Text("ملاحظات") },
                            modifier = Modifier.fillMaxWidth(),
                            minLines = 2,
                            shape = RoundedCornerShape(10.dp)
                        )
                    }
                }
            }

            item {
                val saveColor = when (state.type) {
                    "PAYMENT" -> AppColor.Amber600
                    "EXPENSE" -> AppColor.Red600
                    else -> AppColor.Green600
                }
                Button(
                    onClick = { viewModel.onEvent(VoucherEvent.Submit) },
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    enabled = !state.isLoading,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = saveColor)
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.CheckCircle, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (voucherId == null) "حفظ السند" else "تحديث السند", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
fun VoucherListScreen(
    viewModel: VoucherListViewModel = androidx.hilt.navigation.compose.hiltViewModel(),
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onNew: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val lifecycleOwner = LocalLifecycleOwner.current

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                viewModel.load()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    if (state.deleteConfirmId != null) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelDelete() },
            icon = { Icon(Icons.Default.Delete, null, tint = AppColor.Red600) },
            title = { Text("حذف السند", textAlign = TextAlign.Center) },
            text = { Text("سيتم أرشفة السند وإلغاء أثره من الحساب. هل تريد المتابعة؟") },
            confirmButton = {
                Button(
                    onClick = { viewModel.executeDelete() },
                    enabled = !state.deleteLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600)
                ) {
                    if (state.deleteLoading) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("حذف")
                }
            },
            dismissButton = { TextButton(onClick = { viewModel.cancelDelete() }) { Text("إلغاء") } }
        )
    }

    AppScreen(
        title = "السندات",
        onBack = onBack,
        actions = {
            IconButton(onClick = { viewModel.load() }) { Icon(Icons.Default.Refresh, "تحديث") }
        },
        fab = {
            ExtendedFloatingActionButton(
                onClick = onNew,
                icon = { Icon(Icons.Default.Add, null) },
                text = { Text("سند جديد") },
                containerColor = AppColor.Green600,
                contentColor = Color.White
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background)) {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(null to "الكل", "RECEIPT" to "قبض", "PAYMENT" to "دفع", "EXPENSE" to "مصروف").forEach { (type, label) ->
                    FilterChip(selected = state.typeFilter == type, onClick = { viewModel.load(type) }, label = { Text(label) })
                }
            }

            when {
                state.isLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(Icons.Default.ErrorOutline, "تعذر تحميل السندات", state.error)
                }
                state.vouchers.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(Icons.Default.ConfirmationNumber, "لا توجد سندات", "اضغط سند جديد لإضافة أول سند")
                }
                else -> LazyColumn(
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(state.vouchers, key = { it.id }) { voucher ->
                        VoucherCard(voucher, onEdit = { onEdit(voucher.id) }, onDelete = { viewModel.confirmDelete(voucher.id) })
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
        }
    }
}

@Composable
private fun VoucherHero(type: String, amount: String) {
    val color = when (type) {
        "PAYMENT" -> AppColor.Amber600
        "EXPENSE" -> AppColor.Red600
        else -> AppColor.Green600
    }
    val label = when (type) {
        "PAYMENT" -> "سند دفع"
        "EXPENSE" -> "مصروف"
        else -> "سند قبض"
    }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, color.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    Modifier
                        .size(42.dp)
                        .background(color.copy(alpha = 0.14f), RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        when (type) {
                            "PAYMENT" -> Icons.Default.ArrowUpward
                            "EXPENSE" -> Icons.Default.MoneyOff
                            else -> Icons.Default.ArrowDownward
                        },
                        null,
                        tint = color
                    )
                }
                Column {
                    Text(label, color = color, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "تحديث حساب مباشر",
                        color = MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            Text(
                "${amount.ifBlank { "0" }} IQD",
                color = color,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.ExtraBold
            )
        }
    }
}

@Composable
private fun VoucherCard(voucher: Voucher, onEdit: () -> Unit, onDelete: () -> Unit) {
    val (color, typeLabel, icon) = when (voucher.type) {
        "PAYMENT" -> Triple(AppColor.Amber600, "دفع", Icons.Default.ArrowUpward)
        "EXPENSE" -> Triple(AppColor.Red600, "مصروف", Icons.Default.MoneyOff)
        else -> Triple(AppColor.Green600, "قبض", Icons.Default.ArrowDownward)
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(1.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(44.dp).background(color.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, null, tint = color)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(voucher.voucherNumber, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(voucher.customerName ?: voucher.description ?: typeLabel, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(voucher.date.take(10), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("${voucher.amount.formatMoney()} IQD", color = color, fontWeight = FontWeight.ExtraBold)
                Row {
                    IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Edit, "تعديل", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp)) }
                    IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Delete, "حذف", tint = AppColor.Red600, modifier = Modifier.size(18.dp)) }
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
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    OutlinedCard(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, if (selected) color else MaterialTheme.colorScheme.outline),
        colors = CardDefaults.outlinedCardColors(containerColor = if (selected) color.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surface)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
            Text(label, color = if (selected) color else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
        }
    }
}
