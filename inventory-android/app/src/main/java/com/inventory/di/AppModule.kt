package com.inventory.di

import android.content.Context
import androidx.room.Room
import com.inventory.data.local.AppDatabase
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.InventoryApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(context, AppDatabase::class.java, "inventory.db")
            .build()
    }

    @Provides
    fun provideUserDao(database: AppDatabase) = database.userDao()

    @Provides
    fun provideProductDao(database: AppDatabase) = database.productDao()

    @Provides
    fun provideCustomerDao(database: AppDatabase) = database.customerDao()

    @Provides
    fun providePendingApprovalDao(database: AppDatabase) = database.pendingApprovalDao()

    @Provides
    fun provideNotificationDao(database: AppDatabase) = database.notificationDao()

    @Provides
    fun providePendingSyncOperationDao(database: AppDatabase) = database.pendingSyncOperationDao()

    @Provides
    @Singleton
    fun provideInventoryApi(apiClient: ApiClient): InventoryApi = apiClient.api
}
