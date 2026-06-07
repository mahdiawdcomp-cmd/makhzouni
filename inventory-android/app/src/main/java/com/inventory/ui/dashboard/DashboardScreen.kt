package com.inventory.ui.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Pending
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inventory.data.remote.dto.OrderPreparationDto
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.SkeletonLoading
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    onUsers: () -> Unit,
    onApprovals: () -> Unit,
    onProducts: () -> Unit,
    onCustomers: () -> Unit,
    onInvoices: () -> Unit,
    onVouchers: () -> Unit,
    onNotifications: () -> Unit,
    onDashboardReport: () -> Unit,
    onReports: () -> Unit,
    onSettings: () -> Unit,
    onAccountLookup: () -> Unit = {},
    onVoiceInvoice: () -> Unit = {},
    onAgent: () -> Unit = {},
    onCatalogManagement: () -> Unit = {},
    onOperations: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val report = state.report

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Ù…Ø®Ø²ÙˆÙ†ÙŠ", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Text("Ù„ÙˆØ­Ø© Ø§Ù„Ø¹Ù…Ù„", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    BadgedBox(
                        badge = {
                            if (state.unreadNotifications > 0) {
                                Badge(containerColor = AppColor.Red600) { Text(state.unreadNotifications.toString(), fontSize = 9.sp) }
                            }
                        }
                    ) {
                        IconButton(onClick = onNotifications) { Icon(Icons.Default.Notifications, "Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª") }
                    }
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                if (report == null) {
                    SkeletonLoading(rows = 2)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricCard("Ù…Ø¨ÙŠØ¹Ø§Øª Ø§Ù„ÙŠÙˆÙ…", report.todaySales.formatMoney(), Icons.Default.TrendingUp, AppColor.Blue600, Modifier.weight(1f), onDashboardReport)
                            MetricCard("ÙÙˆØ§ØªÙŠØ± Ø§Ù„ÙŠÙˆÙ…", report.todayInvoices.toString(), Icons.Default.ReceiptLong, AppColor.Green600, Modifier.weight(1f), onInvoices)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricCard("Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø¯ÙŠÙˆÙ†", report.totalDebts.formatMoney(), Icons.Default.AccountBalance, AppColor.Amber600, Modifier.weight(1f), onCustomers)
                            MetricCard("Ù…Ø®Ø²ÙˆÙ† Ù…Ù†Ø®ÙØ¶", report.lowStockProducts.toString(), Icons.Default.Warning, AppColor.Red600, Modifier.weight(1f), onProducts)
                        }
                    }
                }
            }

            if (state.pendingOrders.isNotEmpty()) {
                item { PendingOrdersSection(state.pendingOrders) { viewModel.markPrepared(it) } }
            }

            item {
                SectionCard(title = "Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª Ø³Ø±ÙŠØ¹Ø©") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª", Icons.Default.AccountTree, Color(0xFF0F766E), Modifier.weight(1f), onOperations)
                            QuickActionBtn("ÙØ§ØªÙˆØ±Ø© Ø¨ÙŠØ¹", Icons.Default.Receipt, AppColor.Green600, Modifier.weight(1f), onInvoices)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("Ø³Ù†Ø¯ Ù‚Ø¨Ø¶/Ø¯ÙØ¹", Icons.Default.Payments, AppColor.Blue600, Modifier.weight(1f), onVouchers)
                            QuickActionBtn("ÙƒØ´Ù Ø­Ø³Ø§Ø¨", Icons.Default.AccountBalance, AppColor.Purple600, Modifier.weight(1f), onAccountLookup)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("Ø§Ù„Ù…Ø®Ø²Ù†", Icons.Default.Inventory2, AppColor.Gray700, Modifier.weight(1f), onProducts)
                            QuickActionBtn("Ø§Ù„ÙƒØªÙ„ÙˆÙƒ", Icons.Default.Storefront, AppColor.Sky500, Modifier.weight(1f), onCatalogManagement)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("ÙØ§ØªÙˆØ±Ø© ØµÙˆØªÙŠØ©", Icons.Default.Mic, Color(0xFF6366F1), Modifier.weight(1f), onVoiceInvoice)
                            QuickActionBtn("Ø§Ù„Ù…Ø³Ø§Ø¹Ø¯ Ø§Ù„Ø°ÙƒÙŠ", Icons.Default.SmartToy, Color(0xFF7C3AED), Modifier.weight(1f), onAgent)
                        }
                    }
                }
            }

            if (state.canManageUsers || state.canApprove) {
                item {
                    SectionCard(title = "Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù†Ø¸Ø§Ù…") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (state.canManageUsers) QuickActionBtn("Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ†", Icons.Default.People, AppColor.Blue600, Modifier.weight(1f), onUsers)
                                if (state.canApprove) QuickActionBtn("Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø§Øª", Icons.Default.Pending, AppColor.Amber600, Modifier.weight(1f), onApprovals)
                            }
                            QuickActionBtn("Ø§Ù„ØªÙ‚Ø§Ø±ÙŠØ±", Icons.Default.ReceiptLong, AppColor.Gray700, Modifier.fillMaxWidth(), onReports)
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun PendingOrdersSection(orders: List<OrderPreparationDto>, onMarkPrepared: (String) -> Unit) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = AppColor.Amber50),
        border = BorderStroke(1.dp, AppColor.Amber600.copy(alpha = 0.35f))
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.PendingActions, null, tint = AppColor.Amber600)
                Text("طلبات كتلوك تحتاج تجهيز (${orders.size})", fontWeight = FontWeight.Bold, color = AppColor.Amber600)
            }
            orders.take(3).forEach { order ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(order.customerName, fontWeight = FontWeight.SemiBold)
                        Text("${order.items.size} صنف | فاتورة ${order.invoiceNumber}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    Button(
                        onClick = {
                            onMarkPrepared(order.id)
                            val message = "مرحبا ${order.customerName}، طلبك تجهز وكامل وهو بطريقه الك."
                            try { sendWhatsApp(context, order.customerPhone, message) } catch (_: Exception) {}
                        },
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600)
                    ) { Text("تم التجهيز") }
                }
            }
        }
    }
}

@Composable
private fun MetricCard(title: String, value: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Surface(modifier = modifier, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp, onClick = onClick) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                Icon(icon, null, tint = color, modifier = Modifier.size(18.dp))
            }
            Text(value, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun QuickActionBtn(label: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    OutlinedCard(
        modifier = modifier.height(58.dp),
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.25f)),
        colors = CardDefaults.outlinedCardColors(containerColor = color.copy(alpha = 0.06f))
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, null, tint = color, modifier = Modifier.size(18.dp))
            Text(label, color = color, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
