package com.inventory.ui.agent

sealed interface AgentUiState {
    data object Idle : AgentUiState
    data object Listening : AgentUiState
    data object Thinking : AgentUiState
    data class Speaking(val text: String) : AgentUiState
    data class Error(val message: String) : AgentUiState
}

data class AgentHistoryItem(
    val role: String,
    val content: String
)
