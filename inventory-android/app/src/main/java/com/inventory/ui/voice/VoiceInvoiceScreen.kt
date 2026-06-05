package com.inventory.ui.voice

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import kotlinx.coroutines.delay

// ── Screen ────────────────────────────────────────────────────────────────────

@Composable
fun VoiceInvoiceScreen(
    onNavigateToInvoice: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: VoiceInvoiceViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    // مشغّل التعرف على الصوت
    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val matches = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val text = matches?.firstOrNull()
            if (!text.isNullOrBlank()) {
                viewModel.processCommand(text)
            } else {
                viewModel.resetToIdle()
            }
        } else {
            viewModel.resetToIdle()
        }
    }

    // عند الحاجة لتوضيح — ابدأ الاستماع تلقائياً بعد ثانيتين
    LaunchedEffect(uiState) {
        if (uiState is VoiceUiState.NeedsClarification) {
            delay(2500)
            startSpeechRecognition(speechLauncher, viewModel)
        }
    }

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text("فاتورة صوتية") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ReceiptLong, contentDescription = "رجوع")
                    }
                },
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
        ) {

            // ── زر الميكروفون ──────────────────────────────────────────────────
            MicButton(
                uiState = uiState,
                onClick = {
                    if (uiState is VoiceUiState.Idle ||
                        uiState is VoiceUiState.Success ||
                        uiState is VoiceUiState.Error
                    ) {
                        startSpeechRecognition(speechLauncher, viewModel)
                    }
                }
            )

            // ── بطاقة الحالة ───────────────────────────────────────────────────
            AnimatedContent(targetState = uiState, label = "status") { state ->
                when (state) {
                    VoiceUiState.Idle -> HintCard()

                    VoiceUiState.Listening -> StatusCard(
                        text = "🎤  تكلم الآن...",
                        color = Color(0xFFEF4444),
                    )

                    VoiceUiState.Loading -> StatusCard(
                        text = "⏳  جاري الفهم والتنفيذ...",
                        color = Color(0xFF6366F1),
                        showProgress = true,
                    )

                    is VoiceUiState.NeedsClarification -> StatusCard(
                        text = "❓  ${state.question}",
                        color = Color(0xFFF59E0B),
                        icon = { Icon(Icons.Default.HelpOutline, null, tint = Color(0xFFF59E0B)) },
                    )

                    is VoiceUiState.Success -> SuccessCard(
                        state = state,
                        onOpenInvoice = { onNavigateToInvoice(state.invoiceId) },
                        onNewInvoice = { viewModel.resetToIdle() },
                    )

                    is VoiceUiState.Error -> StatusCard(
                        text = "❌  ${state.message}",
                        color = Color(0xFFEF4444),
                        icon = { Icon(Icons.Default.ErrorOutline, null, tint = Color(0xFFEF4444)) },
                    )
                }
            }
        }
    }
}

// ── Mic Button ────────────────────────────────────────────────────────────────

@Composable
private fun MicButton(uiState: VoiceUiState, onClick: () -> Unit) {
    val isListening = uiState is VoiceUiState.Listening
    val isLoading   = uiState is VoiceUiState.Loading

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue  = if (isListening) 1.15f else 1f,
        animationSpec = infiniteRepeatable(
            animation  = tween(600),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )

    val bgColor = when {
        isListening          -> Color(0xFFEF4444)
        isLoading            -> Color(0xFF94A3B8)
        uiState is VoiceUiState.Success -> Color(0xFF10B981)
        else                 -> Color(0xFF6366F1)
    }

    Box(contentAlignment = Alignment.Center) {
        // هالة النبض
        if (isListening) {
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .scale(scale)
                    .background(Color(0x33EF4444), CircleShape)
            )
        }

        // الزر الرئيسي
        FilledIconButton(
            onClick = onClick,
            modifier = Modifier.size(90.dp),
            enabled = !isLoading,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = bgColor,
                contentColor   = Color.White,
            ),
            shape = CircleShape,
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    color = Color.White,
                    modifier = Modifier.size(32.dp),
                    strokeWidth = 3.dp,
                )
            } else {
                Icon(
                    Icons.Default.Mic,
                    contentDescription = "ميكروفون",
                    modifier = Modifier.size(36.dp),
                )
            }
        }
    }
}

// ── Hint Card (Idle) ──────────────────────────────────────────────────────────

@Composable
private fun HintCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF1F5F9)),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "اضغط الميكروفون وقل:",
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = Color(0xFF475569),
            )
            listOf(
                "\"سوّي فاتورة لمحمد، كارتون شاي، نقداً\"",
                "\"بيع لأبو علي 5 قطع صابون بـ 3000\"",
                "\"فاتورة علي، درزن معجون، دين\"",
            ).forEach { hint ->
                Text(
                    hint,
                    fontSize = 13.sp,
                    color = Color(0xFF6366F1),
                    modifier = Modifier
                        .background(Color(0xFFEEF2FF), RoundedCornerShape(8.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }
}

// ── Status Card ───────────────────────────────────────────────────────────────

@Composable
private fun StatusCard(
    text: String,
    color: Color,
    showProgress: Boolean = false,
    icon: (@Composable () -> Unit)? = null,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = color.copy(alpha = 0.08f)
        ),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (showProgress) {
                CircularProgressIndicator(
                    color = color,
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                icon?.invoke()
            }
            Text(
                text,
                color = color,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
            )
        }
    }
}

// ── Success Card ──────────────────────────────────────────────────────────────

@Composable
private fun SuccessCard(
    state: VoiceUiState.Success,
    onOpenInvoice: () -> Unit,
    onNewInvoice: () -> Unit,
) {
    fun unitLabel(unit: String) = when (unit) {
        "CARTON" -> "كرتون"
        "DOZEN"  -> "درزن"
        else     -> "قطعة"
    }

    fun payLabel(pay: String) = when (pay) {
        "CASH"    -> "نقداً"
        "CREDIT"  -> "دين"
        else      -> "جزئي"
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0FDF4)),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF10B981))
                Text(
                    "فاتورة #${state.invoiceNumber}",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = Color(0xFF065F46),
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                InfoRow("الزبون",   state.customerName)
                InfoRow("المنتج",   state.productName)
                InfoRow("الكمية",   "${state.quantity} ${unitLabel(state.unit)}")
                InfoRow("المجموع",  "${state.totalAmount.toLong().formatWithCommas()} د.ع")
                InfoRow("الدفع",    payLabel(state.paymentType))
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedButton(
                    onClick = onNewInvoice,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("فاتورة جديدة")
                }
                Button(
                    onClick = onOpenInvoice,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF10B981)
                    ),
                ) {
                    Text("عرض وطباعة")
                }
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, fontSize = 13.sp, color = Color(0xFF6B7280))
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color(0xFF111827))
    }
}

private fun Long.formatWithCommas(): String =
    String.format("%,d", this)

// ── Helper ────────────────────────────────────────────────────────────────────

private fun startSpeechRecognition(
    launcher: androidx.activity.result.ActivityResultLauncher<Intent>,
    viewModel: VoiceInvoiceViewModel,
) {
    viewModel.setListening()
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-IQ")
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar")
        putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false)
        putExtra(RecognizerIntent.EXTRA_PROMPT, "تكلم الآن — قل أمر الفاتورة")
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    launcher.launch(intent)
}
