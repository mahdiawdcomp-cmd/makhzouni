package com.inventory.domain.usecase

import com.inventory.data.repository.AuthRepository
import javax.inject.Inject

class LoginUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(username: String, password: String, rememberMe: Boolean) =
        authRepository.login(username, password, rememberMe)
}
