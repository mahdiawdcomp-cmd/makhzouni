package com.inventory.ui.dashboard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.inventory.data.remote.dto.OrderPreparationDto
import com.inventory.ui.common.*
import com.inventory.ui.reports.SalesLineChart
import com.inventory.ui.theme.AppColor

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
    onCatalogManagement: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val report = state.report

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = {
                    Column {
                        Text("مخزوني", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Text("الرئيسية", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    BadgedBox(
                        badge = {
                            if (state.unreadNotifications > 0)
                                Badge(containerColor = AppColor.Red600) {
                                    Text(state.unreadNotifications.toString(), fontSize = 9.sp)
                                }
                        }
                    ) {
                        IconButton(onClick = onNotifications) {
                            Icon(Icons.Default.Notifications, null, tint = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Default.Settings, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
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
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ── Metric cards ─────────────────────────────────────────
            item {
                if (report == null) {
                    SkeletonLoading(rows = 2)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricCard("مبيعات اليوم", report.todaySales.formatMoney(), Icons.Default.TrendingUp, AppColor.Blue600, Modifier.weight(1f), onDashboardReport)
                            MetricCard("فواتير اليوم", report.todayInvoices.toString(), Icons.Default.ReceiptLong, AppColor.Green600, Modifier.weight(1f), onInvoices)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            MetricCard("إجمالي الديون", report.totalDebts.formatMoney(), Icons.Default.AccountBalance, AppColor.Amber600, Modifier.weight(1f), onCustomers)
                            MetricCard("مخزون منخفض", report.lowStockProducts.toString(), Icons.Default.Warning, AppColor.Red600, Modifier.weight(1f), onProducts)
                        }
                    }
                }
            }

            // ── Pending Orders Banner ─────────────────────────────────
            if (state.pendingOrders.isNotEmpty()) {
                item {
                    PendingOrdersSection(
                        orders = state.pendingOrders,
                        onMarkPrepared = { id -> viewModel.markPrepared(id) }
                    )
                }
            }

            // ── Quick actions ────────────────────────────────────────
            item {
                SectionCard(title = "إجراءات سريعة") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("فاتورة بيع",  Icons.Default.Receipt,         AppColor.Green600, Modifier.weight(1f), onInvoices)
                            QuickActionBtn("فاتورة شراء", Icons.Default.ShoppingCart,    AppColor.Amber600, Modifier.weight(1f), onInvoices)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("سند قبض",    Icons.Default.Payments,         AppColor.Blue600,  Modifier.weight(1f), onVouchers)
                            QuickActionBtn("سند دفع",    Icons.Default.Payment,          Color(0xFFEA580C), Modifier.weight(1f), onVouchers)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("كشف حساب",   Icons.Default.AccountBalance,   AppColor.Purple600, Modifier.weight(1f), onAccountLookup)
                            QuickActionBtn("المخزن",      Icons.Default.Inventory2,       AppColor.Gray700,   Modifier.weight(1f), onProducts)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            QuickActionBtn("🎤 فاتورة صوتية", Icons.Default.Mic, Color(0xFF6366F1), Modifier.weight(1f), onVoiceInvoice)
                            QuickActionBtn("الكاتلوك", Icons.Default.Storefront, AppColor.Sky500, Modifier.weight(1f), onCatalogManagement)
                        }
                    }
                }
            }

            // ── Chart ────────────────────────────────────────────────
            if (report != null) {
                item {
                    SectionCard(
                        title = "مبيعات آخر 7 أيام",
                        titleAction = { TextButton(onClick = onReports) { Text("عرض التقارير") } },
                    ) {
                        SalesLineChart(report.lastSevenDaysSales, Modifier.fillMaxWidth().height(160.dp))
                    }
                }

                // ── Top products ─────────────────────────────────────
                if (report.topProducts.isNotEmpty()) {
                    item {
                        SectionCard(title = "أفضل الأصناف مبيعاً") {
                            Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                                report.topProducts.take(5).forEachIndexed { idx, product ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(6.dp))
                                            .background(if (idx % 2 == 0) MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f) else Color.Transparent)
                                            .padding(horizontal = 8.dp, vertical = 9.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    ) {
                                        Box(
                                            modifier = Modifier.size(24.dp).clip(RoundedCornerShape(50)).background(AppColor.Blue600.copy(alpha = 0.12f)),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Text("${idx + 1}", fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, color = AppColor.Blue600)
                                        }
                                        Text(product.productName, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                                        StatusBadge("${product.quantitySold} وحدة", StatusType.SUCCESS)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ── Admin actions ─────────────────────────────────────────
            if (state.canManageUsers || state.canApprove) {
                item {
                    SectionCard(title = "إدارة النظام") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state.canManageUsers) {
                                OutlinedButton(onClick = onUsers, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp)) {
                                    Icon(Icons.Default.People, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("المستخدمين", style = MaterialTheme.typography.labelLarge)
                                }
                            }
                            if (state.canApprove) {
                                BadgedBox(
                                    modifier = Modifier.weight(1f),
                                    badge = {
                                        if (state.pendingApprovalCount > 0)
                                            Badge(containerColor = AppColor.Red600) { Text(state.pendingApprovalCount.toString(), fontSize = 9.sp) }
                                    }
                                ) {
                                    OutlinedButton(onClick = onApprovals, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp)) {
                                        Icon(Icons.Default.Pending, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("الموافقات", style = MaterialTheme.typography.labelLarge)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ── Pending Orders Section ───────────────────────────────────────────────────────
@Composable
private fun PendingOrdersSection(
    orders: List<OrderPreparationDto>,
    onMarkPrepared: (String) -> Unit
) {
    val context = LocalContext.current

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = AppColor.Amber50),
        border = androidx.compose.foundation.BorderStroke(1.dp, AppColor.Amber600.copy(alpha = 0.4f))
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.PendingActions,
                    contentDescription = null,
                    tint = AppColor.Amber600,
                    modifier = Modifier.size(20.dp)
                )
                Text(
                    text = "طلبات كاتلوك تحتاج تجهيز (${orders.size})",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = AppColor.Amber600
                )
            }

            orders.forEach { order ->
                HorizontalDivider(color = AppColor.Amber600.copy(alpha = 0.2f))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = order.customerName,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = order.customerPhone,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Text(
                                text = "${order.items.size} صنف • فاتورة ${order.invoiceNumber}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Button(
                            onClick = {
                                onMarkPrepared(order.id)
                                // Send WhatsApp message to customer
                                val phone = order.customerPhone.trimStart('0').let { "+964$it" }
                                val message = "مرحباً ${order.customerName}، تم تجهيز طلبك رقم ${order.invoiceNumber} وهو جاهز للاستلام. شكراً لك!"
                                val uri = Uri.parse("https://wa.me/${phone.replace("+", "")}?text=${Uri.encode(message)}")
                                try {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                } catch (_: Exception) { }
                            },
                            shape = RoundedCornerShape(8.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text("تم التجهيز", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
    }
}

// ── Metric card ─────────────────────────────────────────────────────────────────
@Composable
private fun MetricCard(
    title: String, value: String, icon: ImageVector,
    color: Color, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        onClick = onClick ?: {},
    ) {
        Box {
            Box(Modifier.fillMaxWidth().height(3.dp).background(color))
            Column(modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 18.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Icon(icon, null, Modifier.size(18.dp), tint = color)
                }
                Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

// ── Quick action button ──────────────────────────────────────────────────────────
@Composable
private fun QuickActionBtn(label: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedCard(
        modifier = modifier.height(60.dp),
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, color.copy(alpha = 0.25f)),
        colors = CardDefaults.outlinedCardColors(containerColor = color.copy(alpha = 0.06f)),
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(icon, null, Modifier.size(18.dp), tint = color)
            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = color)
        }
    }
}
