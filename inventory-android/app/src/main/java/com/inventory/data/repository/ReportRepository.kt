package com.inventory.data.repository

import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CustomerDebtDto
import com.inventory.data.remote.dto.DashboardReportDto
import com.inventory.data.remote.dto.EndOfDayReportDto
import com.inventory.data.remote.dto.InventoryProductDto
import com.inventory.data.remote.dto.InventoryValuationDto
import com.inventory.data.remote.dto.ProfitReportDto
import com.inventory.data.remote.dto.SalesPointDto
import com.inventory.data.remote.dto.SalesReportDto
import com.inventory.data.remote.dto.StoreBrainReportDto
import com.inventory.data.remote.dto.TopCustomerDto
import com.inventory.data.remote.dto.TopProductDto
import com.inventory.domain.model.CustomerDebt
import com.inventory.domain.model.DashboardReport
import com.inventory.domain.model.InventoryProduct
import com.inventory.domain.model.InventoryValuation
import com.inventory.domain.model.SalesPoint
import com.inventory.domain.model.SalesReport
import com.inventory.domain.model.TopProduct
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ReportRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val networkMonitor: NetworkMonitor
) {
    suspend fun dashboard(): ApiResult<DashboardReport> = call { apiClient.api.dashboardReport().data?.toDomain() ?: DashboardReportDto().toDomain() }
    suspend fun sales(from: String?, to: String?, groupBy: String): ApiResult<SalesReport> = call { apiClient.api.salesReport(from, to, groupBy).data?.toDomain() ?: SalesReportDto().toDomain() }
    suspend fun inventory(): ApiResult<InventoryValuation> = call { apiClient.api.inventoryValuation().data?.toDomain() ?: InventoryValuationDto().toDomain() }
    suspend fun debts(minDays: Int, maxDays: Int = 999): ApiResult<List<CustomerDebt>> = call { apiClient.api.customerDebtsReport(minDays, maxDays).data.orEmpty().map { it.toDomain() } }
    suspend fun profit(from: String?, to: String?, groupBy: String): ApiResult<ProfitReportDto> = call { apiClient.api.profitReport(from, to, groupBy).data ?: ProfitReportDto() }
    suspend fun topCustomers(from: String?, to: String?, limit: Int = 20): ApiResult<List<TopCustomerDto>> = call { apiClient.api.topCustomersReport(from, to, limit).data.orEmpty() }
    suspend fun endOfDay(date: String?): ApiResult<EndOfDayReportDto> = call { apiClient.api.endOfDayReport(date).data ?: EndOfDayReportDto() }
    suspend fun storeBrain(from: String?, to: String?): ApiResult<StoreBrainReportDto> = call { apiClient.api.storeBrainReport(from, to).data ?: StoreBrainReportDto() }

    private suspend fun <T> call(block: suspend () -> T): ApiResult<T> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(block())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل التقرير")
        }
    }
}

private fun DashboardReportDto.toDomain() = DashboardReport(
    todaySales = todaySales,
    todayInvoices = todayInvoices,
    totalDebts = totalDebts,
    lowStockProducts = lowStockProducts,
    topProducts = topProductsThisMonth.map { it.toDomain() },
    lastSevenDaysSales = lastSevenDaysSales.map { it.toDomain() }
)

private fun TopProductDto.toDomain() = TopProduct(productId, productName, quantitySold, totalSales)
private fun SalesPointDto.toDomain() = SalesPoint(date ?: period ?: "", totalSales, grossProfit)
private fun SalesReportDto.toDomain() = SalesReport(totalSales, grossProfit, chart.map { it.toDomain() })
private fun InventoryValuationDto.toDomain() = InventoryValuation(
    products = products.map { it.toDomain() },
    totalPurchaseValue = totals.purchaseValue,
    totalSaleValue = totals.saleValue
)
private fun InventoryProductDto.toDomain() = InventoryProduct(id, itemNumber, name, category, currentStock, purchaseValue, saleValue)
private fun CustomerDebtDto.toDomain() = CustomerDebt(id, name, phone, currentBalance, lastTransactionAt, debtAgeDays)
