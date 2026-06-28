package com.inventory.data.remote

import com.inventory.data.remote.dto.ApiEnvelope
import com.inventory.data.remote.dto.AgentChatRequest
import com.inventory.data.remote.dto.AgentChatResponse
import com.inventory.data.remote.dto.ApprovalDto
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.BranchRequest
import com.inventory.data.remote.dto.CouponDto
import com.inventory.data.remote.dto.CouponRequest
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.CreateQuotationRequest
import com.inventory.data.remote.dto.CreateTransferRequest
import com.inventory.data.remote.dto.AuditLogDto
import com.inventory.data.remote.dto.CustomerDebtDto
import com.inventory.data.remote.dto.CreateUserRequest
import com.inventory.data.remote.dto.CustomerBalanceDto
import com.inventory.data.remote.dto.CustomerDto
import com.inventory.data.remote.dto.CustomerRatingDto
import com.inventory.data.remote.dto.CustomerTransactionDto
import com.inventory.data.remote.dto.CustomerTransactionsEnvelope
import com.inventory.data.remote.dto.LastTransactionDto
import com.inventory.data.remote.dto.LoginRequest
import com.inventory.data.remote.dto.PagedEnvelope
import com.inventory.data.remote.dto.PaginationEnvelope
import com.inventory.data.remote.dto.DashboardReportDto
import com.inventory.data.remote.dto.InventoryValuationDto
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.CatalogCategoryDto
import com.inventory.data.remote.dto.ProductDto
import com.inventory.data.remote.dto.ProductMovementResponse
import com.inventory.data.remote.dto.QuotationDto
import com.inventory.data.remote.dto.ReviewApprovalRequest
import com.inventory.data.remote.dto.SalesReportDto
import com.inventory.data.remote.dto.TransferDto
import com.inventory.data.remote.dto.LicenseStatusDto
import com.inventory.data.remote.dto.UpdateQuotationStatusRequest
import com.inventory.data.remote.dto.UpdateUserRequest
import com.inventory.data.remote.dto.UpsertCustomerRequest
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.data.remote.dto.UserDto
import com.inventory.data.remote.dto.VoucherDto
import com.inventory.data.remote.dto.CatalogCustomerDto
import com.inventory.data.remote.dto.ProfitReportDto
import com.inventory.data.remote.dto.TopCustomerDto
import com.inventory.data.remote.dto.EndOfDayReportDto
import com.inventory.data.remote.dto.StoreBrainReportDto
import com.inventory.data.remote.dto.StockLossDto
import com.inventory.data.remote.dto.CreateStockLossRequest
import com.inventory.data.remote.dto.GrantCatalogAccessRequest
import com.inventory.data.remote.dto.OrderPreparationDto
import com.inventory.data.remote.dto.PatchCatalogAccessRequest
import com.inventory.data.remote.dto.RetailOrderDto
import com.inventory.data.remote.dto.TogglePortalRequest
import com.inventory.data.remote.dto.CreateCustomerTagRequest
import com.inventory.data.remote.dto.RenameCustomerTagRequest
import com.inventory.data.remote.dto.DeleteCustomerTagRequest
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface InventoryApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): ApiEnvelope<Unit>

    @POST("auth/logout")
    suspend fun logout(): ApiEnvelope<Unit>

    @POST("agent/chat")
    suspend fun agentChat(
        @Body body: AgentChatRequest
    ): retrofit2.Response<AgentChatResponse>

    @GET("users")
    suspend fun getUsers(): ApiEnvelope<List<UserDto>>

    @POST("users")
    suspend fun createUser(@Body body: CreateUserRequest): ApiEnvelope<UserDto>

    @PUT("users/{id}")
    suspend fun updateUser(
        @Path("id") id: String,
        @Body body: UpdateUserRequest
    ): ApiEnvelope<UserDto>

    @DELETE("users/{id}")
    suspend fun deactivateUser(@Path("id") id: String): ApiEnvelope<UserDto>

    @DELETE("users/{id}/permanent")
    suspend fun deleteUserPermanently(@Path("id") id: String): ApiEnvelope<Unit>

    @GET("approvals")
    suspend fun getApprovals(): ApiEnvelope<List<ApprovalDto>>

    @PUT("approvals/{id}")
    suspend fun reviewApproval(
        @Path("id") id: String,
        @Body body: ReviewApprovalRequest
    ): ApiEnvelope<Any>

    @GET("products")
    suspend fun getProducts(
        @Query("search") search: String? = null,
        @Query("category") category: String? = null,
        @Query("branchId") branchId: String? = null,
        @Query("limit") limit: Int = 5000
    ): PagedEnvelope<ProductDto>

    @GET("products/{id}")
    suspend fun getProduct(@Path("id") id: String): ApiEnvelope<ProductDto>

    @GET("catalog-categories")
    suspend fun getCatalogCategories(): ApiEnvelope<List<CatalogCategoryDto>>

    @GET("products/by-qr/{qrCode}")
    suspend fun getProductByQr(@Path("qrCode") qrCode: String): ApiEnvelope<ProductDto>

    @POST("products")
    suspend fun createProduct(@Body body: UpsertProductRequest): ApiEnvelope<ProductDto>

    @PUT("products/{id}")
    suspend fun updateProduct(
        @Path("id") id: String,
        @Body body: UpsertProductRequest
    ): ApiEnvelope<ProductDto>

    @DELETE("products/{id}")
    suspend fun deleteProduct(@Path("id") id: String): ApiEnvelope<ProductDto>

    @GET("products/deleted")
    suspend fun getDeletedProducts(): ApiEnvelope<List<ProductDto>>

    @POST("products/{id}/restore")
    suspend fun restoreProduct(@Path("id") id: String): ApiEnvelope<ProductDto>

    @GET("reports/products/movement")
    suspend fun getProductMovement(
        @Query("productId") productId: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ApiEnvelope<ProductMovementResponse>

    @GET("branches")
    suspend fun getBranches(): ApiEnvelope<List<BranchDto>>

    @GET("branches/summaries")
    suspend fun getBranchSummaries(): ApiEnvelope<List<Any>>

    @POST("branches")
    suspend fun createBranch(@Body body: BranchRequest): ApiEnvelope<BranchDto>

    @PUT("branches/{id}")
    suspend fun updateBranch(
        @Path("id") id: String,
        @Body body: BranchRequest
    ): ApiEnvelope<BranchDto>

    @GET("customers")
    suspend fun getCustomers(
        @Query("search") search: String? = null,
        @Query("isSupplier") isSupplier: Boolean? = null,
        @Query("limit") limit: Int = 500
    ): PagedEnvelope<CustomerDto>

    @GET("customers/inactive")
    suspend fun getInactiveCustomers(@Query("days") days: Int): ApiEnvelope<List<CustomerDto>>

    @GET("customers/{id}")
    suspend fun getCustomer(@Path("id") id: String): ApiEnvelope<CustomerDto>

    @POST("customers")
    suspend fun createCustomer(@Body body: UpsertCustomerRequest): ApiEnvelope<CustomerDto>

    @PUT("customers/{id}")
    suspend fun updateCustomer(
        @Path("id") id: String,
        @Body body: UpsertCustomerRequest
    ): ApiEnvelope<CustomerDto>

    @PATCH("customers/{id}/portal-link")
    suspend fun toggleCustomerPortalLink(
        @Path("id") id: String,
        @Body body: TogglePortalRequest
    ): ApiEnvelope<Any>

    @GET("customers/{id}/transactions")
    suspend fun getCustomerTransactions(
        @Path("id") id: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ApiEnvelope<CustomerTransactionsEnvelope>

    @GET("customers/tags")
    suspend fun getCustomerTags(): ApiEnvelope<List<String>>

    @POST("customers/tags")
    suspend fun createCustomerTag(@Body body: CreateCustomerTagRequest): ApiEnvelope<List<String>>

    @PATCH("customers/tags")
    suspend fun renameCustomerTag(@Body body: RenameCustomerTagRequest): ApiEnvelope<List<String>>

    @HTTP(method = "DELETE", path = "customers/tags", hasBody = true)
    suspend fun deleteCustomerTag(@Body body: DeleteCustomerTagRequest): ApiEnvelope<List<String>>

    @GET("customers/{id}/last-transaction")
    suspend fun getLastCustomerTransaction(@Path("id") id: String): ApiEnvelope<LastTransactionDto>

    @GET("customers/{id}/balance")
    suspend fun getCustomerBalance(@Path("id") id: String): ApiEnvelope<CustomerBalanceDto>

    @GET("reports/customers/ratings")
    suspend fun getCustomerRatings(): ApiEnvelope<List<CustomerRatingDto>>

    @GET("vouchers")
    suspend fun getVouchers(
        @Query("type") type: String? = null,
        @Query("page") page: Int? = null,
        @Query("limit") limit: Int? = null,
        @Query("showCancelled") showCancelled: Boolean? = null,
    ): PagedEnvelope<VoucherDto>

    @POST("vouchers")
    suspend fun createVoucher(@Body body: CreateVoucherRequest): ApiEnvelope<Any>

    @GET("vouchers/{id}")
    suspend fun getVoucher(@Path("id") id: String): ApiEnvelope<VoucherDto>

    @DELETE("vouchers/{id}")
    suspend fun deleteVoucher(@Path("id") id: String): ApiEnvelope<Any>

    @POST("vouchers/{id}/restore")
    suspend fun restoreVoucher(@Path("id") id: String): ApiEnvelope<VoucherDto>

    @PUT("vouchers/{id}")
    suspend fun updateVoucher(
        @Path("id") id: String,
        @Body body: CreateVoucherRequest
    ): ApiEnvelope<VoucherDto>

    @GET("invoices")
    suspend fun getInvoices(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("type") type: String? = null,
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): PaginationEnvelope<InvoiceDto>

    @GET("invoices/{id}")
    suspend fun getInvoice(@Path("id") id: String): ApiEnvelope<InvoiceDto>

    @POST("invoices")
    suspend fun createInvoice(@Body body: CreateInvoiceRequest): ApiEnvelope<InvoiceDto>

    @PUT("invoices/{id}")
    suspend fun updateInvoice(
        @Path("id") id: String,
        @Body body: CreateInvoiceRequest
    ): ApiEnvelope<InvoiceDto>

    @DELETE("invoices/{id}")
    suspend fun cancelInvoice(@Path("id") id: String): ApiEnvelope<InvoiceDto>

    @GET("invoices/{id}/pdf")
    suspend fun invoicePdf(@Path("id") id: String): okhttp3.ResponseBody

    @GET("invoices/{id}/image")
    suspend fun invoiceImage(@Path("id") id: String): okhttp3.ResponseBody

    @POST("invoices/{id}/reactivate")
    suspend fun reactivateInvoice(@Path("id") id: String): ApiEnvelope<InvoiceDto>

    @GET("invoices/recently-deleted")
    suspend fun getRecentlyDeletedInvoices(): ApiEnvelope<List<InvoiceDto>>

    @POST("invoices/{id}/restore-archived")
    suspend fun restoreArchivedInvoice(@Path("id") id: String): ApiEnvelope<InvoiceDto>

    @DELETE("invoices/{id}/permanent")
    suspend fun permanentDeleteInvoice(@Path("id") id: String): ApiEnvelope<Any>

    @GET("quotations")
    suspend fun getQuotations(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): PaginationEnvelope<QuotationDto>

    @POST("quotations")
    suspend fun createQuotation(@Body body: CreateQuotationRequest): ApiEnvelope<QuotationDto>

    @PATCH("quotations/{id}/status")
    suspend fun updateQuotationStatus(
        @Path("id") id: String,
        @Body body: UpdateQuotationStatusRequest
    ): ApiEnvelope<QuotationDto>

    @POST("quotations/{id}/convert")
    suspend fun convertQuotation(@Path("id") id: String): ApiEnvelope<InvoiceDto>

    @GET("transfers")
    suspend fun getTransfers(
        @Query("branchId") branchId: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): PaginationEnvelope<TransferDto>

    @POST("transfers")
    suspend fun createTransfer(@Body body: CreateTransferRequest): TransferDto

    @GET("coupons")
    suspend fun getCoupons(): ApiEnvelope<List<CouponDto>>

    @POST("coupons")
    suspend fun createCoupon(@Body body: CouponRequest): ApiEnvelope<CouponDto>

    @PUT("coupons/{id}")
    suspend fun updateCoupon(
        @Path("id") id: String,
        @Body body: CouponRequest
    ): ApiEnvelope<CouponDto>

    @GET("audit-logs")
    suspend fun getAuditLogs(
        @Query("entity") entity: String? = null,
        @Query("action") action: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 100
    ): PaginationEnvelope<AuditLogDto>

    @GET("reports/dashboard")
    suspend fun dashboardReport(): ApiEnvelope<DashboardReportDto>

    @GET("reports/sales")
    suspend fun salesReport(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("groupBy") groupBy: String = "day"
    ): ApiEnvelope<SalesReportDto>

    @GET("reports/inventory/valuation")
    suspend fun inventoryValuation(): ApiEnvelope<InventoryValuationDto>

    @GET("reports/customers/debts")
    suspend fun customerDebtsReport(
        @Query("minDays") minDays: Int = 0,
        @Query("maxDays") maxDays: Int = 999
    ): ApiEnvelope<List<CustomerDebtDto>>

    @GET("reports/profit")
    suspend fun profitReport(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("groupBy") groupBy: String = "day"
    ): ApiEnvelope<ProfitReportDto>

    @GET("reports/customers/top")
    suspend fun topCustomersReport(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("limit") limit: Int = 20
    ): ApiEnvelope<List<TopCustomerDto>>

    @GET("reports/end-of-day")
    suspend fun endOfDayReport(
        @Query("date") date: String? = null
    ): ApiEnvelope<EndOfDayReportDto>

    @GET("reports/store-brain")
    suspend fun storeBrainReport(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ApiEnvelope<StoreBrainReportDto>

    // ── Stock losses ("التلف والخسائر") ──────────────────────────────────────────
    @GET("stock-losses")
    suspend fun getStockLosses(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("warehouseId") warehouseId: String? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 50
    ): PaginationEnvelope<StockLossDto>

    @POST("stock-losses")
    suspend fun createStockLoss(@Body body: CreateStockLossRequest): ApiEnvelope<StockLossDto>

    @PATCH("stock-losses/{id}/cancel")
    suspend fun cancelStockLoss(@Path("id") id: String): ApiEnvelope<StockLossDto>

    // ── Voice Invoice (2-step) ────────────────────────────────────────────────
    @POST("voice/parse")
    suspend fun parseVoiceCommand(
        @Body body: com.inventory.data.remote.dto.VoiceCommandRequest
    ): retrofit2.Response<com.inventory.data.remote.dto.VoiceParseResponse>

    @POST("voice/execute")
    suspend fun executeVoiceCommand(
        @Body body: com.inventory.data.remote.dto.VoiceExecuteRequest
    ): retrofit2.Response<com.inventory.data.remote.dto.VoiceExecuteResponse>

    // ── OCR Invoice ───────────────────────────────────────────────────────────
    @POST("ocr/invoice")
    suspend fun scanInvoiceImage(
        @Body body: com.inventory.data.remote.dto.OcrInvoiceRequest
    ): retrofit2.Response<com.inventory.data.remote.dto.OcrInvoiceResponse>

    // ── Catalog Management ────────────────────────────────────────────────────
    @GET("catalog-management")
    suspend fun getCatalogCustomers(): ApiEnvelope<List<CatalogCustomerDto>>

    @POST("catalog-management/{id}/grant")
    suspend fun grantCatalogAccess(
        @Path("id") id: String,
        @Body body: GrantCatalogAccessRequest
    ): ApiEnvelope<Any>

    @PATCH("catalog-management/{id}")
    suspend fun patchCatalogAccess(
        @Path("id") id: String,
        @Body body: PatchCatalogAccessRequest
    ): ApiEnvelope<Any>

    @HTTP(method = "DELETE", path = "catalog-management/{id}", hasBody = false)
    suspend fun revokeCatalogAccess(@Path("id") id: String): ApiEnvelope<Any>

    // ── Order Preparations ────────────────────────────────────────────────────
    @GET("order-preparations")
    suspend fun getOrderPreparations(): ApiEnvelope<List<OrderPreparationDto>>

    @POST("order-preparations/{id}/mark-prepared")
    suspend fun markOrderPrepared(@Path("id") id: String): ApiEnvelope<Any>

    // ── Retail catalog orders (كتلوك المفرد) ──────────────────────────────────
    @GET("retail-catalog/orders")
    suspend fun getRetailOrders(@Query("status") status: String? = null): ApiEnvelope<List<RetailOrderDto>>

    @POST("retail-catalog/orders/{id}/prepare")
    suspend fun prepareRetailOrder(@Path("id") id: String): ApiEnvelope<Any>

    @POST("retail-catalog/orders/{id}/cancel")
    suspend fun cancelRetailOrder(@Path("id") id: String): ApiEnvelope<Any>

    // ── Backup ────────────────────────────────────────────────────────────────
    @POST("settings/backup/telegram")
    suspend fun sendBackupToTelegram(): ApiEnvelope<Any>

    @GET("settings/backup/download")
    suspend fun downloadBackup(): okhttp3.ResponseBody

    // ── License ───────────────────────────────────────────────────────────────
    @GET("license/status")
    suspend fun getLicenseStatus(): ApiEnvelope<LicenseStatusDto>
}
