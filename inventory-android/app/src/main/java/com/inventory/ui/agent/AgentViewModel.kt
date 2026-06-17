package com.inventory.ui.agent

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.inventory.data.remote.ApiClient
import com.inventory.data.remote.dto.AgentChatRequest
import com.inventory.data.remote.dto.AgentMessageDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AgentViewModel @Inject constructor(
    private val apiClient: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow<AgentUiState>(AgentUiState.Idle)
    val uiState: StateFlow<AgentUiState> = _uiState.asStateFlow()

    private val _history = MutableStateFlow<List<AgentHistoryItem>>(emptyList())
    val history: StateFlow<List<AgentHistoryItem>> = _history.asStateFlow()

    fun setListening() {
        _uiState.value = AgentUiState.Listening
    }

    fun setIdle() {
        _uiState.value = AgentUiState.Idle
    }

    fun sendMessage(text: String) {
        viewModelScope.launch {
            _uiState.value = AgentUiState.Thinking
            try {
                val currentHistory = _history.value.takeLast(6)
                _history.value = currentHistory + AgentHistoryItem("user", text)
                val response = apiClient.api.agentChat(
                    AgentChatRequest(
                        message = text,
                        history = currentHistory.map { AgentMessageDto(it.role, it.content) }
                    )
                )
                val body = response.body()
                if (response.isSuccessful && body?.success == true && body.reply != null) {
                    _history.value = body.history?.map {
                        AgentHistoryItem(it.role, it.content)
                    } ?: currentHistory + listOf(
                        AgentHistoryItem("user", text),
                        AgentHistoryItem("assistant", body.reply)
                    )
                    _uiState.value = AgentUiState.Speaking(body.reply)
                } else {
                    _uiState.value = AgentUiState.Error("ما قدرت أجيب جواب")
                }
            } catch (e: Exception) {
                _uiState.value = AgentUiState.Error(e.message ?: "خطأ في الاتصال")
            }
        }
    }

    fun resetConversation() {
        _history.value = emptyList()
        _uiState.value = AgentUiState.Idle
    }
}
