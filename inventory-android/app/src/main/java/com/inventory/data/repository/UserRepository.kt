package com.inventory.data.repository

import com.inventory.data.local.UserDao
import com.inventory.data.local.UserEntity
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.ApiResult
import com.inventory.data.remote.NetworkMonitor
import com.inventory.data.remote.dto.CreateUserRequest
import com.inventory.data.remote.dto.UpdateUserRequest
import com.inventory.domain.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    private val apiClient: ApiClient,
    private val userDao: UserDao,
    private val networkMonitor: NetworkMonitor
) {
    val users: Flow<List<User>> = userDao.observeUsers().map { list ->
        list.map { User(it.id, it.name, it.username, it.role, it.permissions.splitPermissions(), it.isActive) }
    }

    suspend fun refreshUsers(): ApiResult<List<User>> {
        if (!networkMonitor.isOnline()) return ApiResult.Offline
        return try {
            val response = apiClient.api.getUsers()
            val users = response.data.orEmpty()
            userDao.upsertAll(users.map {
                UserEntity(it.id, it.name, it.username, it.role, it.permissions.orEmpty().joinToString(","), it.isActive, it.updatedAt)
            })
            ApiResult.Success(users.map { User(it.id, it.name, it.username, it.role, it.permissions.orEmpty(), it.isActive) })
        } catch (error: Exception) {
            ApiResult.Error(error.message ?: "تعذر تحميل المستخدمين")
        }
    }

    suspend fun createUser(request: CreateUserRequest) = apiClient.api.createUser(request)
    suspend fun updateUser(id: String, request: UpdateUserRequest) = apiClient.api.updateUser(id, request)
    suspend fun deactivateUser(id: String) = apiClient.api.deactivateUser(id)
    suspend fun deleteUserPermanently(id: String) = apiClient.api.deleteUserPermanently(id)
}

private fun String.splitPermissions(): List<String> =
    split(",").map { it.trim() }.filter { it.isNotEmpty() }
