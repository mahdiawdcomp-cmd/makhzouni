package com.inventory.data.repository

import com.inventory.data.local.ProductDao
import com.inventory.data.local.ProductEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.BranchDto
import com.inventory.data.remote.dto.ProductDto
import com.inventory.data.remote.dto.ProductMovementDto
import com.inventory.data.remote.dto.UpsertProductRequest
import com.inventory.domain.model.Product
import com.inventory.domain.model.ProductMovement
import com.inventory.domain.model.WarehouseStock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProductRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val productDao: ProductDao,
    private val networkMonitor: NetworkMonitor,
    private val syncRepository: SyncRepository
) {
    val products: Flow<List<Product>> = productDao.observeProducts().map { list ->
        list.map { it.toDomain() }
    }

    fun observeProduct(id: String): Flow<Product?> = productDao.observeProduct(id).map { it?.toDomain() }

    suspend fun loadBranches(): ApiResult<List<BranchDto>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            ApiResult.Success(apiClient.api.getBranches().data.orEmpty())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل الفروع")
        }
    }

    suspend fun refreshProducts(search: String? = null, category: String? = null): ApiResult<List<Product>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.getProducts(search = search.takeUnless { it.isNullOrBlank() }, category = category.takeUnless { it.isNullOrBlank() })
            val entities = response.data.map { it.toEntity() }
            if (search.isNullOrBlank() && category.isNullOrBlank()) {
                productDao.replaceAll(entities)
            } else {
                productDao.upsertAll(entities)
            }
            ApiResult.Success(entities.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل المنتجات")
        }
    }

    suspend fun findByQr(qrCode: String): ApiResult<Product?> {
        val local = productDao.findByQr(qrCode)?.toDomain()
        if (local != null) return ApiResult.Success(local)
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.getProductByQr(qrCode)
            val product = response.data?.toEntity()
            if (product != null) productDao.upsertAll(listOf(product))
            ApiResult.Success(product?.toDomain())
        } catch (error: Exception) {
            ApiResult.Success(null)
        }
    }

    suspend fun saveProduct(id: String?, request: UpsertProductRequest) = if (id == null) {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("CREATE_PRODUCT", "POST", "products", request)
            null
        } else {
            apiClient.api.createProduct(request)
        }
    } else {
        if (!networkMonitor.isOnline()) {
            syncRepository.enqueue("UPDATE_PRODUCT", "PUT", "products/$id", request)
            null
        } else {
            apiClient.api.updateProduct(id, request)
        }
    }

    suspend fun createQuickProduct(name: String): ApiResult<Product> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val dto = apiClient.api.createProduct(UpsertProductRequest(name = name.trim(), pcsPerCarton = 1)).data
                ?: return ApiResult.Error("تعذر إنشاء المادة")
            val entity = dto.toEntity()
            productDao.upsertAll(listOf(entity))
            ApiResult.Success(entity.toDomain())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر إنشاء المادة")
        }
    }

    suspend fun deleteProduct(id: String): ApiResult<Unit> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            apiClient.api.deleteProduct(id)
            productDao.deleteProduct(id)
            ApiResult.Success(Unit)
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر حذف المادة")
        }
    }

    suspend fun fetchById(id: String): ApiResult<Product> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val dto = apiClient.api.getProduct(id).data
                ?: return ApiResult.Error("المادة غير موجودة")
            ApiResult.Success(dto.toDomainFull())
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل المادة")
        }
    }

    suspend fun movement(productId: String, from: String?, to: String?): ApiResult<List<ProductMovement>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val rows = apiClient.api.getProductMovement(productId, from.takeUnless { it.isNullOrBlank() }, to.takeUnless { it.isNullOrBlank() }).data?.rows.orEmpty()
            ApiResult.Success(rows.map { it.toDomain() })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل حركة المادة")
        }
    }
}

private fun ProductEntity.toDomain() = Product(
    id = id,
    itemNumber = itemNumber,
    name = name,
    qrCode = qrCode,
    cartonQrCode = cartonQrCode,
    imageUrl = imageUrl,
    category = category,
    openingBalancePcs = openingBalancePcs,
    cartonsAvailable = cartonsAvailable,
    pcsPerCarton = pcsPerCarton,
    purchasePrice = purchasePrice,
    salePrice = salePrice,
    retailPrice = retailPrice,
    minStock = minStock,
    shopStock = shopStock,
    updatedAt = updatedAt
)

private fun ProductDto.toDomainFull() = Product(
    id = id,
    itemNumber = itemNumber,
    name = name,
    qrCode = qrCode.orEmpty(),
    cartonQrCode = cartonQrCode.orEmpty(),
    imageUrl = imageUrl,
    category = category.orEmpty(),
    openingBalancePcs = openingBalancePcs,
    cartonsAvailable = cartonsAvailable,
    pcsPerCarton = pcsPerCarton,
    purchasePrice = purchasePrice,
    salePrice = salePrice,
    retailPrice = retailPrice,
    minStock = minStock,
    shopStock = shopStock,
    warehouseStocks = warehouseStocks?.map { ws ->
        WarehouseStock(
            warehouseId = ws.warehouseId,
            warehouseName = ws.warehouse.name,
            warehouseCode = ws.warehouse.code,
            quantityPieces = ws.quantityPieces,
            storageLocation = ws.storageLocation,
            minStock = ws.minStock
        )
    } ?: emptyList(),
    updatedAt = updatedAt
)

private fun ProductDto.toEntity() = ProductEntity(
    id = id,
    itemNumber = itemNumber,
    name = name,
    qrCode = qrCode.orEmpty(),
    cartonQrCode = cartonQrCode.orEmpty(),
    imageUrl = imageUrl,
    category = category.orEmpty(),
    openingBalancePcs = openingBalancePcs,
    cartonsAvailable = cartonsAvailable,
    pcsPerCarton = pcsPerCarton,
    purchasePrice = purchasePrice,
    salePrice = salePrice,
    retailPrice = retailPrice,
    minStock = minStock,
    shopStock = shopStock,
    updatedAt = updatedAt
)

private fun ProductMovementDto.toDomain() = ProductMovement(
    date = date,
    customerName = customerName ?: "-",
    quantity = quantity,
    unitPrice = unitPrice,
    unit = unit,
    invoiceNumber = invoiceNumber,
    invoiceId = invoiceId.orEmpty()
)
