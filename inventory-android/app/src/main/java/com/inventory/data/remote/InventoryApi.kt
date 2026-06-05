package com.inventory.data.remote

import com.inventory.data.remote.dto.ApiEnvelope
import com.inventory.data.remote.dto.ApprovalDto
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.CreateVoucherRequest
import com.inventory.data.remote.dto.CreateInvoiceRequest
import com.inventory.data.remote.dto.CustomerDebtDto
import com.inventory.data.remote.dto.CreateUserRequest
import com.inventory.data.remote.dto.CustomerBalanceDto
import com.inventory.data.remote.dto.CustomerDto
import com.inventory.data.remote.dto.CustomerTransactionDto
import com.inventory.data.remote.dto.CustomerTransactionsEnvelope
import com.inventory.data.remote.dto.LastTransactionDto
import com.inventory.data.remote.dto.LoginRequest
import com.inventory.data.remote.dto.PagedEnvelope
import com.inventory.data.remote.dto.PaginationEnvelope
import com.inventory.data.remote.dto.DashboardReportDto
import com.inventory.data.remote.dto.InventoryValuationDto
import com.inventory.data.remote.dto.InvoiceDto
import com.inventory.data.remote.dto.ProductDto
import com.inventory.data.remote.dto.ProductMovementResponse
import com.inventory.data.remote.dto.ReviewApprovalRequest
import com.inventory.data.remote.dto.SalesReportDto
import com.inventory.data.remote.dto.UpdateUserRequest
import com.inventory.data.remote.dto.UpsertCustomerRequest
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.data.remote.dto.UserDto
import com.inventory.data.remote.dto.VoucherDto
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface InventoryApi {
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): ApiEnvelope<Unit>

    @POST("auth/logout")
    suspend fun logout(): ApiEnvelope<Unit>

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
        @Query("category") category: String? = null
    ): PagedEnvelope<ProductDto>

    @GET("products/{id}")
    suspend fun getProduct(@Path("id") id: String): ApiEnvelope<ProductDto>

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

    @GET("reports/products/movement")
    suspend fun getProductMovement(
        @Query("productId") productId: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ApiEnvelope<ProductMovementResponse>

    @GET("branches")
    suspend fun getBranches(): ApiEnvelope<List<BranchDto>>

    @GET("customers")
    suspend fun getCustomers(
        @Query("search") search: String? = null,
        @Query("isSupplier") isSupplier: Boolean? = null
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

    @GET("customers/{id}/transactions")
    suspend fun getCustomerTransactions(
        @Path("id") id: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null
    ): ApiEnvelope<CustomerTransactionsEnvelope>

    @GET("customers/{id}/last-transaction")
    suspend fun getLastCustomerTransaction(@Path("id") id: String): ApiEnvelope<LastTransactionDto>

    @GET("customers/{id}/balance")
    suspend fun getCustomerBalance(@Path("id") id: String): ApiEnvelope<CustomerBalanceDto>

    @POST("vouchers")
    suspend fun createVoucher(@Body body: CreateVoucherRequest): ApiEnvelope<Any>

    @GET("vouchers/{id}")
    suspend fun getVoucher(@Path("id") id: String): ApiEnvelope<VoucherDto>

    @PUT("vouchers/{id}")
    suspend fun updateVoucher(
        @Path("id") id: String,
        @Body body: CreateVoucherRequest
    ): ApiEnvelope<VoucherDto>

    @GET("invoices")
    suspend fun getInvoices(
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
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

    // ── Voice Invoice ─────────────────────────────────────────────────────────
    @POST("voice/invoice")
    suspend fun processVoiceInvoice(
        @Body body: com.inventory.data.remote.dto.VoiceCommandRequest
    ): retrofit2.Response<com.inventory.data.remote.dto.VoiceInvoiceResponse>
}
