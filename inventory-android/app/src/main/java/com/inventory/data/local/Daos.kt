package com.inventory.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface UserDao {
    @Query("SELECT * FROM users ORDER BY name")
    fun observeUsers(): Flow<List<UserEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(users: List<UserEntity>)
}

@Dao
interface ProductDao {
    @Query("SELECT * FROM products ORDER BY itemNumber")
    fun observeProducts(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE id = :id LIMIT 1")
    fun observeProduct(id: String): Flow<ProductEntity?>

    @Query("SELECT * FROM products WHERE qrCode = :qrCode LIMIT 1")
    suspend fun findByQr(qrCode: String): ProductEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(products: List<ProductEntity>)

    @Query("DELETE FROM products WHERE id = :id")
    suspend fun deleteProduct(id: String)
}

@Dao
interface CustomerDao {
    @Query("SELECT * FROM customers WHERE deletedAt IS NULL ORDER BY name")
    fun observeCustomers(): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    fun observeCustomer(id: String): Flow<CustomerEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(customers: List<CustomerEntity>)
}

@Dao
interface PendingApprovalDao {
    @Query("SELECT * FROM pending_approvals WHERE status = 'PENDING' ORDER BY createdAt DESC")
    fun observePending(): Flow<List<PendingApprovalEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<PendingApprovalEntity>)
}

@Dao
interface InvoiceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<InvoiceEntity>)
}

@Dao
interface InvoiceItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<InvoiceItemEntity>)
}

@Dao
interface PaymentVoucherDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<PaymentVoucherEntity>)
}

@Dao
interface NotificationDao {
    @Query("SELECT COUNT(*) FROM notifications WHERE isRead = 0")
    fun observeUnreadCount(): Flow<Int>

    @Query("SELECT * FROM notifications ORDER BY createdAt DESC")
    fun observeNotifications(): Flow<List<NotificationEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<NotificationEntity>)
}

@Dao
interface StockMovementDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(items: List<StockMovementEntity>)
}

@Dao
interface PendingSyncOperationDao {
    @Query("SELECT * FROM pending_sync_operations WHERE status IN ('PENDING', 'FAILED') AND attempts < :maxAttempts ORDER BY createdAt ASC LIMIT :limit")
    suspend fun nextPending(limit: Int = 25, maxAttempts: Int = 5): List<PendingSyncOperationEntity>

    @Query("SELECT COUNT(*) FROM pending_sync_operations WHERE status IN ('PENDING', 'FAILED')")
    fun observePendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(operation: PendingSyncOperationEntity)

    @Query("UPDATE pending_sync_operations SET status = :status, attempts = attempts + :attemptDelta, lastError = :lastError, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateStatus(
        id: String,
        status: String,
        attemptDelta: Int,
        lastError: String?,
        updatedAt: String
    )

    @Query("DELETE FROM pending_sync_operations WHERE id = :id")
    suspend fun delete(id: String)
}
