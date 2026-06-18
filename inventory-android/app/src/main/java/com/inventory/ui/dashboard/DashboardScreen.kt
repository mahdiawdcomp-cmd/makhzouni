package com.inventory.ui.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Approval
import androidx.compose.material.icons.filled.AssignmentReturn
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.DocumentScanner
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Pending
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PointOfSale
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.RequestQuote
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Warehouse
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import com.inventory.ui.common.SkeletonLoading
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

private data class MenuAction(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val color: Color,
    val onClick: () -> Unit,
)

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
    onPos: () -> Unit = {},
    onReturns: () -> Unit = {},
    onQuotations: () -> Unit = {},
    onTransfers: () -> Unit = {},
    onBranches: () -> Unit = {},
    onCoupons: () -> Unit = {},
    onAudit: () -> Unit = {},
    onRetailOrders: () -> Unit = {},
    onOcrInvoice: () -> Unit = {},
    onQuickScan: () -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    val report = state.report

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("مخزوني", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        Text("نفس أوامر الويب، مرتبة للموبايل", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        IconButton(onClick = onNotifications) { Icon(Icons.Default.Notifications, "الإشعارات") }
                    }
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "الإعدادات") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        containerColor = MaterialTheme.colorScheme.background
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

            if (state.pendingOrders.isNotEmpty()) {
                item { PendingOrdersSection(state.pendingOrders) { viewModel.markPrepared(it) } }
            }

            item {
                QuickLaunchCard(
                    actions = listOf(
                        MenuAction("مسح سريع", "باركود → فاتورة فوراً", Icons.Default.QrCodeScanner, Color(0xFF0369A1), onQuickScan),
                        MenuAction("فاتورة بيع", "الأكثر استخداماً", Icons.Default.Receipt, AppColor.Green600, onInvoices),
                        MenuAction("POS سريع", "كاشير وباركود", Icons.Default.PointOfSale, Color(0xFF0F766E), onPos),
                        MenuAction("مساعد ذكي", "أوامر صوتية وكتابية", Icons.Default.SmartToy, Color(0xFF7C3AED), onAgent),
                    )
                )
            }

            if (state.canManageProducts) {
                item {
                    WebLikeSection(
                        title = "المخزن",
                        subtitle = "نفس مجموعة المخزن في الويب",
                        icon = Icons.Default.Inventory2,
                        color = Color(0xFF4F46E5),
                        actions = listOf(
                            MenuAction("المنتجات", "بحث، إضافة، تعديل، باركود", Icons.Default.Inventory2, Color(0xFF4F46E5), onProducts),
                            MenuAction("التحويلات", "نقل بين المحل والمخازن", Icons.Default.SwapHoriz, AppColor.Sky500, onTransfers),
                            MenuAction("المخازن", "المحل، العباسية، شارع العباس", Icons.Default.Warehouse, AppColor.Amber600, onBranches),
                        )
                    )
                }
            }

            if (state.canManageInvoices) {
                item {
                    WebLikeSection(
                        title = "الفواتير",
                        subtitle = "بيع، شراء، مرتجع، عروض، POS",
                        icon = Icons.Default.Description,
                        color = AppColor.Green600,
                        actions = listOf(
                            MenuAction("فواتير البيع", "قائمة الفواتير وإنشاء فاتورة", Icons.Default.ReceiptLong, AppColor.Green600, onInvoices),
                            MenuAction("POS سريع", "نافذة البيع المختصرة", Icons.Default.PointOfSale, Color(0xFF0F766E), onPos),
                            MenuAction("مرتجع مبيعات", "إرجاع كامل أو جزئي", Icons.Default.AssignmentReturn, AppColor.Red600, onReturns),
                            MenuAction("عروض الأسعار", "عرض يتحول لفاتورة", Icons.Default.RequestQuote, AppColor.Blue600, onQuotations),
                            MenuAction("فاتورة شراء OCR", "قراءة من صورة", Icons.Default.DocumentScanner, Color(0xFF7C3AED), onOcrInvoice),
                            MenuAction("الطلبات", "طلبات كتالوك المفرد", Icons.Default.Storefront, Color(0xFF6366F1), onRetailOrders),
                        )
                    )
                }
            }

            if (state.canManageVouchers) {
                item {
                    WebLikeSection(
                        title = "السندات",
                        subtitle = "قبض، دفع، مصاريف",
                        icon = Icons.Default.ConfirmationNumber,
                        color = AppColor.Purple600,
                        actions = listOf(
                            MenuAction("السندات", "قائمة السندات والتعديل", Icons.Default.ConfirmationNumber, AppColor.Purple600, onVouchers),
                            MenuAction("سند قبض/دفع", "إنشاء سند سريع", Icons.Default.Payments, AppColor.Blue600, onVouchers),
                        )
                    )
                }
            }

            if (state.canManageCustomers) {
                item {
                    WebLikeSection(
                        title = "الزبائن والكتالوك",
                        subtitle = "حسابات، كشوفات، كتالوك العملاء",
                        icon = Icons.Default.Groups,
                        color = AppColor.Blue600,
                        actions = listOf(
                            MenuAction("الزبائن", "قائمة الزبائن والموردين", Icons.Default.Groups, AppColor.Blue600, onCustomers),
                            MenuAction("كشف الحساب", "فواتير وسندات الزبون", Icons.Default.AccountBalance, AppColor.Purple600, onAccountLookup),
                            MenuAction("إرسال جماعي", "رسائل زبائن الجملة", Icons.Default.Campaign, AppColor.Amber600, onCustomers),
                            MenuAction("الكتالوك", "صلاحيات وروابط العملاء", Icons.Default.Storefront, AppColor.Sky500, onCatalogManagement),
                        )
                    )
                }
            }

            item {
                WebLikeSection(
                    title = "الإدارة والتقارير",
                    subtitle = "صلاحيات، موافقات، تدقيق، إعدادات",
                    icon = Icons.Default.AccountTree,
                    color = AppColor.Gray700,
                    actions = buildList {
                        if (state.canViewReports) add(MenuAction("التقارير", "مبيعات، ديون، أرباح", Icons.Default.BarChart, AppColor.Gray700, onReports))
                        if (state.canManageUsers) add(MenuAction("المستخدمين", "صلاحيات دقيقة مثل الويب", Icons.Default.People, AppColor.Blue600, onUsers))
                        if (state.canApprove) add(MenuAction("الموافقات", "طلبات حذف وتحويل وكتالوك", Icons.Default.Approval, AppColor.Amber600, onApprovals))
                        if (state.canManageSettings) add(MenuAction("الكوبونات", "خصومات وعروض", Icons.Default.LocalOffer, Color(0xFF0F766E), onCoupons))
                        if (state.canManageSettings) add(MenuAction("سجل التدقيق", "من عدل ومتى", Icons.Default.History, AppColor.Gray700, onAudit))
                        if (state.canManageSettings) add(MenuAction("الإعدادات", "إعدادات التطبيق والربط", Icons.Default.Settings, AppColor.Gray700, onSettings))
                        add(MenuAction("كل العمليات", "صفحة جامعة لكل الأوامر", Icons.Default.AccountTree, Color(0xFF0F766E), onOperations))
                    }
                )
            }

            item {
                WebLikeSection(
                    title = "أدوات ذكية",
                    subtitle = "موجودة في التطبيق فقط لتسريع العمل",
                    icon = Icons.Default.SmartToy,
                    color = Color(0xFF7C3AED),
                    actions = listOf(
                        MenuAction("فاتورة صوتية", "اكتب فاتورة بالكلام", Icons.Default.Mic, Color(0xFF6366F1), onVoiceInvoice),
                        MenuAction("المساعد الذكي", "اسأل عن النظام والأوامر", Icons.Default.SmartToy, Color(0xFF7C3AED), onAgent),
                    )
                )
            }

            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun QuickLaunchCard(actions: List<MenuAction>) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Color(0xFF0F172A),
        shadowElevation = 2.dp
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("أوامر سريعة", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Text("اختصارات يومية بدون تدوير بالقوائم", color = Color.White.copy(alpha = 0.68f), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                actions.forEach { action ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
                            .clickable(onClick = action.onClick)
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(action.icon, null, tint = action.color, modifier = Modifier.size(22.dp))
                        Text(action.title, color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun WebLikeSection(
    title: String,
    subtitle: String,
    icon: ImageVector,
    color: Color,
    actions: List<MenuAction>,
) {
    if (actions.isEmpty()) return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        tonalElevation = 0.5.dp
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .background(color.copy(alpha = 0.12f), RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon, null, tint = color, modifier = Modifier.size(22.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(title, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
                    Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Divider(color = MaterialTheme.colorScheme.outlineVariant)
            Column {
                actions.forEachIndexed { index, action ->
                    MenuRow(action)
                    if (index != actions.lastIndex) Divider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(start = 14.dp, end = 66.dp))
                }
            }
        }
    }
}

@Composable
private fun MenuRow(action: MenuAction) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = action.onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .background(action.color.copy(alpha = 0.10f), RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(action.icon, null, tint = action.color, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(action.title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(action.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun PendingOrdersSection(orders: List<OrderPreparationDto>, onMarkPrepared: (String) -> Unit) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        border = BorderStroke(1.dp, AppColor.Amber600.copy(alpha = 0.35f))
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.PendingActions, null, tint = AppColor.Amber600)
                Text("طلبات كتالوك تحتاج تجهيز (${orders.size})", fontWeight = FontWeight.Bold, color = AppColor.Amber600)
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
