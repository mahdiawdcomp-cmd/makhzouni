package com.inventory.ui.users

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.dto.CreateUserRequest
import com.inventory.data.remote.dto.UpdateUserRequest
import com.inventory.data.repository.UserRepository
import com.inventory.domain.model.User
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PermissionOption(val id: String, val label: String, val hint: String)

val userPermissionOptions = listOf(
    PermissionOption("MANAGE_USERS", "المستخدمين", "إضافة وتعديل وتعطيل المستخدمين"),
    PermissionOption("MANAGE_APPROVALS", "الموافقات", "مراجعة طلبات الموظفين"),
    PermissionOption("MANAGE_PRODUCTS", "المخزن", "إضافة وتعديل المواد"),
    PermissionOption("MANAGE_CUSTOMERS", "الزبائن والموردين", "إدارة الحسابات والكشوفات"),
    PermissionOption("MANAGE_INVOICES", "الفواتير", "إنشاء وتعديل فواتير البيع والشراء"),
    PermissionOption("MANAGE_VOUCHERS", "السندات", "سندات القبض والدفع والمصاريف"),
    PermissionOption("VIEW_REPORTS", "التقارير", "عرض تقارير المبيعات والأرباح"),
    PermissionOption("MANAGE_SETTINGS", "الإعدادات", "إعدادات النظام والرسائل"),
)

@HiltViewModel
class UserManagementViewModel @Inject constructor(
    private val userRepository: UserRepository
) : ViewModel() {
    val users: StateFlow<List<User>> = userRepository.users.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList()
    )
    val message = MutableStateFlow<String?>(null)

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            userRepository.refreshUsers()
        }
    }

    fun saveUser(
        editingUser: User?,
        name: String,
        username: String,
        password: String,
        role: String,
        permissions: List<String>,
        isActive: Boolean
    ) {
        val finalPermissions = if (role == "ADMIN") userPermissionOptions.map { it.id } else permissions
        viewModelScope.launch {
            if (editingUser == null) {
                userRepository.createUser(
                    CreateUserRequest(
                        name = name,
                        username = username,
                        password = password,
                        role = role,
                        permissions = finalPermissions,
                        isActive = isActive
                    )
                )
                message.value = "تم حفظ المستخدم"
            } else {
                userRepository.updateUser(
                    editingUser.id,
                    UpdateUserRequest(
                        name = name,
                        username = username,
                        password = password.takeIf { it.isNotBlank() },
                        role = role,
                        permissions = finalPermissions,
                        isActive = isActive
                    )
                )
                message.value = "تم تحديث المستخدم"
            }
            refresh()
        }
    }

    fun deactivate(user: User) {
        viewModelScope.launch {
            userRepository.deactivateUser(user.id)
            message.value = "تم تعطيل المستخدم"
            refresh()
        }
    }

    fun deletePermanently(user: User) {
        viewModelScope.launch {
            try {
                userRepository.deleteUserPermanently(user.id)
                message.value = "تم حذف المستخدم"
                refresh()
            } catch (error: Exception) {
                message.value = error.message ?: "تعذر حذف المستخدم"
            }
        }
    }
}
