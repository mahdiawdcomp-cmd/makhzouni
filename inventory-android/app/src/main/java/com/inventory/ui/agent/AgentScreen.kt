package com.inventory.ui.agent

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentScreen(
    onBack: () -> Unit,
    viewModel: AgentViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val history by viewModel.history.collectAsState()
    val context = LocalContext.current
    val tts = remember { mutableStateOf<TextToSpeech?>(null) }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val text = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
            if (!text.isNullOrBlank()) viewModel.sendMessage(text) else viewModel.setIdle()
        } else {
            viewModel.setIdle()
        }
    }

    fun startListening() {
        viewModel.setListening()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-IQ")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar")
            putExtra(RecognizerIntent.EXTRA_PROMPT, "تكلم الآن...")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        speechLauncher.launch(intent)
    }

    LaunchedEffect(Unit) {
        tts.value = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts.value?.language = Locale("ar")
                tts.value?.setSpeechRate(1.05f)
            }
        }
    }

    DisposableEffect(Unit) {
        onDispose { tts.value?.shutdown() }
    }

    LaunchedEffect(uiState) {
        val state = uiState
        if (state is AgentUiState.Speaking) {
            tts.value?.speak(state.text, TextToSpeech.QUEUE_FLUSH, null, "agent_reply")
            delay(3000L)
            viewModel.setIdle()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("المساعد الذكي") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "رجوع")
                    }
                },
                actions = {
                    IconButton(onClick = {
                        tts.value?.stop()
                        viewModel.resetConversation()
                    }) {
                        Icon(Icons.Default.Refresh, contentDescription = "محادثة جديدة")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (history.isEmpty()) {
                    item { HintCard("اسألني: وين رصيد أبو محمد؟") }
                    item { HintCard("اسألني: شنو مبيعات اليوم؟") }
                    item { HintCard("قول لي: سوي فاتورة لعلي كارتون شاي") }
                }
                items(history) { message ->
                    MessageBubble(message)
                }
            }

            StatusStrip(uiState)

            MicButton(
                uiState = uiState,
                onClick = {
                    when (uiState) {
                        AgentUiState.Thinking -> Unit
                        AgentUiState.Listening -> viewModel.setIdle()
                        is AgentUiState.Speaking -> {
                            tts.value?.stop()
                            viewModel.setIdle()
                        }
                        else -> startListening()
                    }
                }
            )
        }
    }
}

@Composable
private fun HintCard(text: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RoundedCornerShape(10.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(14.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun MessageBubble(item: AgentHistoryItem) {
    val isAssistant = item.role == "assistant"
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isAssistant) Arrangement.End else Arrangement.Start
    ) {
        Surface(
            color = if (isAssistant) Color(0xFF7C3AED) else MaterialTheme.colorScheme.surfaceVariant,
            contentColor = if (isAssistant) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth(0.82f)
        ) {
            Text(
                text = item.content,
                modifier = Modifier.padding(12.dp),
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun StatusStrip(uiState: AgentUiState) {
    val content = when (uiState) {
        AgentUiState.Idle -> null
        AgentUiState.Listening -> "تكلم الآن..."
        AgentUiState.Thinking -> "يفكر..."
        is AgentUiState.Speaking -> uiState.text
        is AgentUiState.Error -> uiState.message
    }
    if (content == null) {
        Spacer(Modifier.height(4.dp))
        return
    }

    val color = when (uiState) {
        AgentUiState.Listening, is AgentUiState.Error -> Color(0xFFDC2626)
        AgentUiState.Thinking -> MaterialTheme.colorScheme.onSurfaceVariant
        is AgentUiState.Speaking -> Color(0xFF059669)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (uiState is AgentUiState.Thinking) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.size(8.dp))
        }
        Text(
            text = content,
            color = color,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun MicButton(uiState: AgentUiState, onClick: () -> Unit) {
    val isListening = uiState === AgentUiState.Listening
    val isThinking = uiState === AgentUiState.Thinking
    val infiniteTransition = rememberInfiniteTransition(label = "agent-pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (isListening) 1.14f else 1f,
        animationSpec = infiniteRepeatable(animation = tween(650), repeatMode = RepeatMode.Reverse),
        label = "agent-scale"
    )
    val color = when (uiState) {
        AgentUiState.Listening -> Color(0xFFDC2626)
        AgentUiState.Thinking -> Color(0xFF94A3B8)
        is AgentUiState.Speaking -> Color(0xFF059669)
        is AgentUiState.Error -> Color(0xFF991B1B)
        AgentUiState.Idle -> Color(0xFF7C3AED)
    }

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.Center
    ) {
        if (isListening) {
            Box(
                modifier = Modifier
                    .size(104.dp)
                    .scale(scale)
                    .background(Color(0x22DC2626), CircleShape)
            )
        }
        FilledIconButton(
            onClick = onClick,
            enabled = !isThinking,
            modifier = Modifier.size(82.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White),
            shape = CircleShape
        ) {
            if (isThinking) {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
            } else {
                Icon(Icons.Default.Mic, contentDescription = "مايكروفون", modifier = Modifier.size(34.dp))
            }
        }
    }
}
