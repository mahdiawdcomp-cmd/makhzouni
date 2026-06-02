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

    fun createUser(name: String, username: String, password: String, role: String) {
        viewModelScope.launch {
            userRepository.createUser(CreateUserRequest(name, username, password, role))
            message.value = "تم حفظ المستخدم"
            refresh()
        }
    }

    fun setRole(user: User, role: String) {
        viewModelScope.launch {
            userRepository.updateUser(user.id, UpdateUserRequest(role = role))
            message.value = "تم تحديث الصلاحية"
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
}
