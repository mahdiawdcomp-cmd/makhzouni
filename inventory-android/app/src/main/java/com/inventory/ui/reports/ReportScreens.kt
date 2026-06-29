package com.inventory.ui.reports

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Message
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.github.mikephil.charting.charts.BarChart
import com.github.mikephil.charting.charts.LineChart
import com.github.mikephil.charting.data.BarData
import com.github.mikephil.charting.data.BarDataSet
import com.github.mikephil.charting.data.BarEntry
import com.github.mikephil.charting.data.Entry
import com.github.mikephil.charting.data.LineData
import com.github.mikephil.charting.data.LineDataSet
import com.inventory.data.remote.dto.StoreBrainProductRowDto
import com.inventory.domain.model.Invoice
import com.inventory.domain.model.SalesPoint
import com.inventory.domain.model.Voucher
import com.inventory.ui.common.AppScreen
import com.inventory.ui.common.EmptyState
import com.inventory.ui.common.SectionCard
import com.inventory.ui.common.SummaryRow
import com.inventory.ui.common.formatMoney
import com.inventory.ui.theme.AppColor
import com.inventory.utils.sendWhatsApp

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DASHBOARD REPORT SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun DashboardReportScreen(viewModel: DashboardReportViewModel) {
    val state by viewModel.state.collectAsState()
    val report = state.report

    AppScreen(title = "لوحة التحكم") { padding ->
        if (report == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (state.error != null)
                    EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                else
                    CircularProgressIndicator()
            }
            return@AppScreen
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("مبيعات اليوم",   report.todaySales.toString(),      AppColor.Green600,  Modifier.weight(1f))
                    StatCard("فواتير اليوم",   report.todayInvoices.toString(),   AppColor.Blue600,   Modifier.weight(1f))
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("ديون الزبائن",   report.totalDebts.toString(),      AppColor.Red600,    Modifier.weight(1f))
                    StatCard("منتجات ناقصة",   report.lowStockProducts.toString(),AppColor.Amber600,  Modifier.weight(1f))
                }
            }
            item {
                SectionCard(title = "مبيعات آخر 7 أيام", contentPadding = PaddingValues(12.dp)) {
                    SalesLineChart(report.lastSevenDaysSales, Modifier.fillMaxWidth().height(220.dp))
                }
            }
            if (report.topProducts.isNotEmpty()) {
                item {
                    Text(
                        text = "أفضل 5 منتجات — الشهر الحالي",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(report.topProducts) { product ->
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = MaterialTheme.colorScheme.surface,
                        shadowElevation = 1.dp,
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(product.productName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Column(horizontalAlignment = Alignment.End) {
                                Text("${product.quantitySold} قطعة", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(product.totalSales.toString(), style = MaterialTheme.typography.labelMedium, color = AppColor.Green600, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STAT CARD (colored top-bar style)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun StatCard(title: String, value: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(color)
            )
            Column(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(title, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  REPORTS SCREEN (Sales / Inventory / Debts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun ReportsScreen(viewModel: ReportsViewModel) {
    val state by viewModel.state.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("عقل المحل", "المبيعات", "الأرباح", "أفضل الزبائن", "نهاية اليوم", "المخزون", "الديون الذكية", "الأرشيف")

    AppScreen(title = "التقارير") { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            TabRow(
                selectedTabIndex = tab,
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                tabs.forEachIndexed { index, label ->
                    Tab(
                        selected = tab == index,
                        onClick = { tab = index },
                        text = { Text(label, style = MaterialTheme.typography.labelLarge) },
                    )
                }
            }
            when (tab) {
                0 -> StoreBrainTab(viewModel = hiltViewModel())
                1 -> SalesReportTab(state, viewModel)
                2 -> ProfitReportTab(viewModel = hiltViewModel())
                3 -> TopCustomersTab(viewModel = hiltViewModel())
                4 -> EndOfDayTab(viewModel = hiltViewModel())
                5 -> InventoryReportTab(state)
                6 -> DebtReportTab(state, viewModel)
                7 -> ArchiveTab(viewModel = hiltViewModel())
            }
        }
    }
}

@Composable
private fun SalesReportTab(state: ReportsUiState, viewModel: ReportsViewModel) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard(title = "الفترة الزمنية") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    OutlinedTextField(state.from, viewModel::setFrom, Modifier.weight(1f), label = { Text("من") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    OutlinedTextField(state.to,   viewModel::setTo,   Modifier.weight(1f), label = { Text("إلى") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    Button(onClick = viewModel::refreshSales) { Text("عرض") }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("day" to "يوم", "week" to "أسبوع", "month" to "شهر").forEach { (key, label) ->
                        FilterChip(selected = state.groupBy == key, onClick = { viewModel.setGroupBy(key) }, label = { Text(label) })
                    }
                }
            }
        }
        state.sales?.let { sales ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("إجمالي المبيعات", sales.totalSales.toString(), AppColor.Green600, Modifier.weight(1f))
                    StatCard("إجمالي الأرباح",   sales.grossProfit.toString(), AppColor.Blue600,  Modifier.weight(1f))
                }
            }
            item {
                SectionCard(title = "الرسم البياني", contentPadding = PaddingValues(12.dp)) {
                    SalesBarChart(sales.chart, Modifier.fillMaxWidth().height(240.dp))
                }
            }
        }
    }
}

@Composable
private fun InventoryReportTab(state: ReportsUiState) {
    val inventory = state.inventory
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (inventory != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("قيمة الشراء", inventory.totalPurchaseValue.toString(), AppColor.Amber600, Modifier.weight(1f))
                    StatCard("قيمة البيع",  inventory.totalSaleValue.toString(),     AppColor.Green600, Modifier.weight(1f))
                }
            }
            items(inventory.products.sortedBy { if (it.currentStock <= 0) 0 else 1 }) { product ->
                val isOutOfStock = product.currentStock <= 0
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = if (isOutOfStock) AppColor.Red50 else MaterialTheme.colorScheme.surface,
                    shadowElevation = 1.dp,
                ) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = product.name,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (isOutOfStock) AppColor.Red600 else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                text = "${product.currentStock} قطعة",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color = if (isOutOfStock) AppColor.Red600 else AppColor.Green600,
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(product.category.ifBlank { product.itemNumber }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        SummaryRow("قيمة الشراء",  product.purchaseValue.toString(), valueColor = AppColor.Amber600)
                        SummaryRow("قيمة البيع",   product.saleValue.toString(),     valueColor = AppColor.Green600)
                    }
                }
            }
        } else {
            item {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (state.error != null)
                        EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                    else
                        CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun DebtReportTab(state: ReportsUiState, viewModel: ReportsViewModel) {
    val context = LocalContext.current
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0 to "الكل", 7 to "7 أيام", 14 to "14 يوم", 30 to "30 يوم").forEach { (days, label) ->
                    FilterChip(
                        selected = state.debtFilter == days,
                        onClick = { viewModel.setDebtFilter(days) },
                        label = { Text(label) },
                    )
                }
            }
        }
        if (state.debts.isNotEmpty()) {
            item {
                Button(
                    onClick = {
                        state.debts.forEach { sendWhatsApp(context, it.phone, "مرحباً ${it.name}، لديك دين ${it.currentBalance}") }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text("إرسال رسالة للكل")
                }
            }
            items(state.debts) { debt ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 1.dp,
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(debt.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            Text("${debt.debtAgeDays} يوم", style = MaterialTheme.typography.labelMedium, color = AppColor.Amber600)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SummaryRow("الدين", debt.currentBalance.toString(), valueColor = AppColor.Red600, bold = true)
                        SummaryRow("آخر تعامل", debt.lastTransactionAt ?: "-")
                        Button(
                            onClick = { sendWhatsApp(context, debt.phone, "مرحباً ${debt.name}، لديك دين ${debt.currentBalance}") },
                            colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            Text("تذكير عبر واتساب")
                        }
                    }
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CHARTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
fun SalesLineChart(points: List<SalesPoint>, modifier: Modifier = Modifier) {
    AndroidView(modifier = modifier, factory = { context ->
        LineChart(context).apply { description.isEnabled = false }
    }, update = { chart ->
        val entries = points.mapIndexed { index, point -> Entry(index.toFloat(), point.totalSales.toFloat()) }
        chart.data = LineData(LineDataSet(entries, "المبيعات").apply {
            color = android.graphics.Color.rgb(29, 78, 216)
            setCircleColor(color)
            lineWidth = 2f
        })
        chart.invalidate()
    })
}

@Composable
fun SalesBarChart(points: List<SalesPoint>, modifier: Modifier = Modifier) {
    AndroidView(modifier = modifier, factory = { context ->
        BarChart(context).apply { description.isEnabled = false }
    }, update = { chart ->
        val entries = points.mapIndexed { index, point -> BarEntry(index.toFloat(), point.totalSales.toFloat()) }
        chart.data = BarData(BarDataSet(entries, "المبيعات").apply {
            color = android.graphics.Color.rgb(5, 150, 105)
        })
        chart.invalidate()
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PROFIT REPORT TAB ("الأرباح")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun ProfitReportTab(viewModel: ProfitReportViewModel) {
    val state by viewModel.state.collectAsState()
    val report = state.report

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard(title = "الفترة الزمنية") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    OutlinedTextField(state.from, viewModel::setFrom, Modifier.weight(1f), label = { Text("من") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    OutlinedTextField(state.to,   viewModel::setTo,   Modifier.weight(1f), label = { Text("إلى") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    Button(onClick = viewModel::refresh) { Text("عرض") }
                }
            }
        }
        if (report != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("الإيرادات", report.summary.totalRevenue.formatMoney(), AppColor.Blue600, Modifier.weight(1f))
                    StatCard("صافي الربح", report.summary.netProfit.formatMoney(), AppColor.Green600, Modifier.weight(1f))
                }
            }
            item {
                SectionCard(title = "ملخص") {
                    SummaryRow("التكلفة", report.summary.totalCost.formatMoney())
                    SummaryRow("الهالك", report.summary.lossesTotal.formatMoney(), valueColor = AppColor.Red600)
                    SummaryRow("المصاريف", report.summary.expensesTotal.formatMoney(), valueColor = AppColor.Red600)
                    SummaryRow("متوسط الهامش", "${report.summary.avgMargin.formatMoney(1)}%", bold = true)
                }
            }
            if (report.topProducts.isNotEmpty()) {
                item {
                    Text("أفضل المنتجات ربحاً", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                }
                items(report.topProducts) { p ->
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text(p.profit.formatMoney(), style = MaterialTheme.typography.labelMedium, color = AppColor.Green600, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        } else {
            item {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (state.error != null) EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                    else if (state.loading) CircularProgressIndicator()
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOP CUSTOMERS TAB ("أفضل الزبائن")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun TopCustomersTab(viewModel: TopCustomersViewModel) {
    val state by viewModel.state.collectAsState()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (state.customers.isNotEmpty()) {
            items(state.customers) { c ->
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(c.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                            Text("${c.invoiceCount} فاتورة", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SummaryRow("إجمالي المشتريات", c.totalPurchases.formatMoney(), valueColor = AppColor.Blue600, bold = true)
                        SummaryRow("المدفوع", c.totalPaid.formatMoney(), valueColor = AppColor.Green600)
                        SummaryRow("الرصيد الحالي", c.currentBalance.formatMoney(), valueColor = if (c.currentBalance > 0) AppColor.Red600 else AppColor.Green600)
                    }
                }
            }
        } else {
            item {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (state.error != null) EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                    else if (state.loading) CircularProgressIndicator()
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  END OF DAY TAB ("نهاية اليوم")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun EndOfDayTab(viewModel: EndOfDayViewModel) {
    val state by viewModel.state.collectAsState()
    val report = state.report

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard(title = "اليوم") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
                    OutlinedTextField(state.date, viewModel::setDate, Modifier.weight(1f), label = { Text("التاريخ (YYYY-MM-DD)") }, singleLine = true, shape = RoundedCornerShape(10.dp))
                    Button(onClick = viewModel::refresh) { Text("عرض") }
                }
            }
        }
        if (report != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatCard("المبيعات", report.sales.total.formatMoney(), AppColor.Green600, Modifier.weight(1f))
                    StatCard("المقبوضات", report.receipts.total.formatMoney(), AppColor.Blue600, Modifier.weight(1f))
                }
            }
            item {
                SectionCard(title = "ملخص اليوم") {
                    SummaryRow("عدد الفواتير", report.sales.count.toString())
                    SummaryRow("المشتريات", report.purchases.total.formatMoney(), valueColor = AppColor.Amber600)
                    SummaryRow("المدفوعات", report.payments.total.formatMoney(), valueColor = AppColor.Red600)
                    SummaryRow("المصاريف", report.expenses.total.formatMoney(), valueColor = AppColor.Red600)
                }
            }
            if (report.invoices.isNotEmpty()) {
                item { Text("الفواتير", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
                items(report.invoices) { inv ->
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column {
                                Text(inv.invoiceNumber, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                Text(inv.customerName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(inv.total.formatMoney(), style = MaterialTheme.typography.labelMedium, color = AppColor.Green600, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        } else {
            item {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (state.error != null) EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                    else if (state.loading) CircularProgressIndicator()
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  STORE BRAIN TAB ("عقل المحل")
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun StoreBrainTab(viewModel: StoreBrainViewModel) {
    val state by viewModel.state.collectAsState()
    val report = state.report

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (report != null) {
            item {
                val cur = report.comparison.current
                val prev = report.comparison.previous
                SectionCard(title = "مقارنة الشهر الحالي بالسابق") {
                    SummaryRow("صافي الربح الآن", cur.netProfit.formatMoney(), valueColor = AppColor.Green600, bold = true)
                    SummaryRow("صافي الربح السابق", prev.netProfit.formatMoney())
                    SummaryRow("نسبة التغير", "${report.comparison.change.netProfitPct.formatMoney(1)}%", valueColor = if (report.comparison.change.netProfitPct >= 0) AppColor.Green600 else AppColor.Red600, bold = true)
                }
            }
            if (report.fakeStars.isNotEmpty()) {
                item { Text("نجوم وهمية (مبيعات عالية، ربح منخفض)", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = AppColor.Amber600) }
                items(report.fakeStars) { p -> StoreBrainProductRow(p) }
            }
            if (report.promote.isNotEmpty()) {
                item { Text("منتجات يُنصح بالترويج لها", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = AppColor.Green600) }
                items(report.promote) { p -> StoreBrainProductRow(p) }
            }
            if (report.byDayOfWeek.isNotEmpty()) {
                item { Text("الأداء حسب يوم الأسبوع", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold) }
                items(report.byDayOfWeek) { d ->
                    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(d.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                            Text(d.profit.formatMoney(), style = MaterialTheme.typography.labelMedium, color = AppColor.Green600, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        } else {
            item {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (state.error != null) EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error)
                    else if (state.loading) CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun StoreBrainProductRow(p: StoreBrainProductRowDto) {
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End) {
                Text(p.revenue.formatMoney(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("هامش ${p.margin.formatMoney(1)}%", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ARCHIVE TAB ("الأرشيف") — cancelled invoices & vouchers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@Composable
private fun ArchiveTab(viewModel: ArchiveViewModel) {
    val state by viewModel.state.collectAsState()

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 12.dp, 16.dp, 0.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.subTab == ArchiveSubTab.INVOICES, onClick = { viewModel.setSubTab(ArchiveSubTab.INVOICES) }, label = { Text("الفواتير الملغاة") })
            FilterChip(selected = state.subTab == ArchiveSubTab.VOUCHERS, onClick = { viewModel.setSubTab(ArchiveSubTab.VOUCHERS) }, label = { Text("السندات الملغاة") })
        }
        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        } else if (state.error != null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { EmptyState(Icons.Default.ErrorOutline, "خطأ في التحميل", state.error) }
        } else if (state.subTab == ArchiveSubTab.INVOICES) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.invoices) { inv -> ArchivedInvoiceRow(inv) }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.vouchers) { v -> ArchivedVoucherRow(v, onRestore = { viewModel.restoreVoucher(v.id) }) }
            }
        }
    }
}

@Composable
private fun ArchivedInvoiceRow(inv: Invoice) {
    Surface(shape = RoundedCornerShape(12.dp), color = AppColor.Red50, shadowElevation = 1.dp) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(inv.invoiceNumber, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Text(inv.date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(inv.customerName, style = MaterialTheme.typography.bodySmall)
            SummaryRow("المبلغ", inv.totalAmount.formatMoney(), valueColor = AppColor.Red600, bold = true)
        }
    }
}

@Composable
private fun ArchivedVoucherRow(v: Voucher, onRestore: () -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = AppColor.Red50, shadowElevation = 1.dp) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(v.voucherNumber, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Text(v.date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(v.customerName ?: "-", style = MaterialTheme.typography.bodySmall)
            SummaryRow("المبلغ", v.amount.formatMoney(), valueColor = AppColor.Red600, bold = true)
            TextButton(onClick = onRestore) { Text("استرجاع السند") }
        }
    }
}
