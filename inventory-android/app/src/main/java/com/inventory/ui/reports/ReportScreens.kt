package com.inventory.ui.reports

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.github.mikephil.charting.charts.BarChart
import com.github.mikephil.charting.charts.LineChart
import com.github.mikephil.charting.data.BarData
import com.github.mikephil.charting.data.BarDataSet
import com.github.mikephil.charting.data.BarEntry
import com.github.mikephil.charting.data.Entry
import com.github.mikephil.charting.data.LineData
import com.github.mikephil.charting.data.LineDataSet
import com.inventory.domain.model.SalesPoint
import com.inventory.utils.sendWhatsApp

@Composable
fun DashboardReportScreen(viewModel: DashboardReportViewModel) {
    val state by viewModel.state.collectAsState()
    val report = state.report

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text("لوحة التحكم", style = MaterialTheme.typography.headlineSmall) }
        if (report != null) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryCard("مبيعات اليوم", report.todaySales.toString(), Modifier.weight(1f))
                        SummaryCard("فواتير اليوم", report.todayInvoices.toString(), Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SummaryCard("ديون الزبائن", report.totalDebts.toString(), Modifier.weight(1f))
                        SummaryCard("منتجات ناقصة", report.lowStockProducts.toString(), Modifier.weight(1f))
                    }
                }
            }
            item {
                Card { Column(Modifier.padding(12.dp)) {
                    Text("مبيعات آخر 7 أيام")
                    SalesLineChart(report.lastSevenDaysSales, Modifier.fillMaxWidth().height(220.dp))
                } }
            }
            item { Text("أفضل 5 منتجات هذا الشهر", style = MaterialTheme.typography.titleMedium) }
            items(report.topProducts) {
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(it.productName)
                        Text("${it.quantitySold} | ${it.totalSales}")
                    }
                }
            }
        } else {
            item { Text(state.error ?: "جار تحميل التقارير...") }
        }
    }
}

@Composable
private fun SummaryCard(title: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.labelMedium)
            Text(value, style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
fun ReportsScreen(viewModel: ReportsViewModel) {
    val state by viewModel.state.collectAsState()
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("المبيعات", "المخزون", "الديون الذكية")

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("التقارير", style = MaterialTheme.typography.headlineSmall)
        TabRow(selectedTabIndex = tab) {
            tabs.forEachIndexed { index, label -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) }) }
        }
        when (tab) {
            0 -> SalesReportTab(state, viewModel)
            1 -> InventoryReportTab(state)
            2 -> DebtReportTab(state, viewModel)
        }
    }
}

@Composable
private fun SalesReportTab(state: ReportsUiState, viewModel: ReportsViewModel) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(state.from, viewModel::setFrom, Modifier.weight(1f), label = { Text("من") })
                OutlinedTextField(state.to, viewModel::setTo, Modifier.weight(1f), label = { Text("إلى") })
                Button(onClick = viewModel::refreshSales) { Text("عرض") }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("day" to "يوم", "week" to "أسبوع", "month" to "شهر").forEach { (key, label) ->
                    FilterChip(selected = state.groupBy == key, onClick = { viewModel.setGroupBy(key) }, label = { Text(label) })
                }
            }
        }
        state.sales?.let { sales ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SummaryCard("إجمالي المبيعات", sales.totalSales.toString(), Modifier.weight(1f))
                    SummaryCard("الأرباح", sales.netProfit.toString(), Modifier.weight(1f))
                }
            }
            item { SalesBarChart(sales.chart, Modifier.fillMaxWidth().height(240.dp)) }
        }
    }
}

@Composable
private fun InventoryReportTab(state: ReportsUiState) {
    val inventory = state.inventory
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (inventory != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SummaryCard("قيمة الشراء", inventory.totalPurchaseValue.toString(), Modifier.weight(1f))
                    SummaryCard("قيمة البيع", inventory.totalSaleValue.toString(), Modifier.weight(1f))
                }
            }
            items(inventory.products.sortedBy { if (it.currentStock <= 0) 0 else 1 }) { product ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(product.name, color = if (product.currentStock <= 0) Color.Red else Color.Unspecified)
                        Text("${product.itemNumber} | ${product.category}")
                        Text("الكمية: ${product.currentStock} | شراء: ${product.purchaseValue} | بيع: ${product.saleValue}")
                    }
                }
            }
        } else {
            item { Text(state.error ?: "جار تحميل المخزون...") }
        }
    }
}

@Composable
private fun DebtReportTab(state: ReportsUiState, viewModel: ReportsViewModel) {
    val context = LocalContext.current
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0 to "كل", 7 to "7", 14 to "14", 30 to "30").forEach { (days, label) ->
                    FilterChip(selected = state.debtFilter == days, onClick = { viewModel.setDebtFilter(days) }, label = { Text(if (days == 0) label else "أقدم من $label") })
                }
            }
        }
        item {
            Button(onClick = {
                state.debts.forEach {
                    sendWhatsApp(context, it.phone, "مرحباً ${it.name}، لديك دين ${it.currentBalance}")
                }
            }) { Text("راسل الكل") }
        }
        items(state.debts) { debt ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(debt.name, style = MaterialTheme.typography.titleMedium)
                    Text("الدين: ${debt.currentBalance} | عمر الدين: ${debt.debtAgeDays} يوم")
                    Text("آخر تعامل: ${debt.lastTransactionAt ?: "-"}")
                    Button(onClick = { sendWhatsApp(context, debt.phone, "مرحباً ${debt.name}، لديك دين ${debt.currentBalance}") }) { Text("راسله") }
                }
            }
        }
    }
}

@Composable
fun SalesLineChart(points: List<SalesPoint>, modifier: Modifier = Modifier) {
    AndroidView(modifier = modifier, factory = { context ->
        LineChart(context).apply { description.isEnabled = false }
    }, update = { chart ->
        val entries = points.mapIndexed { index, point -> Entry(index.toFloat(), point.totalSales.toFloat()) }
        chart.data = LineData(LineDataSet(entries, "المبيعات").apply { color = android.graphics.Color.rgb(30, 120, 220); setCircleColor(color) })
        chart.invalidate()
    })
}

@Composable
fun SalesBarChart(points: List<SalesPoint>, modifier: Modifier = Modifier) {
    AndroidView(modifier = modifier, factory = { context ->
        BarChart(context).apply { description.isEnabled = false }
    }, update = { chart ->
        val entries = points.mapIndexed { index, point -> BarEntry(index.toFloat(), point.totalSales.toFloat()) }
        chart.data = BarData(BarDataSet(entries, "المبيعات").apply { color = android.graphics.Color.rgb(40, 150, 95) })
        chart.invalidate()
    })
}
